import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { describe, expect, it, afterEach } from 'vitest';

import { DocsService } from '../index.js';
import { loadDocs } from '../loader.js';

function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'rayfin-mcp-docs-'));
  const docsDir = join(root, 'docs');
  const guideDir = join(docsDir, 'guide');
  const hostDir = join(docsDir, 'host');
  const tsSdkDir = join(docsDir, 'ts-sdk');

  mkdirSync(guideDir, { recursive: true });
  mkdirSync(hostDir, { recursive: true });
  mkdirSync(tsSdkDir, { recursive: true });

  writeFileSync(
    join(guideDir, 'index.md'),
    `---
` +
      `title: Guide Home
` +
      `symbols:
` +
      `  - GuideSymbol
` +
      `---
` +
      `# Guide Home
` +
      `## Class: GuideClass
` +
      `Guide details and context.
`
  );

  writeFileSync(
    join(tsSdkDir, 'DataApi.md'),
    `# DataApi
` +
      `## Function: create
` +
      `Creates a client instance.
`
  );

  writeFileSync(
    join(hostDir, 'overview.md'),
    `# Host Overview
` +
      `Host service documentation.
`
  );

  return root;
}

function writeRayfinPackage(
  projectRoot: string,
  version: string,
  content: string
): void {
  const packageRoot = join(
    projectRoot,
    'node_modules',
    '@microsoft',
    'rayfin-core'
  );
  mkdirSync(join(packageRoot, 'assets', 'docs'), { recursive: true });
  writeFileSync(
    join(packageRoot, 'package.json'),
    JSON.stringify({
      name: '@microsoft/rayfin-core',
      version,
      rayfinDocs: {
        version: 1,
        dir: 'assets/docs',
        module: 'rayfin-core',
        kind: 'api-reference',
      },
    })
  );
  writeFileSync(join(packageRoot, 'assets', 'docs', 'index.md'), content);
}

