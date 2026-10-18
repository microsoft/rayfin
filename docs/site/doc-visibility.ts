import { existsSync, readFileSync, readdirSync } from "fs";
import { extname, join, relative } from "path";

import { getDocFrontmatterFlags } from "@microsoft/rayfin-docs/_internal/site";

function collectMarkdownFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(filePath));
    } else if (
      entry.isFile() &&
      [".md", ".mdx"].includes(extname(entry.name).toLowerCase())
    ) {
      files.push(filePath);
    }
  }
  return files;
}

export function getDocsExcludedByFlags(
  docsRoot: string,
  enabledFlags: readonly string[],
  registeredFlags: readonly string[],
): string[] {
  const enabled = new Set(
    enabledFlags.map((flag) => flag.trim().toLowerCase()),
  );
  const registered = new Set(
    registeredFlags.map((flag) => flag.trim().toLowerCase()),
  );

  return collectMarkdownFiles(docsRoot)
    .filter((filePath) => {
      const flags = getDocFrontmatterFlags(readFileSync(filePath, "utf8"));
      for (const flag of flags) {
        const normalized = flag.trim().toLowerCase();
        if (!normalized || !registered.has(normalized)) {
          throw new Error(
            `${filePath}:1: Unknown documentation feature flag '${flag}'.`,
          );
        }
      }
      return flags.some((flag) => !enabled.has(flag.trim().toLowerCase()));
    })
    .map((filePath) => relative(docsRoot, filePath).replace(/\\/g, "/"));
}
