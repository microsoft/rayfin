import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { resolve } from 'path';

import type * as Preset from '@docusaurus/preset-classic';
import type { Config } from '@docusaurus/types';
import { themes as prismThemes } from 'prism-react-renderer';

import { getRayfinSiteDocsSources } from './rayfin-docs-sources';
import { getSdkEditUrl, getSiteSettings, tsSdkRouteBasePath } from './site-settings';

const siteSettings = getSiteSettings(process.env);
const docsSources = getRayfinSiteDocsSources().filter(
  (source) => source.kind !== 'host'
);
const apiReferenceSources = docsSources.filter(
  (source) => source.kind === 'api-reference'
);
const nonApiSources = docsSources.filter(
  (source) => source.kind !== 'api-reference'
);
const excludedDocsGlobs = [
  '**/preview/**',
  '**/experimental/**',
];

// Mirror every api-reference package's docs into a single staging dir so all
// SDK docs can be served by ONE plugin instance. This is what lets the
// TypeScript API sidebar render every package as a real collapsible category
// (with chevron) instead of a cross-plugin link.
//
// Source preference per package:
//   1. TypeDoc-generated content at packages/docgen/dist/ts-sdk/@microsoft/<module>/
//      - full API reference (classes, interfaces, type aliases, functions).
//      This is produced by ``rush build`` building @rayfin/docgen, which
//      docs-site depends on so docgen always builds first.
//   2. Hand-written hub at packages/<...>/assets/docs/ as a fallback for
//      packages explicitly allowed to ship without typedoc output (e.g.
//      rayfin-auth-provider-fabric, currently blocked by implicit-any TS
//      errors in src and tracked separately).
//
// Single-writer assumption: this mirror runs synchronously at config-load
// time and destructively rebuilds .ts-sdk-unified. Rush/Docusaurus invokes
// docs-site builds serially per worktree, so concurrent loaders are not a
// concern in practice. If that ever changes (parallel docs build in CI,
// dev-server next to a CI build sharing a worktree), switch to a staged
// directory + atomic rename.
const repoRoot = resolve(__dirname, '..', '..');
const typedocRoot = resolve(
  repoRoot,
  'packages',
  'docgen',
  'dist',
  'ts-sdk',
  '@microsoft'
);
const typedocConfigPath = resolve(
  repoRoot,
  'packages',
  'docgen',
  'typedoc.json'
);

// Derive the set of modules that MUST have TypeDoc output from
// packages/docgen/typedoc.json's entryPoints. Falling back to the
// hand-written hub for any of these masks a docgen regression (empty/skipped
// output) as a smaller-but-passing docs build. Modules NOT in this set are
// allowed to fall back silently - that's the "intentionally not wired" lane.
const typedocRequiredModules = (() => {
  let parsed: { entryPoints?: string[]; entryPointStrategy?: string };
  try {
    // typedoc.json allows line comments; strip them before parsing.
    const raw = readFileSync(typedocConfigPath, 'utf8').replace(
      /^\s*\/\/.*$/gm,
      ''
    );
    parsed = JSON.parse(raw) as {
      entryPoints?: string[];
      entryPointStrategy?: string;
    };
  } catch (err) {
    throw new Error(
      `Failed to read TypeDoc entryPoints from ${typedocConfigPath}: ${String(err)}`
    );
  }
  // The derivation below maps each entryPoint's last path segment to a
  // rayfin-<segment> module name. That only holds when each entryPoint is a
  // package directory, i.e. entryPointStrategy: 'packages'. If someone flips
  // to 'resolve' / 'expand' (or passes file globs), the derivation will
  // silently produce nonsense names and the fail-closed check below would
  // never fire. Reject any other strategy explicitly.
  const strategy = parsed.entryPointStrategy ?? 'resolve';
  if (strategy !== 'packages') {
    throw new Error(
      `TypeDoc entryPointStrategy must be 'packages' for docs-site required-module ` +
        `derivation to be meaningful; got '${strategy}' in ${typedocConfigPath}. ` +
        `Update docs/site/docusaurus.config.ts to derive module names from the new strategy.`
    );
  }
  const required = new Set(
    (parsed.entryPoints ?? []).map((entry) => {
      // Strip trailing separators and empty segments; otherwise a trailing
      // slash derives `rayfin-` (empty suffix) and a glob like `path/*`
      // derives `rayfin-*`.
      const segments = entry.split(/[\\/]/).filter((s) => s.length > 0);
      return `rayfin-${segments[segments.length - 1] ?? ''}`;
    })
  );
  return required;
})();

