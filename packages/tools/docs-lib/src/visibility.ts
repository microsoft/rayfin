import { unified } from "unified";
import remarkDirective from "remark-directive";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";

export interface DocsVisibilityOptions {
  enabledFlags?: readonly string[];
  registeredFlags?: readonly string[];
  sourcePath?: string;
}

interface Position {
  start: { line: number };
  end: { line: number; column: number };
}

interface MarkdownNode {
  type: string;
  name?: string;
  attributes?: Record<string, string | null>;
  children?: MarkdownNode[];
  position?: Position;
}

interface MarkdownRoot extends MarkdownNode {
  type: "root";
  children: MarkdownNode[];
}

function normalizeFlag(name: string): string {
  return name.trim().toLowerCase();
}

function nodeLine(node: MarkdownNode): number {
  return node.position?.start.line ?? 1;
}

function fail(sourcePath: string, line: number, message: string): never {
  throw new Error(`${sourcePath}:${line}: ${message}`);
}

function collectDirectiveLines(
  node: MarkdownNode,
  names: Set<string>,
  codeLines: Set<number>,
): void {
  if (node.type === "code" || node.type === "codeBlock") {
    for (
      let line = node.position?.start.line ?? 1;
      line <= (node.position?.end.line ?? line);
      line += 1
    ) {
      codeLines.add(line);
    }
  }
  if (
    node.type === "containerDirective" &&
    ["experimental", "private", "else"].includes(node.name ?? "")
  ) {
    names.add(`${nodeLine(node)}:${node.name}`);
  }
  for (const child of node.children ?? []) {
    collectDirectiveLines(child, names, codeLines);
  }
}

function hasVisibilityDirective(node: MarkdownNode): boolean {
  return (
    (node.type === "containerDirective" &&
      ["experimental", "private", "else"].includes(node.name ?? "")) ||
    (node.children ?? []).some(hasVisibilityDirective)
  );
}

function countDirectives(
  nodes: MarkdownNode[],
  name: string,
  found: MarkdownNode[] = [],
): MarkdownNode[] {
  for (const node of nodes) {
    if (node.type === "containerDirective" && node.name === name) {
      found.push(node);
    }
    countDirectives(node.children ?? [], name, found);
  }
  return found;
}

function validateMarkerParsing(
  source: string,
  root: MarkdownRoot,
  sourcePath: string,
): void {
  const recognized = new Set<string>();
  const codeLines = new Set<number>();
  collectDirectiveLines(root, recognized, codeLines);
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    if (codeLines.has(lineNumber)) {
      continue;
    }
    const match = lines[index]?.match(/^\s*:::(experimental|private|else)\b/);
    if (match && !recognized.has(`${lineNumber}:${match[1]}`)) {
      fail(sourcePath, lineNumber, `Malformed :::${match[1]} marker.`);
    }
  }
}

function containsGatingDirective(node: MarkdownNode): boolean {
  if (
    node.type === "containerDirective" &&
    ["experimental", "private"].includes(node.name ?? "")
  ) {
    return true;
  }
  return (node.children ?? []).some(containsGatingDirective);
}

function endMarkerLine(
  node: MarkdownNode,
  sourceLines: string[],
  sourcePath: string,
): number {
  const end = node.position?.end;
  const line = end?.line ?? nodeLine(node);
  if (end?.column === 1 || sourceLines[line - 1]?.trim() !== ":::") {
    fail(sourcePath, nodeLine(node), `Unclosed :::${node.name} region.`);
  }
  return line;
}

