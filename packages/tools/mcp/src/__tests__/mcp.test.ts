import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ToolDefinition = {
  name: string;
  execute: (args: any) => Promise<string>;
};

const mocks = vi.hoisted(() => {
  const createdServers: Array<{
    tools: ToolDefinition[];
    options: Record<string, unknown>;
    startOptions: unknown;
  }> = [];

  class MockFastMCP {
    options: Record<string, unknown>;
    tools: ToolDefinition[] = [];
    startOptions: unknown;

    constructor(options: Record<string, unknown>) {
      this.options = options;
      createdServers.push(this);
    }

    addTool(tool: ToolDefinition) {
      this.tools.push(tool);
    }

    start(options?: unknown) {
      this.startOptions = options;
      return Promise.resolve();
    }
  }

  return {
    MockFastMCP,
    createdServers,
    listDocs: vi.fn(() => [
      {
        id: 'guide:guide/index.md',
        module: 'guide',
        path: 'guide/index.md',
        title: 'Guide',
      },
    ]),
    getDocById: vi.fn(() => ({ id: 'guide:guide/index.md', title: 'Guide' })),
    getDocsByPath: vi.fn(() => [
      { id: 'guide:guide/index.md', title: 'Guide' },
    ]),
    searchDocs: vi.fn(() => [
      {
        id: 'guide:guide/index.md',
        module: 'guide',
        path: 'guide/index.md',
        title: 'Guide',
        snippet: 'Guide content',
        snippetStart: 0,
        snippetEnd: 5,
        score: 1,
        symbols: ['Guide'],
      },
    ]),
    getSymbolDocs: vi.fn(() => [
      {
        symbol: 'Guide',
        entryId: 'guide:guide/index.md',
        module: 'guide',
        path: 'guide/index.md',
        title: 'Guide',
        heading: 'Guide',
        content: 'Guide content',
      },
    ]),
    discoverPackages: vi.fn(() => [
      {
        name: '@microsoft/rayfin-core',
        kind: 'api-reference',
        summary: 'Core SDK docs',
      },
      {
        name: '@microsoft/rayfin-data',
        kind: 'api-reference',
        summary: 'Data SDK docs',
      },
    ]),
    mapDiscoverResult: vi.fn(
      (result: { name: string; kind: string; summary: string }) => ({
        ...result,
        installCommand: `npm install ${result.name}`,
        updateCommand: `npm install ${result.name}@latest`,
      })
    ),
    docsServiceOptions: [] as unknown[],
  };
});

vi.mock('fastmcp', () => ({
  FastMCP: mocks.MockFastMCP,
}));

vi.mock('@microsoft/rayfin-docs', () => ({
  DOCS_CACHE_SKIP_READ: { read: false },
  DOCS_DEFAULT_MODULES: ['guide', 'ts-sdk'] as const,
  DOCS_NO_CACHE_OPTION_DESCRIPTION:
    'Bypass any existing on-disk docs index cache and rebuild from installed package docs.',
  discoverPackages: mocks.discoverPackages,
  mapDiscoverResult: mocks.mapDiscoverResult,
  DocsService: class DocsService {
    constructor(options: unknown) {
      mocks.docsServiceOptions.push(options);
    }
    listDocs = mocks.listDocs;
    getDocById = mocks.getDocById;
    getDocsByPath = mocks.getDocsByPath;
    searchDocs = mocks.searchDocs;
    getSymbolDocs = mocks.getSymbolDocs;
  },
}));

import { createServer, startServer } from '../mcp';