const tsSdkActiveBaseRegex = siteSettings.tsSdkActiveBaseRegex;
const tsSdkModuleHrefPattern = new RegExp(`/${tsSdkRouteBasePath}/([^/]+)`);
const tsSdkStagingDir = resolve(__dirname, '.ts-sdk-unified');
const tsSdkRepoPathByModule = new Map(
  apiReferenceSources.map((source) => [source.module, source.repositoryPath])
);
// Tracks which modules were mirrored from TypeDoc output (as opposed to the
// hand-written assets/docs hub). Used to suppress "Edit this page" links for
// generated content, which doesn't exist in the source tree.
const tsSdkTypedocBackedModules = new Set<string>();

// Returns true only if the candidate directory exists AND looks like a
// TypeDoc package output: it's a directory AND contains the index.md TypeDoc
// always emits per package. Bare existsSync(dir) accepts an empty directory
// or a non-directory path, which lets a partial/stale TypeDoc regeneration
// (CI killed mid-run, disk full, plugin crash) ship a silently-truncated
// SDK reference. Fail closed instead.
function hasUsableTypedocOutput(dir: string): boolean {
  try {
    if (!statSync(dir).isDirectory()) {
      return false;
    }
  } catch {
    return false;
  }
  // Look for at least one .md file (TypeDoc emits index.md plus per-symbol
  // markdown). Single-level readdir is enough because TypeDoc always writes
  // index.md at the package root.
  try {
    const entries = readdirSync(dir);
    return entries.some((entry) => entry.toLowerCase().endsWith('.md'));
  } catch {
    return false;
  }
}

// Cross-check: every derived required module must correspond to a real
// api-reference source. Catches typos in typedoc.json entryPoints and any
// future drift between the TypeDoc config and the rayfinDocs manifests.
const apiReferenceModules = new Set(apiReferenceSources.map((s) => s.module));
const orphanedRequired = [...typedocRequiredModules].filter(
  (m) => !apiReferenceModules.has(m)
);
if (orphanedRequired.length > 0) {
  throw new Error(
    `TypeDoc entryPoints in ${typedocConfigPath} derive required modules ` +
      `[${orphanedRequired.join(', ')}] that have no matching rayfinDocs api-reference ` +
      `source. Either fix the entryPoint path or add the corresponding rayfinDocs ` +
      `manifest to the package.`
  );
}

rmSync(tsSdkStagingDir, { recursive: true, force: true });
mkdirSync(tsSdkStagingDir, { recursive: true });
for (const source of apiReferenceSources) {
  const target = resolve(tsSdkStagingDir, source.module);
  const typedocSourceDir = resolve(typedocRoot, source.module);
  const hasTypedoc = hasUsableTypedocOutput(typedocSourceDir);
  if (!hasTypedoc && typedocRequiredModules.has(source.module)) {
    throw new Error(
      `Missing or empty TypeDoc output for required module "${source.module}" at ${typedocSourceDir}. ` +
        `This module is listed in packages/docgen/typedoc.json entryPoints, so its generated ` +
        `output must be present (with at least an index.md) before the docs site builds. Run "rush build" (or ` +
        `"cd packages/docgen && npm run build") and try again.`
    );
  }
  const sourceDir = hasTypedoc
    ? typedocSourceDir
    : resolve(__dirname, source.path);
  if (hasTypedoc) {
    tsSdkTypedocBackedModules.add(source.module);
  }
  cpSync(sourceDir, target, {
    recursive: true,
    force: true,
  });
  if (hasTypedoc) {
    // typedoc-plugin-markdown emits a bare "- [](README.md)" entry in the
    // module index even when the TypeDoc readme option is set to 'none',
    // and there is no corresponding README.md sibling in the dist tree.
    // Strip the empty link so Docusaurus doesn't flag it as broken.
    const moduleIndex = resolve(target, 'index.md');
    try {
      const original = readFileSync(moduleIndex, 'utf8');
      const stripped = original
        .replace(/^- \[\]\(README\.md\)\r?\n/gm, '')
        .replace(/^- \[[^\]]*\]\(README\.md\)\r?\n/gm, '');
      if (stripped !== original) {
        writeFileSync(moduleIndex, stripped);
      }
    } catch {
      // index.md is expected to exist (hasUsableTypedocOutput verified it),
      // but if a future TypeDoc layout changes the entry point we silently
      // skip rather than failing the build for cosmetic post-processing.
    }
  }
}
const tsSdkLabelByModule = new Map(
  apiReferenceSources.map((source) => [source.module, source.label])
);