function resolveChildren(
  nodes: MarkdownNode[],
  options: Required<Pick<DocsVisibilityOptions, "sourcePath">> & {
    enabledFlags: Set<string>;
    registeredFlags: Set<string>;
    sourceLines: string[];
    inGatingRegion: boolean;
    preserveExperimental: boolean;
  },
): MarkdownNode[] {
  const resolved: MarkdownNode[] = [];
  for (const node of nodes) {
    if (node.type !== "containerDirective") {
      if (node.children) {
        node.children = resolveChildren(node.children, options);
      }
      resolved.push(node);
      continue;
    }

    const name = node.name ?? "";
    if (name === "else") {
      fail(
        options.sourcePath,
        nodeLine(node),
        ":::else must be inside :::experimental.",
      );
    }
    if (name !== "experimental" && name !== "private") {
      if (node.children) {
        node.children = resolveChildren(node.children, options);
      }
      resolved.push(node);
      continue;
    }

    const line = nodeLine(node);
    if (options.inGatingRegion) {
      fail(
        options.sourcePath,
        line,
        `Nested :::${name} regions are not supported.`,
      );
    }
    endMarkerLine(node, options.sourceLines, options.sourcePath);

    const children = node.children ?? [];
    const allElseNodes = countDirectives(children, "else");
    if (allElseNodes.length > 1) {
      fail(
        options.sourcePath,
        nodeLine(allElseNodes[1]!),
        "Only one :::else is allowed.",
      );
    }
    const elseNodes = children.filter(
      (child) => child.type === "containerDirective" && child.name === "else",
    );
    if (name === "private" && elseNodes.length > 0) {
      fail(
        options.sourcePath,
        nodeLine(elseNodes[0]!),
        ":::private does not support :::else.",
      );
    }
    if (children.some(containsGatingDirective)) {
      const nested = children.find(containsGatingDirective)!;
      fail(
        options.sourcePath,
        nodeLine(nested),
        `Nested :::${nested.name ?? "experimental"} regions are not supported.`,
      );
    }

    const attributes = node.attributes ?? {};
    const flagNames = Object.keys(attributes);
    const flag = attributes.flag;
    const openingLine = options.sourceLines[line - 1] ?? "";
    const flagOccurrences = openingLine.match(/\bflag\s*=/g) ?? [];
    if (
      flagNames.length !== 1 ||
      flagOccurrences.length !== 1 ||
      typeof flag !== "string" ||
      !flag.trim()
    ) {
      fail(
        options.sourcePath,
        line,
        `:::${name} requires exactly one non-empty flag attribute.`,
      );
    }
    const normalized = normalizeFlag(flag);
    if (!options.registeredFlags.has(normalized)) {
      fail(
        options.sourcePath,
        line,
        `Unknown documentation feature flag '${flag}'.`,
      );
    }

    if (name === "private") {
      continue;
    }
    if (options.preserveExperimental) {
      resolved.push(node);
      continue;
    }

    const elseNode = elseNodes[0];
    const primary = elseNode
      ? children.slice(0, children.indexOf(elseNode))
      : children;
    const fallback = elseNode?.children ?? [];
    const selected = options.enabledFlags.has(normalized) ? primary : fallback;
    resolved.push(
      ...resolveChildren(selected, { ...options, inGatingRegion: true }),
    );
  }
  return resolved;
}

export function resolveDocsAst(
  root: MarkdownRoot,
  source: string,
  options: DocsVisibilityOptions = {},
): void {
  transformDocsAst(root, source, options, false);
}

function transformDocsAst(
  root: MarkdownRoot,
  source: string,
  options: DocsVisibilityOptions,
  preserveExperimental: boolean,
): void {
  const sourcePath = options.sourcePath ?? "<markdown>";
  validateMarkerParsing(source, root, sourcePath);

  const enabledFlags = new Set(
    (options.enabledFlags ?? []).map(normalizeFlag).filter(Boolean),
  );
  const registeredFlags = new Set(
    (options.registeredFlags ?? []).map(normalizeFlag).filter(Boolean),
  );
  root.children = resolveChildren(root.children, {
    sourcePath,
    enabledFlags,
    registeredFlags,
    sourceLines: source.split(/\r?\n/),
    inGatingRegion: false,
    preserveExperimental,
  });
}

export function resolveDocsMarkdown(
  markdown: string,
  options: DocsVisibilityOptions = {},
): string {
  const processor = unified().use(remarkParse).use(remarkDirective);
  const parsed = processor.parse(markdown);
  const root = parsed as MarkdownRoot;
  if (!hasVisibilityDirective(root)) {
    validateMarkerParsing(markdown, root, options.sourcePath ?? "<markdown>");
    return markdown;
  }
  resolveDocsAst(root, markdown, options);
  const stringify = unified().use(remarkStringify);
  return String(stringify.stringify(parsed));
}

export function sanitizeDocsMarkdownForPublish(
  markdown: string,
  options: DocsVisibilityOptions = {},
): string {
  const processor = unified().use(remarkParse).use(remarkDirective);
  const parsed = processor.parse(markdown);
  const root = parsed as MarkdownRoot;
  if (!hasVisibilityDirective(root)) {
    validateMarkerParsing(markdown, root, options.sourcePath ?? "<markdown>");
    return markdown;
  }
  transformDocsAst(root, markdown, options, true);
  return String(
    unified().use(remarkDirective).use(remarkStringify).stringify(parsed),
  );
}

export function remarkDocsVisibility(
  options: DocsVisibilityOptions = {},
): (root: MarkdownRoot, file: { path?: string; value?: unknown }) => void {
  return (root, file) => {
    resolveDocsAst(root, String(file.value ?? ""), {
      ...options,
      sourcePath: options.sourcePath ?? file.path ?? "<markdown>",
    });
  };
}

export { remarkDirective };
