import { existsSync, readFileSync, readdirSync, realpathSync } from 'fs';
import { basename, extname, join, relative, sep } from 'path';

import type { DiscoveredPackage } from './discovery.js';
import { docKindToModule } from './discovery.js';
import type { DocEntry, DocModule, DocSection, DocSource } from './types.js';
import {
  resolveDocsMarkdown,
  type DocsVisibilityOptions,
} from './visibility.js';

const DEFAULT_MODULES: DocModule[] = ['guide', 'host', 'ts-sdk'];
const UNPUBLISHED_DOC_DIRECTORY_NAMES = new Set(['preview', 'experimental']);

interface FrontMatterResult {
  attributes: Record<string, string | string[]>;
  body: string;
}

function parseFrontMatter(markdown: string): FrontMatterResult {
  const lines = markdown.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    return { attributes: {}, body: markdown };
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]?.trim() === '---') {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return { attributes: {}, body: markdown };
  }

  const frontMatterLines = lines.slice(1, endIndex);
  const attributes: Record<string, string | string[]> = {};
  let currentArrayKey: string | null = null;

  for (const line of frontMatterLines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith('- ') && currentArrayKey) {
      const value = trimmed.slice(2).trim();
      const existing = attributes[currentArrayKey];
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        attributes[currentArrayKey] = [value];
      }
      continue;
    }

    const separatorIndex = trimmed.indexOf(':');
    if (separatorIndex === -1) {
      currentArrayKey = null;
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (!value) {
      attributes[key] = [];
      currentArrayKey = key;
      continue;
    }

    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1).trim();
      const parts = inner ? inner.split(',').map((part) => part.trim()) : [];
      attributes[key] = parts.filter(Boolean);
      currentArrayKey = null;
      continue;
    }

    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }

    attributes[key] = value;
    currentArrayKey = null;
  }

  const body = lines.slice(endIndex + 1).join('\n');
  return { attributes, body };
}

export function getDocFrontmatterFlags(markdown: string): string[] {
  const value = parseFrontMatter(markdown).attributes.flags;
  return Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
}

function extractTitle(markdown: string): string | undefined {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim();
}