// Explicit landing module so the SDK Reference nav target doesn't drift with
// Rush project discovery order. rayfin-core is the canonical entry point.
const tsApiLandingModule = 'rayfin-core';
const tsApiLandingSource =
  apiReferenceSources.find((s) => s.module === tsApiLandingModule) ??
  apiReferenceSources[0];
const tsApiLandingPath =
  tsApiLandingSource !== undefined
    ? `${tsSdkRouteBasePath}/${tsApiLandingSource.module}`
    : tsSdkRouteBasePath;

const config: Config = {
  title: 'Project Rayfin Documentation',
  favicon: 'img/favicon.ico',

  // Surface a single source-of-truth route for the TypeScript SDK Reference
  // landing page. Both the navbar item and the homepage CTAs read from this
  // so they cannot drift apart - if `rayfin-core` ever disappears from
  // apiReferenceSources, every surface lands on the same fallback module
  // (and the meta assessment catches the disappearance separately).
  customFields: {
    tsApiLandingPath,
    githubUrl: siteSettings.githubUrl,
  },

  future: {
    v4: true,

    faster: {
      swcJsLoader: true,
      swcJsMinimizer: true,
      swcHtmlMinimizer: true,
      lightningCssMinimizer: true,
      mdxCrossCompilerCache: true,

      rspackBundler: true,
    },
  },

  url: siteSettings.url,
  baseUrl: siteSettings.baseUrl,

  organizationName: siteSettings.organizationName,
  projectName: siteSettings.projectName,

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },

  plugins: [
    // Disable Rspack persistent cache to prevent corruption on Windows
    function disableRspackCache() {
      return {
        name: 'disable-rspack-cache',
        configureWebpack() {
          return {
            experiments: {
              cache: false,
            },
            ignoreWarnings: [
              // vscode-languageserver-types UMD bundle uses dynamic require
              { module: /vscode-languageserver-types/ },
            ],
          };
        },
      };
    },
    ...nonApiSources.map((source) => [
      '@docusaurus/plugin-content-docs',
      {
        id: source.id,
        path: source.path,
        routeBasePath: source.routeBasePath,
        editUrl: ({ docPath }) =>
          siteSettings.editUrl(source.repositoryPath, docPath),
        exclude: excludedDocsGlobs,
      },
    ]),
    apiReferenceSources.length > 0 && [
      '@docusaurus/plugin-content-docs',
      {
        id: 'ts-sdk',
        path: '.ts-sdk-unified',
        routeBasePath: tsSdkRouteBasePath,
        editUrl: ({ docPath }) =>
          getSdkEditUrl(
            siteSettings,
            docPath,
            tsSdkRepoPathByModule,
            tsSdkTypedocBackedModules
          ),
        exclude: excludedDocsGlobs,
        sidebarItemsGenerator: async ({
          defaultSidebarItemsGenerator,
          ...args
        }: {
          defaultSidebarItemsGenerator: (
            args: unknown
          ) => Promise<Array<Record<string, unknown>>>;
        } & Record<string, unknown>) => {
          const autoItems = await defaultSidebarItemsGenerator(args);
          // Default generator yields one item per module dir at the top level:
          //   - multi-doc packages -> { type: 'category', label: '<module>', ... }
          //   - single-doc packages -> { type: 'doc', id: '<module>/index', ... }
          // Relabel each to the package's '@microsoft/...' name and wrap them
          // all under a single "TypeScript API" parent. Also prettify the
          // TypeDoc-generated subcategory labels (classes -> Classes etc.)
          // recursively beneath each module.
          const prettifyTypeDocLabel = (label: string): string =>
            label
              .split('-')
              .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
              .join(' ');

          // TypeDoc emits page titles like `ClaimRef\<T\>` (when
          // useHTMLEncodedBrackets is false) or `ClaimRef&lt;T&gt;` (when
          // true). Docusaurus resolves doc labels from the H1 at render
          // time, so the backslash- or entity-escapes leak into sidebar
          // and breadcrumb text. Set an explicit label from the doc id's
          // basename - the typedoc filename (e.g. `ClaimRef.md`) is always
          // the clean symbol name without generic params. The body H1
          // still shows the generics correctly.
          const cleanLeafLabel = (item: Record<string, unknown>): Record<string, unknown> => {
            if (item.type === 'doc' && typeof item.id === 'string') {
              const basename = item.id.split('/').pop();
              if (basename && basename !== 'index') {
                return { ...item, label: basename };
              }
            }
            return item;
          };

          const prettifyTree = (item: Record<string, unknown>): Record<string, unknown> => {
            if (item.type === 'category') {
              const next: Record<string, unknown> = { ...item };
              if (typeof item.label === 'string') {
                next.label = prettifyTypeDocLabel(item.label);
              }
              if (Array.isArray(item.items)) {
                next.items = (item.items as Array<Record<string, unknown>>).map(
                  prettifyTree
                );
              }
              return next;
            }
            return cleanLeafLabel(item);
          };

          const moduleItems = autoItems.map((item) => {
            let module: string | undefined;
            if (item.type === 'category') {
              if (
                typeof item.label === 'string' &&
                tsSdkLabelByModule.has(item.label)
              ) {
                module = item.label;
              } else {
                const link = item.link as
                  | { type?: string; id?: string }
                  | undefined;
                if (typeof link?.id === 'string') {
                  module = link.id.split('/')[0];
                }
                if (!module && Array.isArray(item.items) && item.items.length) {
                  const first = item.items[0] as Record<string, unknown>;
                  if (first.type === 'doc' && typeof first.id === 'string') {
                    module = first.id.split('/')[0];
                  }
                }
              }
            } else if (item.type === 'doc' && typeof item.id === 'string') {
              module = item.id.split('/')[0];
            } else if (item.type === 'link' && typeof item.href === 'string') {
              const match = item.href.match(tsSdkModuleHrefPattern);
              module = match?.[1];
            } else if (item.type === 'ref' && typeof item.id === 'string') {
              module = (item.id as string).split('/')[0];
            }
            // Prettify the TypeDoc subtree under each module (Classes,
            // Interfaces, Type Aliases, ...). Don't prettify the module's
            // own label - we override that below to the @microsoft/... name.
            let result: Record<string, unknown> = item;
            if (item.type === 'category' && Array.isArray(item.items)) {
              result = {
                ...item,
                items: (item.items as Array<Record<string, unknown>>).map(
                  prettifyTree
                ),
              };
            }
            if (module && tsSdkLabelByModule.has(module)) {
              return {
                ...result,
                label: tsSdkLabelByModule.get(module),
              };
            }
            return result;
          });
          return [
            {
              type: 'category',
              label: 'TypeScript API',
              collapsible: true,
              collapsed: false,
              items: moduleItems,
            },
          ];
        },
      },
    ],
    [
      require.resolve('docusaurus-lunr-search'),
      {
        languages: ['en'],
      },
    ],
  ],

  themes: ['@docusaurus/theme-mermaid'],

  presets: [
    [
      '@docusaurus/preset-classic',
      {
        docs: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    docs: {
      sidebar: {
        hideable: true,
        autoCollapseCategories: true,
      },
    },
    navbar: {
      title: 'Project Rayfin',
      hideOnScroll: true,
      logo: {
        alt: 'Project Rayfin Logo',
        src: 'img/rayfin.png',
      },
      items: [
        {
          to: 'docs/guide',
          label: 'Guide',
          position: 'left',
        },
        {
          to: tsApiLandingPath,
          label: 'SDK Reference',
          position: 'left',
          activeBaseRegex: tsSdkActiveBaseRegex,
        },
        {
          type: 'search',
          position: 'right',
        },
        {
          href: siteSettings.githubUrl,
          position: 'right',
          html: '<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" aria-label="GitHub" style="display: block;"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>',
        },
      ],
    },
    footer: {
      style: 'light',
      copyright: `Copyright © ${new Date().getFullYear()} Project Rayfin.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    // announcementBar: {
    //   id: 'join_the_preview',
    //   content:
    //     'Announcing Private Preview of Project Rayfin! <a target="_blank" rel="noopener noreferrer" href="https://aka.ms/rayfin-signup">Sign up now</a> to be among the first to try it out.',
    //   backgroundColor: '#064000',
    //   textColor: '#ebebeb',
    //   isCloseable: false,
    // },
  } satisfies Preset.ThemeConfig,
};

export default config;