describe('mcp server tools', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mocks.createdServers.length = 0;
    mocks.listDocs.mockClear();
    mocks.getDocById.mockClear();
    mocks.getDocsByPath.mockClear();
    mocks.searchDocs.mockClear();
    mocks.getSymbolDocs.mockClear();
    mocks.discoverPackages.mockClear();
    mocks.mapDiscoverResult.mockClear();
    mocks.docsServiceOptions.length = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('registers documentation tools and executes them', async () => {
    const server = createServer() as unknown as {
      options: Record<string, unknown>;
      tools: ToolDefinition[];
    };
    expect(server.options.name).toBe('Project Rayfin');
    expect(mocks.docsServiceOptions).toHaveLength(0);

    const toolNames = server.tools.map((tool) => tool.name).sort();
    expect(toolNames).toEqual(
      ['get_doc', 'list_docs', 'search_docs', 'discover_packages'].sort()
    );

    const listTool = server.tools.find((tool) => tool.name === 'list_docs');
    const listResult = await listTool?.execute({ module: 'guide' });
    expect(mocks.docsServiceOptions[0]).toMatchObject({
      modules: ['guide', 'ts-sdk'],
      enabledFlags: [],
      registeredFlags: expect.arrayContaining(['storage']),
      discover: {
        from: process.cwd(),
      },
    });
    expect(mocks.listDocs).toHaveBeenCalledWith('guide');
    expect(listResult).toBe(
      JSON.stringify(mocks.listDocs.mock.results[0]?.value)
    );

    const getTool = server.tools.find((tool) => tool.name === 'get_doc');
    await getTool?.execute({ id: 'guide:guide/index.md' });
    await getTool?.execute({ path: 'guide/index.md' });
    expect(mocks.getDocById).toHaveBeenCalled();
    expect(mocks.getDocsByPath).toHaveBeenCalled();

    // Test symbol lookup via get_doc tool
    await getTool?.execute({ symbol: 'Guide' });
    expect(mocks.getSymbolDocs).toHaveBeenCalledWith('Guide', undefined);

    const searchTool = server.tools.find((tool) => tool.name === 'search_docs');
    await searchTool?.execute({ query: 'Guide', module: 'guide', limit: 5 });
    expect(mocks.searchDocs).toHaveBeenCalledWith(
      'Guide',
      'guide',
      5,
      undefined
    );

    const discoverTool = server.tools.find(
      (tool) => tool.name === 'discover_packages'
    );
    const discoverResult = await discoverTool?.execute({
      query: 'core',
      limit: 1,
    });
    expect(mocks.discoverPackages).toHaveBeenCalledWith('core');
    expect(mocks.mapDiscoverResult).toHaveBeenCalledTimes(1);
    expect(JSON.parse(discoverResult ?? '{}')).toEqual({
      items: [
        expect.objectContaining({
          name: '@microsoft/rayfin-core',
          installCommand: 'npm install @microsoft/rayfin-core',
        }),
      ],
      total: 2,
      query: 'core',
    });
  });

  it('passes normalized active documentation flags to DocsService', async () => {
    vi.stubEnv('RAYFIN_FEATURE_FLAGS', ' Storage, PostgreSQL ');
    const server = createServer() as unknown as {
      tools: ToolDefinition[];
    };
    const listTool = server.tools.find((tool) => tool.name === 'list_docs');
    await listTool?.execute({ module: 'guide' });

    expect(mocks.docsServiceOptions[0]).toMatchObject({
      enabledFlags: ['storage', 'postgresql'],
      registeredFlags: expect.arrayContaining(['storage', 'postgresql']),
    });
  });

  it('starts server with stdio transport', async () => {
    await startServer();
    const server = mocks.createdServers[mocks.createdServers.length - 1];
    expect(server?.startOptions).toEqual({ transportType: 'stdio' });
  });

  it('passes cache bypass into DocsService', async () => {
    const server = createServer({ noCache: true }) as unknown as {
      tools: ToolDefinition[];
    };
    const listTool = server.tools.find((tool) => tool.name === 'list_docs');
    await listTool?.execute({ module: 'guide' });
    expect(mocks.docsServiceOptions[0]).toMatchObject({
      cache: { read: false },
    });
  });

  it('creates a fresh DocsService per docs request so live package changes are detected', async () => {
    const server = createServer() as unknown as {
      tools: ToolDefinition[];
    };
    const searchTool = server.tools.find((tool) => tool.name === 'search_docs');

    await searchTool?.execute({ query: 'Guide' });
    await searchTool?.execute({ query: 'Guide' });

    expect(mocks.docsServiceOptions).toHaveLength(2);
  });
});
