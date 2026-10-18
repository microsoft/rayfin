import { createRequire } from 'module';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

import { discoverPackages, mapDiscoverResult } from '@microsoft/rayfin-docs';
import {
  DOCS_CACHE_SKIP_READ,
  DOCS_DEFAULT_MODULES,
  DocsService,
  type DocModule,
} from '@microsoft/rayfin-docs';
import {
  FEATURE_FLAGS_ENV_VAR,
  getRegisteredDocsFeatureFlags,
  parseFeatureFlags,
} from '@microsoft/rayfin-tools-common/_internal';
import { FastMCP } from 'fastmcp';
import { z } from 'zod';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version?: string };
const serverVersion = (pkg.version ??
  '1.0.0') as `${number}.${number}.${number}`;

/**
 * All `DocModule` values the MCP server can expose. Mirrors the union exported
 * from `@microsoft/rayfin-docs` — used as the source of truth for the zod
 * schema and for the `--host-docs` host-only selection.
 */
const ALL_DOC_MODULES = [
  'guide',
  'host',
  'ts-sdk',
] as const satisfies readonly DocModule[];

export function createServer(options?: {
  modules?: readonly DocModule[];
  noCache?: boolean;
}) {
  // Describe the actually-loaded set so tool descriptions don't claim
  // the full module union when the server was started with the default
  // builder set and host docs are unavailable.
  const loadedModules: readonly DocModule[] = options?.modules?.length
    ? [...options.modules]
    : DOCS_DEFAULT_MODULES;
  const modulesDesc = loadedModules.join(' | ');

  const server = new FastMCP({
    name: 'Project Rayfin',
    version: serverVersion,
    instructions: `Project Rayfin docs MCP. Loaded modules: ${modulesDesc}. Tools: list_docs, get_doc, search_docs, discover_packages.`,
  });

  const docsServiceOptions = {
    modules: loadedModules,
    enabledFlags: [
      ...parseFeatureFlags(
        new Map([
          [FEATURE_FLAGS_ENV_VAR, process.env[FEATURE_FLAGS_ENV_VAR] ?? ''],
        ])
      ),
    ],
    registeredFlags: getRegisteredDocsFeatureFlags(),
    ...(options?.noCache === true ? { cache: DOCS_CACHE_SKIP_READ } : {}),
    discover: {
      // The MCP server is launched by an MCP host (Cursor, Copilot,
      // Claude Desktop) with cwd typically set to the user's project.
      // Walk node_modules from there so docs are version-locked to the
      // packages the project actually installed.
      from: process.cwd(),
    },
  };
  const getDocsService = () => new DocsService(docsServiceOptions);
  const moduleSchema = z.enum(ALL_DOC_MODULES);
  const scopeSchema = z.enum(['docs', 'symbols', 'all']);

  server.addTool({
    annotations: {
      openWorldHint: false,
      readOnlyHint: true,
      title: 'List Rayfin Docs',
    },
    description: `List available documentation entries (module: ${modulesDesc}).`,
    execute: async (args) => {
      const docsService = getDocsService();
      const entries = docsService.listDocs(args.module);
      return JSON.stringify(entries);
    },
    name: 'list_docs',
    parameters: z.object({
      module: moduleSchema
        .optional()
        .describe(`Optional module filter: ${modulesDesc}.`),
    }),
  });

  server.addTool({
    annotations: {
      openWorldHint: false,
      readOnlyHint: true,
      title: 'Get Rayfin Doc',
    },
    description:
      'Fetch doc by id/path or resolve symbol (module filter, limit).',
    execute: async (args) => {
      const docsService = getDocsService();
      const provided = [args.id, args.path, args.symbol].filter(Boolean);
      if (provided.length === 0) {
        return JSON.stringify({
          error: 'Provide exactly one of id, path, or symbol.',
        });
      }
      if (provided.length > 1) {
        return JSON.stringify({
          error: 'get_doc accepts only one of id, path, or symbol per call.',
        });
      }

      if (args.symbol) {
        const symbolResults = docsService.getSymbolDocs(
          args.symbol,
          args.module
        );
        const limited = args.limit
          ? symbolResults.slice(0, args.limit)
          : symbolResults;
        return JSON.stringify(
          limited.length
            ? limited
            : {
                error: 'Symbol not found.',
              }
        );
      }

      let entry = args.id ? docsService.getDocById(args.id) : undefined;
      if (!entry && args.path) {
        const matches = docsService.getDocsByPath(args.path, args.module);
        if (matches.length > 1) {
          return JSON.stringify({
            error: 'Doc path is ambiguous. Use id instead.',
            matches: matches.map((match) => match.id),
          });
        }
        entry = matches[0];
      }

      return JSON.stringify(
        entry ?? {
          error: 'Doc not found.',
        }
      );
    },
    name: 'get_doc',
    parameters: z.object({
      id: z.string().optional().describe('Doc id (module:path).'),
      path: z.string().optional().describe('Doc path relative to assets.'),
      symbol: z
        .string()
        .optional()
        .describe('Symbol name (class/function/type/etc).'),
      module: moduleSchema
        .optional()
        .describe(
          `Optional module filter for path or symbol lookup: ${modulesDesc}.`
        ),
      limit: z
        .number()
        .int()
        .positive()
        .max(50)
        .optional()
        .describe('Max symbol results (<=50).'),
    }),
  });

  server.addTool({
    annotations: {
      openWorldHint: false,
      readOnlyHint: true,
      title: 'Search Docs',
    },
    description: `Search docs/symbols/all with snippets (module: ${modulesDesc}).`,
    execute: async (args) => {
      const docsService = getDocsService();
      const results = docsService.searchDocs(
        args.query,
        args.module,
        args.limit,
        args.scope
      );
      return JSON.stringify(results);
    },
    name: 'search_docs',
    parameters: z.object({
      query: z.string().describe('Search query.'),
      module: moduleSchema
        .optional()
        .describe(`Optional module filter: ${modulesDesc}.`),
      scope: scopeSchema
        .optional()
        .describe("Search scope: 'docs' | 'symbols' | 'all' (default docs)."),
      limit: z
        .number()
        .int()
        .positive()
        .max(50)
        .optional()
        .describe('Max results (<=50).'),
    }),
  });

  server.addTool({
    annotations: {
      openWorldHint: false,
      readOnlyHint: true,
      title: 'Discover Rayfin Packages',
    },
    description:
      'Call this tool when `search_docs` returned no relevant results. It surfaces install recommendations for Rayfin packages the user has not installed, and update recommendations when an installed package may be too old for the requested feature. Returns a ranked list with name, kind, summary, install command, and update command.',
    execute: async (args) => {
      const results = discoverPackages(args.query);
      const total = results.length;
      const limited = results.slice(0, args.limit ?? 10);
      const items = limited.map(mapDiscoverResult);
      return JSON.stringify({
        items,
        total,
        query: args.query,
      });
    },
    name: 'discover_packages',
    parameters: z.object({
      query: z
        .string()
        .min(1)
        .describe(
          'Free-form search query. Matches against package names, kinds (sdk/tool/guide/host/sample), curated topics, and summaries.'
        ),
      limit: z
        .number()
        .int()
        .positive()
        .max(50)
        .optional()
        .describe('Max results (<=50, default 10).'),
    }),
  });

  return server;
}

export async function startServer(options?: {
  modules?: readonly DocModule[];
  noCache?: boolean;
}) {
  const server = createServer(options);
  await server.start({ transportType: 'stdio' });
  return server;
}

const isDirectRun = (() => {
  try {
    const thisFile = fileURLToPath(import.meta.url);
    const argv1 = process.argv[1] ? resolve(process.argv[1]) : '';
    return thisFile === argv1;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  startServer().catch((err) => {
    console.error('Failed to start MCP server:', err);
    process.exit(1);
  });
}
