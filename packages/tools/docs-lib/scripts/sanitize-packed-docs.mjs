import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const requireCommon = createRequire(
  resolve(scriptDir, "../../common/package.json"),
);
const tar = requireCommon("tar");
const { sanitizeDocsMarkdownForPublish } = await import(
  pathToFileURL(resolve(scriptDir, "../dist/visibility.js"))
);
const { getDocFrontmatterFlags, loadDocs } = await import(
  pathToFileURL(resolve(scriptDir, "../dist/loader.js"))
);
const { createDocsIndex, DOCS_DEFAULT_MODULES, serializeDocsIndex } =
  await import(
    pathToFileURL(resolve(scriptDir, "../dist/_internal/build-index.js"))
  );
const { getRegisteredDocsFeatureFlags } = await import(
  pathToFileURL(resolve(scriptDir, "../../common/dist/feature-flags.js"))
);
const registeredFlags = getRegisteredDocsFeatureFlags();
const registeredFlagSet = new Set(registeredFlags);

function collectFiles(directory, predicate, result = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      if (predicate(filePath)) {
        throw new Error(
          `Refusing to publish linked documentation file: ${filePath}`,
        );
      }
      continue;
    }
    if (entry.isDirectory()) {
      collectFiles(filePath, predicate, result);
      continue;
    }
    if (entry.isFile() && predicate(filePath)) {
      result.push(filePath);
    }
  }
  return result;
}

function sanitizeMarkdownFiles(packageRoot) {
  const markdownFiles = collectFiles(packageRoot, (path) =>
    [".md", ".mdx"].includes(extname(path).toLowerCase()),
  );
  for (const filePath of markdownFiles) {
    const markdown = readFileSync(filePath, "utf8");
    for (const flag of getDocFrontmatterFlags(markdown)) {
      const normalized = flag.trim().toLowerCase();
      if (!normalized || !registeredFlagSet.has(normalized)) {
        throw new Error(
          `${filePath.slice(packageRoot.length + 1)}:1: Unknown documentation feature flag '${flag}'.`,
        );
      }
    }
    const sanitized = sanitizeDocsMarkdownForPublish(markdown, {
      registeredFlags,
      sourcePath: filePath.slice(packageRoot.length + 1),
    });
    if (/^\s*:::private\b/m.test(sanitized)) {
      throw new Error(`Private documentation marker remains in ${filePath}.`);
    }
    if (sanitized !== markdown) {
      writeFileSync(filePath, sanitized);
    }
  }
}

function rebuildPrebuiltIndexes(packageRoot) {
  const indexFiles = collectFiles(packageRoot, (path) =>
    path.endsWith("docs.search.json"),
  );
  const modules = [...DOCS_DEFAULT_MODULES];
  for (const indexPath of indexFiles) {
    const assetsRoot = dirname(indexPath);
    const entries = loadDocs(assetsRoot, modules, {
      enabledFlags: [],
      registeredFlags,
    });
    const index = createDocsIndex(entries);
    const prebuilt = serializeDocsIndex(entries, modules, index, []);
    writeFileSync(indexPath, JSON.stringify(prebuilt));
  }
}

export async function sanitizeTarball(tarballPath) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "rayfin-docs-pack-"));
  const stagedTarball = `${tarballPath}.sanitized`;
  try {
    await tar.x({ file: tarballPath, cwd: temporaryDirectory, strict: true });
    const packageRoot = join(temporaryDirectory, "package");
    sanitizeMarkdownFiles(packageRoot);
    rebuildPrebuiltIndexes(packageRoot);
    await tar.c(
      {
        file: stagedTarball,
        cwd: temporaryDirectory,
        gzip: true,
        portable: true,
      },
      ["package"],
    );
    renameSync(stagedTarball, tarballPath);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    rmSync(stagedTarball, { force: true });
  }
}

async function run() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error(
      "Usage: node sanitize-packed-docs.mjs <tarball-or-release-directory>",
    );
  }

  const resolvedInput = resolve(inputPath);
  const tarballs =
    extname(resolvedInput) === ".tgz"
      ? [resolvedInput]
      : readdirSync(resolvedInput)
          .filter((name) => name.endsWith(".tgz"))
          .map((name) => join(resolvedInput, name));
  if (tarballs.length === 0) {
    throw new Error(`No npm tarballs found at ${resolvedInput}.`);
  }

  for (const tarball of tarballs) {
    await sanitizeTarball(tarball);
  }
  console.log(`Sanitized ${tarballs.length} npm package(s).`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await run();
}
