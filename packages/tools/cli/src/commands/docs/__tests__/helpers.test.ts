/**
 * Tests for `helpers.ts` — flag parsing, JSON envelope shape, and the
 * `handleDocsCommandError` mode-aware emitter. Tests use the test-only
 * `setDocsServiceForTesting` to inject a stub `DocsService` so we
 * exercise the helper logic without loading the real corpus.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { CliHandledError } from '../../../errors.js';
import {
  DOCS_JSON_SCHEMA_VERSION,
  DOC_MODULES,
  DOC_SCOPES,
  getDocsService,
  handleDocsCommandError,
  jsonOk,
  parseLimitFlag,
  parseModuleFlag,
  parseScopeFlag,
  resetDocsServiceForTesting,
} from '../helpers.js';

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

describe('parseModuleFlag', () => {
  afterEach(() => {
    resetDocsServiceForTesting();
  });

  it('returns undefined when no value is provided', () => {
    expect(parseModuleFlag(undefined)).toBeUndefined();
  });

  it.each(DOC_MODULES)('accepts known module %s', (mod) => {
    expect(parseModuleFlag(mod)).toBe(mod);
  });

  it('rejects an unknown module with a fix-it hint', () => {
    // Throws plain Error (not CliHandledError) so the action handler's
    // `handleDocsCommandError` is the single point that prints + wraps.
    // Throwing CliHandledError directly would silently swallow the message
    // because the top-level handler suppresses its print.
    expect(() => parseModuleFlag('cli')).toThrow(Error);
    expect(() => parseModuleFlag('cli')).not.toThrow(CliHandledError);
    try {
      parseModuleFlag('cli');
    } catch (err) {
      expect((err as Error).message).toContain("Unknown module 'cli'");
      expect((err as Error).message).toContain('guide, host, ts-sdk');
    }
  });
});

describe('getDocsService', () => {
  let tempRoot: string | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetDocsServiceForTesting();
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
  });

  it('bypasses process memoization for --no-cache so repeated calls rebuild from installed docs', () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'rayfin-cli-docs-'));
    const cacheDir = join(tempRoot, '.cache');
    vi.spyOn(process, 'cwd').mockReturnValue(tempRoot);

    writeRayfinPackage(tempRoot, '1.0.0', '# Core Docs\n\nalphauniquetoken.');
    const first = getDocsService(undefined, { noCache: true, cacheDir });
    expect(first.searchDocs('alphauniquetoken')).toHaveLength(1);

    writeRayfinPackage(tempRoot, '1.0.0', '# Core Docs\n\nbetauniquetoken.');
    const second = getDocsService(undefined, { noCache: true, cacheDir });
    expect(second.searchDocs('betauniquetoken')).toHaveLength(1);
    expect(second.searchDocs('alphauniquetoken')).toHaveLength(0);
  });

  it('uses the current project cwd so global CLI invocations see project-local docs', () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'rayfin-cli-projects-'));
    const appA = join(tempRoot, 'app-a');
    const appB = join(tempRoot, 'app-b');
    writeRayfinPackage(appA, '1.20.0', '# App A Core\n\ncliappatoken.');
    writeRayfinPackage(appB, '1.26.0', '# App B Core\n\ncliappbtoken.');

    const cwdSpy = vi.spyOn(process, 'cwd');
    cwdSpy.mockReturnValue(appA);
    const serviceA = getDocsService(undefined, {
      noCache: true,
      cacheDir: join(appA, '.cache'),
    });
    expect(serviceA.searchDocs('cliappatoken')).toHaveLength(1);
    expect(serviceA.searchDocs('cliappbtoken')).toHaveLength(0);

    cwdSpy.mockReturnValue(appB);
    const serviceB = getDocsService(undefined, {
      noCache: true,
      cacheDir: join(appB, '.cache'),
    });
    expect(serviceB.searchDocs('cliappbtoken')).toHaveLength(1);
    expect(serviceB.searchDocs('cliappatoken')).toHaveLength(0);
  });

  it('filters inline experimental content using RAYFIN_FEATURE_FLAGS', () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'rayfin-cli-flags-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tempRoot);
    writeRayfinPackage(
      tempRoot,
      '1.0.0',
      `# Core Docs

:::experimental{flag=storage}

gateduniquetoken.
:::else

fallbackuniquetoken.
:::
`
    );

    vi.stubEnv('RAYFIN_FEATURE_FLAGS', ' Storage ');
    const enabled = getDocsService(undefined, {
      noCache: true,
      cacheDir: join(tempRoot, 'cache'),
    });
    expect(enabled.searchDocs('gateduniquetoken')).toHaveLength(1);
    expect(enabled.searchDocs('fallbackuniquetoken')).toHaveLength(0);

    vi.stubEnv('RAYFIN_FEATURE_FLAGS', '');
    const disabled = getDocsService(undefined, {
      noCache: true,
      cacheDir: join(tempRoot, 'cache'),
    });
    expect(disabled.searchDocs('gateduniquetoken')).toHaveLength(0);
    expect(disabled.searchDocs('fallbackuniquetoken')).toHaveLength(1);
  });
});

describe('parseScopeFlag', () => {
  it('returns undefined when no value is provided', () => {
    expect(parseScopeFlag(undefined)).toBeUndefined();
  });

  it.each(DOC_SCOPES)('accepts known scope %s', (scope) => {
    expect(parseScopeFlag(scope)).toBe(scope);
  });

  it('rejects an unknown scope with a fix-it hint', () => {
    expect(() => parseScopeFlag('everything')).toThrow(Error);
    expect(() => parseScopeFlag('everything')).not.toThrow(CliHandledError);
    try {
      parseScopeFlag('everything');
    } catch (err) {
      expect((err as Error).message).toContain("Unknown scope 'everything'");
      expect((err as Error).message).toContain('docs, symbols, all');
    }
  });
});

describe('parseLimitFlag', () => {
  it('returns undefined when no value is provided', () => {
    expect(parseLimitFlag(undefined)).toBeUndefined();
  });

  it.each(['1', '10', '50'])('accepts in-range integer %s', (value) => {
    expect(parseLimitFlag(value)).toBe(Number(value));
  });

  it.each(['0', '51', '-1', 'abc', '1.5', ''])(
    'rejects out-of-range or non-integer %s',
    (value) => {
      expect(() => parseLimitFlag(value)).toThrow(Error);
      expect(() => parseLimitFlag(value)).not.toThrow(CliHandledError);
    }
  );
});

describe('jsonOk envelope', () => {
  it('stamps status=ok and the current schemaVersion', () => {
    const wrapped = jsonOk({ items: [1, 2, 3] });
    expect(wrapped).toEqual({
      status: 'ok',
      schemaVersion: DOCS_JSON_SCHEMA_VERSION,
      items: [1, 2, 3],
    });
  });

  it('preserves the payload key/value shape verbatim', () => {
    const wrapped = jsonOk({ query: 'foo', count: 0, results: [] });
    expect(wrapped.query).toBe('foo');
    expect(wrapped.count).toBe(0);
    expect(wrapped.results).toEqual([]);
  });

  it('schema version is 1 (document the contract)', () => {
    expect(DOCS_JSON_SCHEMA_VERSION).toBe(1);
  });
});

describe('handleDocsCommandError', () => {
  it('emits a JSON error envelope to stdout in json mode and throws CliHandledError', () => {
    const stdout = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);

    expect(() => handleDocsCommandError('json', new Error('boom'))).toThrow(
      CliHandledError
    );

    const calls = stdout.mock.calls.map((call) => String(call[0]));
    expect(calls.length).toBeGreaterThan(0);
    const payload = JSON.parse(calls.join('')) as Record<string, unknown>;
    expect(payload).toEqual({
      status: 'error',
      schemaVersion: DOCS_JSON_SCHEMA_VERSION,
      error: 'boom',
    });
    stdout.mockRestore();
  });

  it('prints a human-readable error to stderr in text mode and throws CliHandledError', () => {
    const stderr = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const stdout = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);

    expect(() => handleDocsCommandError('plain', new Error('kaboom'))).toThrow(
      CliHandledError
    );

    expect(stderr).toHaveBeenCalledTimes(1);
    expect(String(stderr.mock.calls[0][0])).toContain('rayfin docs failed');
    expect(String(stderr.mock.calls[0][0])).toContain('kaboom');
    expect(stdout).not.toHaveBeenCalled();
    stderr.mockRestore();
    stdout.mockRestore();
  });

  it('re-throws CliHandledError verbatim without printing again', () => {
    const stderr = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const stdout = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    const original = new CliHandledError(new Error('already-printed'));

    expect(() => handleDocsCommandError('json', original)).toThrow(original);

    expect(stderr).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
    stderr.mockRestore();
    stdout.mockRestore();
  });

  it('normalizes non-Error throws (string / undefined) into a CliHandledError-wrapped Error', () => {
    const stdout = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);

    expect(() => handleDocsCommandError('json', 'raw string')).toThrow(
      CliHandledError
    );

    const payload = JSON.parse(
      stdout.mock.calls.map((c) => String(c[0])).join('')
    ) as Record<string, unknown>;
    expect(payload.status).toBe('error');
    expect(payload.error).toBe('raw string');
    stdout.mockRestore();
  });
});