function extractSymbolsFromHeading(heading: string): string[] {
  const symbols = new Set<string>();
  const cleaned = heading.replace(/`/g, '').trim();
  const typedMatch = cleaned.match(
    /^(Class|Interface|Type|Function|Method|Enum|Variable|Decorator|Namespace)\s*:\s*(.+)$/i
  );
  if (typedMatch?.[2]) {
    symbols.add(typedMatch[2].trim());
  }

  const backtickMatches = heading.match(/`([^`]+)`/g) ?? [];
  for (const match of backtickMatches) {
    const value = match.replace(/`/g, '').trim();
    if (value) {
      symbols.add(value);
    }
  }

  const simpleMatch = cleaned.match(/^(?:\w+\s*:\s*)?([A-Za-z0-9_.$<>-]+)$/);
  if (simpleMatch?.[1]) {
    symbols.add(simpleMatch[1]);
  }

  // Headings document the call form (`@entity()`), but callers look the
  // symbol up by bare name. Register the signature-free alias too.
  for (const symbol of [...symbols]) {
    const bare = symbol.replace(/\s*\(.*\)\s*$/, '').trim();
    if (bare && bare !== symbol) {
      symbols.add(bare);
    }
  }

  return [...symbols].filter(Boolean);
}

/**
 * Symbol names a section's code samples import from `@microsoft/*`.
 *
 * Sample imports have to compile, so every name is a real export. This is the
 * API the section documents — headings alone miss it, because `RayfinClient`
 * is documented under a "Quickstart" heading, not a heading of its own.
 */
function extractSymbolsFromImports(content: string): string[] {
  const names = new Set<string>();
  const IMPORTS =
    /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]@microsoft\/[^'"]+['"]/g;

  for (const match of content.matchAll(IMPORTS)) {
    for (const part of (match[1] ?? '').split(',')) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) {
        names.add(name);
      }
    }
  }

  return [...names];
}

function extractSymbolsFromFilename(filePath: string): string[] {
  const name = basename(filePath, extname(filePath));
  if (
    !name ||
    name.toLowerCase() === 'index' ||
    name.toLowerCase() === 'readme'
  ) {
    return [];
  }

  return [name];
}

function parseSections(markdown: string): DocSection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: DocSection[] = [];
  let currentHeading = 'Overview';
  let currentLevel = 1;
  let buffer: string[] = [];

  const flush = () => {
    const content = buffer.join('\n').trim();
    if (!content && currentHeading === 'Overview') {
      buffer = [];
      return;
    }

    sections.push({
      heading: currentHeading,
      level: currentLevel,
      content,
      symbols: [
        ...new Set([
          ...extractSymbolsFromHeading(currentHeading),
          ...extractSymbolsFromImports(content),
        ]),
      ],
    });
    buffer = [];
  };

  for (const line of lines) {
    const headingMatch = line.match(/^(#{2,3})\s+(.+)$/);
    if (headingMatch) {
      flush();
      currentHeading = headingMatch[2].trim();
      currentLevel = headingMatch[1].length;
      continue;
    }

    buffer.push(line);
  }

  flush();
  return sections.filter(
    (section) => section.content || section.heading !== 'Overview'
  );
}

function collectMarkdownFiles(
  dir: string,
  visited = new Set<string>(),
  realRoot?: string
): string[] {
  const realDir = realpathSync.native(dir);
  if (realRoot && !realPathIsSelfOrDescendant(realDir, realRoot)) {
    return [];
  }
  if (visited.has(realDir)) {
    return [];
  }
  visited.add(realDir);
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Keep unpublished documentation out of both the published Docusaurus
      // build and the MCP/docs index.
      if (UNPUBLISHED_DOC_DIRECTORY_NAMES.has(entry.name)) {
        continue;
      }
      let realEntryDir: string;
      try {
        realEntryDir = realpathSync.native(fullPath);
      } catch {
        continue;
      }
      if (realRoot && !realPathIsSelfOrDescendant(realEntryDir, realRoot)) {
        continue;
      }
      files.push(...collectMarkdownFiles(fullPath, visited, realRoot));
      continue;
    }

    if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
      files.push(fullPath);
    }
  }

  return files;
}

function realPathIsSelfOrDescendant(path: string, root: string): boolean {
  const normalizedPath =
    process.platform === 'win32' ? path.toLowerCase() : path;
  const normalizedRoot =
    process.platform === 'win32' ? root.toLowerCase() : root;
  return (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(normalizedRoot + sep)
  );
}

/**
 * Build a single `DocEntry` from a markdown file. Shared by both the
 * legacy {@link loadDocs} (bundled `assetsRoot/docs/<module>/...` layout)
 * and the per-package {@link loadDocsFromPackage} (Phase 2+).
 *
 * `idPrefix` and `pathRoot` decouple the entry's identity (`<prefix>:<path>`)
 * from the actual file location, so per-package layouts can produce stable
 * IDs without leaking package roots into the entry.
 */
function buildEntry(
  filePath: string,
  module: DocModule,
  pathRoot: string,
  source?: DocSource,
  idPrefix: string = module,
  visibility: DocsVisibilityOptions = {}
): DocEntry | undefined {
  const raw = readFileSync(filePath, 'utf-8');
  const frontMatter = parseFrontMatter(raw);
  const registeredFlags = new Set(
    (visibility.registeredFlags ?? []).map((flag) => flag.trim().toLowerCase())
  );
  const enabledFlags = new Set(
    (visibility.enabledFlags ?? []).map((flag) => flag.trim().toLowerCase())
  );
  const documentFlags = Array.isArray(frontMatter.attributes.flags)
    ? frontMatter.attributes.flags
    : typeof frontMatter.attributes.flags === 'string'
      ? [frontMatter.attributes.flags]
      : [];
  for (const flag of documentFlags) {
    const normalized = flag.trim().toLowerCase();
    if (!normalized || !registeredFlags.has(normalized)) {
      throw new Error(
        `${filePath}:1: Unknown documentation feature flag '${flag}'.`
      );
    }
  }
  if (documentFlags.some((flag) => !enabledFlags.has(flag.trim().toLowerCase()))) {
    return undefined;
  }
  const content = resolveDocsMarkdown(frontMatter.body.trim(), {
    ...visibility,
    sourcePath: filePath,
  }).trim();
  if (!content) {
    return undefined;
  }
  const title =
    (typeof frontMatter.attributes.title === 'string'
      ? frontMatter.attributes.title
      : undefined) ??
    extractTitle(content) ??
    basename(filePath, extname(filePath));

  const frontMatterSymbols = frontMatter.attributes.symbols;
  const symbolsFromFrontMatter = Array.isArray(frontMatterSymbols)
    ? frontMatterSymbols
    : typeof frontMatterSymbols === 'string'
      ? [frontMatterSymbols]
      : [];

  const sections = parseSections(content);
  const symbols = new Set<string>([
    ...symbolsFromFrontMatter,
    ...extractSymbolsFromFilename(filePath),
  ]);

  for (const section of sections) {
    for (const symbol of section.symbols) {
      symbols.add(symbol);
    }
  }

  const relativePath = relative(pathRoot, filePath).replace(/\\/g, '/');
  const entry: DocEntry = {
    id: `${idPrefix}:${relativePath}`,
    module,
    path: relativePath,
    title,
    content,
    symbols: [...symbols].filter(Boolean),
    sections,
  };
  if (source) {
    entry.source = source;
  }
  return entry;
}

export function loadDocs(
  assetsRoot: string,
  modules: DocModule[] = DEFAULT_MODULES,
  visibility: DocsVisibilityOptions = {}
): DocEntry[] {
  const entries: DocEntry[] = [];

  for (const moduleName of modules) {
    const moduleRoot = join(assetsRoot, 'docs', moduleName);
    if (!existsSync(moduleRoot)) {
      continue;
    }
    const files = collectMarkdownFiles(moduleRoot);

    for (const filePath of files) {
      const entry = buildEntry(
        filePath,
        moduleName,
        assetsRoot,
        undefined,
        moduleName,
        visibility
      );
      if (entry) {
        entries.push(entry);
      }
    }
  }

  return entries;
}

/**
 * Walk the docs tree of a discovered package and produce {@link DocEntry}
 * items tagged with the package's source metadata.
 *
 * Per design.md, discovered packages have a flat `<packageRoot>/<dir>/`
 * layout (no `/docs/<module>/` nesting). The manifest's `kind` is
 * mapped to a legacy `DocModule` so existing CLI/MCP filters
 * (`--module ts-sdk`) keep working through the migration.
 *
 * **Symlink safety.** The manifest validator in `discovery.ts` rejects
 * `..` segments in the manifest's `dir` string, but a malicious package
 * could still place a symlink at `<packageRoot>/<dir>` or inside that
 * tree pointing to e.g. `/etc/passwd`. We resolve the package root,
 * docs root, walked directories, and every walked file's realpath, then
 * skip anything that escapes the trusted package/docs boundaries.
 */
export function loadDocsFromPackage(
  pkg: DiscoveredPackage,
  visibility: DocsVisibilityOptions = {}
): DocEntry[] {
  const docsRoot = join(pkg.packageRoot, pkg.manifest.dir);
  if (!existsSync(docsRoot)) {
    return [];
  }
  const realPackageRoot = realpathSync.native(pkg.packageRoot);
  const realDocsRoot = realpathSync.native(docsRoot);
  if (!realPathIsSelfOrDescendant(realDocsRoot, realPackageRoot)) {
    return [];
  }
  const module = docKindToModule(pkg.manifest.kind);
  const source: DocSource = {
    module: pkg.manifest.module,
    kind: pkg.manifest.kind,
    packageName: pkg.packageName,
    packageVersion: pkg.packageVersion,
  };
  const files = collectMarkdownFiles(docsRoot, new Set<string>(), realDocsRoot);
  const safe: string[] = [];
  for (const filePath of files) {
    let real: string;
    try {
      real = realpathSync.native(filePath);
    } catch {
      // Broken symlink or missing file by the time we resolve. Skip
      // rather than treating as fatal — discovery is defensive.
      continue;
    }
    // realDocsRoot ends without a trailing separator; require the
    // resolved real path to be `realDocsRoot` itself or a descendant
    // (`realDocsRoot/...`). Reject anything else as a symlink escape.
    if (!realPathIsSelfOrDescendant(real, realDocsRoot)) {
      continue;
    }
    safe.push(filePath);
  }
  return safe.flatMap((filePath) => {
    const entry = buildEntry(
      filePath,
      module,
      docsRoot,
      source,
      pkg.manifest.module,
      visibility
    );
    return entry ? [entry] : [];
  });
}
