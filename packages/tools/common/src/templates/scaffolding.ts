import type { TemplateInfo } from './types.js';
import { transformProjectName } from './validation.js';

/**
 * Read template entries from a directory listing.
 *
 * Accepts an abstract FS interface without importing `node:fs` directly,
 * keeping `rayfin-tools-common` universal.
 */
export function readTemplatesFromDirectory(
  directory: string,
  isLocal: boolean,
  fs: TemplateFs
): TemplateInfo[] {
  const templates: TemplateInfo[] = [];
  const entries = fs.readDir(directory);

  for (const entry of entries) {
    const templatePath = fs.joinPath(directory, entry);

    if (!fs.isDirectory(templatePath)) {
      continue;
    }

    const packageJsonPath = fs.joinPath(templatePath, 'package.json');

    if (!fs.exists(packageJsonPath)) {
      continue;
    }

    try {
      const pkgJson = JSON.parse(
        fs.readFile(packageJsonPath)
      ) as TemplatePackageJson;
      const metadata = pkgJson.template;

      if (!metadata) {
        continue;
      }

      templates.push({
        name: metadata.name,
        displayName: metadata.displayName,
        description: metadata.description,
        hidden: metadata.hidden === true,
        path: templatePath,
        packageJson: pkgJson as Record<string, unknown>,
        isLocal,
      });
    } catch {
      // Skip entries with unreadable package.json
    }
  }

  return templates;
}

/** Expose the hidden Universal App through the established blankapp ID. */
export function addBundledTemplateAliases(
  templates: TemplateInfo[]
): TemplateInfo[] {
  const universalApp = templates.find(
    (template) => template.name === 'universal-app'
  );
  if (universalApp === undefined) {
    return templates;
  }

  return [
    ...templates.filter((template) => template.name !== 'blankapp'),
    {
      ...universalApp,
      name: 'blankapp',
      hidden: false,
    },
  ];
}

/**
 * Narrow a template list to the ones a person should be offered.
 *
 * Every menu, quick-pick and listing runs through here. Lookup by name
 * deliberately does not: a hidden template is shipped and supported, just not
 * browsable, so filtering it out of resolution would break the callers it was
 * hidden for.
 */
export function visibleTemplates(templates: TemplateInfo[]): TemplateInfo[] {
  return templates.filter((template) => !template.hidden);
}

/**
 * Apply project-name substitutions to package.json and README.md inside a
 * scaffolded project directory.
 *
 * Pure business logic — callers provide the FS operations.
 */
export function customizeTemplateFiles(
  targetPath: string,
  projectName: string,
  fs: TemplateFs
): void {
  const names = transformProjectName(projectName);

  // Update package.json name field
  const packageJsonPath = fs.joinPath(targetPath, 'package.json');
  if (fs.exists(packageJsonPath)) {
    try {
      const pkgJson = JSON.parse(fs.readFile(packageJsonPath)) as Record<
        string,
        unknown
      >;
      pkgJson.name = names.kebab;
      fs.writeFile(packageJsonPath, JSON.stringify(pkgJson, null, 2) + '\n');
    } catch {
      // Non-fatal — leave package.json as-is
    }
  }

  // Replace mustache-style placeholders in README.md
  const readmePath = fs.joinPath(targetPath, 'README.md');
  if (fs.exists(readmePath)) {
    try {
      let content = fs.readFile(readmePath);
      content = content.replace(/{{PROJECT_NAME}}/g, names.display);
      content = content.replace(/{{PROJECT_NAME_KEBAB}}/g, names.kebab);
      content = content.replace(/{{PROJECT_NAME_PASCAL}}/g, names.pascal);
      fs.writeFile(readmePath, content);
    } catch {
      // Non-fatal
    }
  }
}

// ── FS abstraction ──────────────────────────────────────────────────────

/**
 * Minimal file-system interface required by template operations.
 *
 * Consumers provide platform-specific implementations, such as a Node.js
 * CLI wrapper around `node:fs`.
 */
export interface TemplateFs {
  readDir(path: string): string[];
  readFile(path: string): string;
  writeFile(path: string, content: string): void;
  exists(path: string): boolean;
  isDirectory(path: string): boolean;
  joinPath(...segments: string[]): string;
  copyDir(src: string, dest: string): void;
}

/** Shape of a sample/template package.json with optional `template` metadata. */
interface TemplatePackageJson {
  name?: string;
  description?: string;
  template?: {
    name: string;
    displayName: string;
    description: string;
    hidden?: boolean;
  };
  [key: string]: unknown;
}