describe('docs loader and service', () => {
  let tempRoot: string | undefined;

  afterEach(() => {
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
  });

  it('loads docs with symbols from frontmatter, headings, and filenames', () => {
    tempRoot = createFixture();
    const entries = loadDocs(tempRoot, ['guide', 'host', 'ts-sdk']);

    const guide = entries.find((entry) => entry.module === 'guide');
    expect(guide).toBeDefined();
    expect(guide?.title).toBe('Guide Home');
    expect(guide?.symbols).toContain('GuideSymbol');
    expect(guide?.symbols).toContain('GuideClass');

    const sdk = entries.find((entry) => entry.module === 'ts-sdk');
    expect(sdk?.symbols).toContain('DataApi');
  });

  it('indexes symbols imported by a doc code sample', () => {
    tempRoot = createFixture();
    writeFileSync(
      join(tempRoot, 'docs', 'ts-sdk', 'client-guide.md'),
      `# Client Guide
` +
        `## Quickstart
` +
        `Use \`RayfinClient\` to connect.
` +
        `
` +
        `\`\`\`typescript
` +
        `import { RayfinClient } from '@microsoft/rayfin-client';
` +
        `\`\`\`
`
    );

    const entries = loadDocs(tempRoot, ['ts-sdk']);

    // `RayfinClient` is documented under a "Quickstart" heading, so the
    // heading alone does not name it — the code sample's import does.
    const guide = entries.find((entry) =>
      entry.path.endsWith('client-guide.md')
    );
    expect(guide?.symbols).toContain('RayfinClient');
  });

  it('lists and retrieves docs by id and path', () => {
    tempRoot = createFixture();
    const service = new DocsService({
      assetsRoot: tempRoot,
      modules: ['guide', 'host', 'ts-sdk'],
    });

    const guideDocs = service.listDocs('guide');
    expect(guideDocs).toHaveLength(1);

    const docById = service.getDocById(guideDocs[0]?.id ?? '');
    expect(docById?.module).toBe('guide');

    const docByPath = service.getDocByPath(guideDocs[0]?.path ?? '');
    expect(docByPath?.id).toBe(docById?.id);
  });

  it('searches docs with snippets and module filtering', () => {
    tempRoot = createFixture();
    const service = new DocsService({
      assetsRoot: tempRoot,
      modules: ['guide', 'host', 'ts-sdk'],
    });

    const results = service.searchDocs('client instance');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.snippet).toContain('client');

    const guideOnly = service.searchDocs('Guide details', 'guide');
    expect(guideOnly.length).toBe(1);
    expect(guideOnly[0]?.module).toBe('guide');
  });

  it('resolves experimental content before every index and retrieval path', () => {
    tempRoot = createFixture();
    const docsDir = join(tempRoot, 'docs', 'guide');
    const flag = 'functions-experimental-auth';
    writeFileSync(
      join(docsDir, 'functions-auth.md'),
      `# Functions authentication

:::experimental{flag=${flag}}

## Function: authenticateBroker

experimentalbrokertoken is available to opted-in builders.
:::else

The standard authentication flow remains available.
:::
`
    );
    const options = {
      assetsRoot: tempRoot,
      modules: ['guide'] as const,
      registeredFlags: [flag],
    };

    const disabled = new DocsService(options);
    const disabledItem = disabled
      .listDocs('guide')
      .find((item) => item.path.endsWith('functions-auth.md'));
    const disabledDoc = disabledItem
      ? disabled.getDocById(disabledItem.id)
      : undefined;
    expect(disabledDoc?.content).not.toContain('experimentalbrokertoken');
    expect(disabled.searchDocs('experimentalbrokertoken')).toHaveLength(0);
    expect(disabled.getSymbolDocs('authenticateBroker')).toHaveLength(0);
    expect(disabledDoc?.content).toContain(
      'The standard authentication flow remains available.'
    );

    const enabled = new DocsService({
      ...options,
      enabledFlags: [flag],
    });
    const enabledItem = enabled
      .listDocs('guide')
      .find((item) => item.path.endsWith('functions-auth.md'));
    const enabledDoc = enabledItem
      ? enabled.getDocById(enabledItem.id)
      : undefined;
    expect(enabledDoc?.content).toContain('experimentalbrokertoken');
    expect(enabled.searchDocs('experimentalbrokertoken')[0]?.snippet).toContain(
      'experimentalbrokertoken'
    );
    expect(enabled.getSymbolDocs('authenticateBroker')).toHaveLength(1);
  });

  it('returns full section content for symbols', () => {
    tempRoot = createFixture();
    const service = new DocsService({
      assetsRoot: tempRoot,
      modules: ['guide', 'host', 'ts-sdk'],
    });

    const symbolResults = service.getSymbolDocs('GuideClass');
    expect(symbolResults.length).toBeGreaterThan(0);
    expect(symbolResults[0]?.content).toContain('Guide details');

    const filenameSymbol = service.getSymbolDocs('DataApi');
    expect(filenameSymbol.length).toBeGreaterThan(0);
    expect(filenameSymbol[0]?.content).toContain('Creates a client instance');
  });

  it('includes guide symbols in default symbol search', () => {
    tempRoot = createFixture();
    const service = new DocsService({
      assetsRoot: tempRoot,
      modules: ['guide', 'host', 'ts-sdk'],
    });

    const results = service.searchDocs('GuideClass', undefined, 10, 'symbols');

    expect(results.some((result) => result.module === 'guide')).toBe(true);
  });

  it('gracefully skips missing module directories', () => {
    tempRoot = createFixture();
    // Remove the host directory to simulate missing dotnet docs
    rmSync(join(tempRoot, 'docs', 'host'), { recursive: true, force: true });

    const entries = loadDocs(tempRoot, ['guide', 'host', 'ts-sdk']);

    expect(entries.filter((e) => e.module === 'guide')).toHaveLength(1);
    expect(entries.filter((e) => e.module === 'ts-sdk')).toHaveLength(1);
    expect(entries.filter((e) => e.module === 'host')).toHaveLength(0);
  });

  it('works when all module directories are missing', () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'rayfin-mcp-docs-empty-'));
    mkdirSync(join(tempRoot, 'docs'), { recursive: true });

    const entries = loadDocs(tempRoot, ['guide', 'host', 'ts-sdk']);
    expect(entries).toHaveLength(0);
  });

  it('throws when constructed with a missing assetsRoot', () => {
    expect(
      () =>
        new DocsService({
          assetsRoot: '',
          modules: ['guide'],
        })
    ).toThrow(/assetsRoot/);
  });

  it('caches discovered package indexes by installed package version', () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'rayfin-docs-cache-'));
    const cacheDir = join(tempRoot, '.cache');
    writeRayfinPackage(tempRoot, '1.0.0', '# Core Docs\n\nalphauniquetoken.');

    const first = new DocsService({
      discover: {
        from: tempRoot,
        candidates: ['@microsoft/rayfin-core'],
      },
      cache: { dir: cacheDir },
    });
    expect(first.searchDocs('alphauniquetoken')).toHaveLength(1);
    const firstCacheFiles = readdirSync(cacheDir);
    expect(firstCacheFiles).toHaveLength(1);

    writeRayfinPackage(tempRoot, '1.0.0', '# Core Docs\n\nbetauniquetoken.');
    const sameVersion = new DocsService({
      discover: {
        from: tempRoot,
        candidates: ['@microsoft/rayfin-core'],
      },
      cache: { dir: cacheDir },
    });
    expect(sameVersion.searchDocs('alphauniquetoken')).toHaveLength(1);
    expect(sameVersion.searchDocs('betauniquetoken')).toHaveLength(0);

    writeRayfinPackage(tempRoot, '1.0.1', '# Core Docs\n\nbetauniquetoken.');
    const newVersion = new DocsService({
      discover: {
        from: tempRoot,
        candidates: ['@microsoft/rayfin-core'],
      },
      cache: { dir: cacheDir },
    });
    expect(newVersion.searchDocs('betauniquetoken')).toHaveLength(1);
    const newVersionCacheFiles = readdirSync(cacheDir);
    expect(newVersionCacheFiles).toHaveLength(1);
    expect(newVersionCacheFiles[0]).not.toBe(firstCacheFiles[0]);
    expect(existsSync(cacheDir)).toBe(true);
  });

  it('keys discovered indexes by the normalized visibility flag set', () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'rayfin-docs-visibility-cache-'));
    const cacheDir = join(tempRoot, '.cache');
    const flag = 'functions-experimental-auth';
    writeRayfinPackage(
      tempRoot,
      '1.0.0',
      `# Core Docs

:::experimental{flag=${flag}}

visibilitycachetoken is only present when enabled.
:::
`
    );
    const shared = {
      discover: {
        from: tempRoot,
        candidates: ['@microsoft/rayfin-core'],
      },
      cache: { dir: cacheDir },
      registeredFlags: [flag],
    };

    const enabled = new DocsService({
      ...shared,
      enabledFlags: [flag],
    });
    expect(enabled.searchDocs('visibilitycachetoken')).toHaveLength(1);
    const cachedIndex = JSON.parse(
      readFileSync(join(cacheDir, readdirSync(cacheDir)[0]!), 'utf8')
    ) as { visibilityFingerprint: string };
    expect(cachedIndex.visibilityFingerprint).toBe(
      JSON.stringify([flag])
    );

    const disabled = new DocsService(shared);
    expect(disabled.searchDocs('visibilitycachetoken')).toHaveLength(0);
  });

  it.each(['preview', 'experimental'])(
    'excludes markdown files under %s directories at any depth',
    (excludedDirectory) => {
      tempRoot = createFixture();
      const excludedDirs = [
        join(tempRoot, 'docs', 'guide', excludedDirectory),
        join(tempRoot, 'docs', 'guide', 'nested', excludedDirectory),
      ];
      for (const excludedDir of excludedDirs) {
        mkdirSync(excludedDir, { recursive: true });
        writeFileSync(
          join(excludedDir, 'excluded.md'),
          `# Excluded content\n\nThis content should not be indexed.\n`
        );
      }

      const entries = loadDocs(tempRoot, ['guide']);
      const excludedEntries = entries.filter((entry) =>
        entry.path.split('/').includes(excludedDirectory)
      );
      expect(excludedEntries).toHaveLength(0);
      expect(entries.filter((e) => e.module === 'guide')).toHaveLength(1);
    }
  );
});
