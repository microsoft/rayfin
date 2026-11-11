/**
 * Static hosting utilities for the Rayfin CLI.
 *
 * Validates, builds, packages, and deploys static content
 * configured via `services.staticHosting` in rayfin.yml.
 */

import { spawnSync } from 'child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { extname, join, relative } from 'path';
import { PassThrough } from 'stream';

import type { Diagnostics } from '@microsoft/rayfin-tools-common/_internal/adapters';
import type { StaticHostingConfig } from '@microsoft/rayfin-tools-common/_internal/config';
import { translateStaticHostingAccessError } from '@microsoft/rayfin-tools-common/_internal/services/runtime-settings';
import archiver from 'archiver';

import {
  resolveServiceSubpath,
  resolveServiceRoot,
  runServiceBuildCommand,
  type ServiceBuildOptions,
} from './config-utils.js';
import { formatBytes } from './format-utils.js';
import { fabricFetch, throwIfNotOk } from './http-client.js';

/** Maximum compressed ZIP size accepted by the static hosting deploy API (100 MB). */
export const MAX_ZIP_SIZE_BYTES = 100 * 1024 * 1024;

/** Scripts a browser will load: `.js`, and `.mjs` when a tool emits it. */
const SCRIPT_EXTENSIONS = new Set(['.js', '.mjs']);

/**
 * Stop after this many unparseable files. One broken chunk is enough to decide;
 * listing every file in a large bundle buries the actionable error.
 */
const MAX_REPORTED_PARSE_FAILURES = 3;

/** The bundle check could not run. Not a verdict on the files. */
function asEnvironmentFailure(detail: string): Error {
  return new Error(
    `Could not run the bundle parse check: ${detail}\n` +
      'This is an environment problem, not a problem with the built files.'
  );
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface StaticFolderValidation {
  exists: boolean;
  empty: boolean;
  resolvedPath: string;
  message?: string;
  fileCount: number;
  totalSizeBytes: number;
}

/**
 * Validate deployment inputs without running the build or requiring its output.
 * Without a build command, the configured output must already be deployable.
 */
export function validateStaticHostingInputs(
  projectRoot: string,
  config: StaticHostingConfig
): void {
  try {
    const serviceRoot = resolveServiceRoot(
      projectRoot,
      'staticHosting',
      config.path ?? '.'
    );
    if (!statSync(serviceRoot).isDirectory()) {
      throw new Error(
        `Service 'staticHosting' path '${config.path ?? '.'}' is not a directory at '${serviceRoot}'.`
      );
    }
    const buildRoot = resolveServiceSubpath(
      serviceRoot,
      'staticHosting',
      'root',
      config.root || '.'
    );
    if (!existsSync(buildRoot) || !statSync(buildRoot).isDirectory()) {
      throw new Error(
        `Service 'staticHosting' root '${config.root || '.'}' is not an existing directory at '${buildRoot}'.`
      );
    }
    resolveServiceSubpath(buildRoot, 'staticHosting', 'folder', config.folder);

    if (!config.buildCommand) {
      const validation = validateStaticFolder(serviceRoot, config);
      if (!validation.exists || validation.empty) {
        throw new Error(
          `Service 'staticHosting' folder '${config.folder}' at '${validation.resolvedPath}': ${validation.message}.`
        );
      }
    }
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n` +
        '   Check services.staticHosting.path, root, and folder in rayfin.yml. ' +
        'Build the static output first or configure services.staticHosting.buildCommand.',
      { cause: error }
    );
  }
}

/** Validate that the configured static folder exists and contains files. */
export function validateStaticFolder(
  projectRoot: string,
  config: StaticHostingConfig
): StaticFolderValidation {
  const buildRoot = resolveServiceSubpath(
    projectRoot,
    'staticHosting',
    'root',
    config.root || '.'
  );
  const resolvedPath = resolveServiceSubpath(
    buildRoot,
    'staticHosting',
    'folder',
    config.folder
  );
  const fail = (message: string): StaticFolderValidation => ({
    exists: false,
    empty: true,
    resolvedPath,
    message,
    fileCount: 0,
    totalSizeBytes: 0,
  });

  if (!existsSync(resolvedPath))
    return fail(`Static folder not found: ${resolvedPath}`);

  try {
    if (!statSync(resolvedPath).isDirectory())
      return fail(`Not a directory: ${resolvedPath}`);
  } catch (e) {
    return fail(`Cannot access: ${resolvedPath} — ${(e as Error).message}`);
  }

  const { fileCount, totalSizeBytes } = countFiles(resolvedPath);
  if (fileCount === 0) {
    return {
      exists: true,
      empty: true,
      resolvedPath,
      message: 'Static folder is empty',
      fileCount: 0,
      totalSizeBytes: 0,
    };
  }
  return {
    exists: true,
    empty: false,
    resolvedPath,
    fileCount,
    totalSizeBytes,
  };
}

function countFiles(dir: string): {
  fileCount: number;
  totalSizeBytes: number;
} {
  let fileCount = 0;
  let totalSizeBytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = countFiles(full);
      fileCount += sub.fileCount;
      totalSizeBytes += sub.totalSizeBytes;
    } else if (entry.isFile()) {
      fileCount++;
      totalSizeBytes += statSync(full).size;
    }
  }
  return { fileCount, totalSizeBytes };
}

// ---------------------------------------------------------------------------
// Build command runner
// ---------------------------------------------------------------------------

/** Run the configured build command. Returns `true` on success. */
export async function runStaticBuildCommand(
  serviceRoot: string,
  config: StaticHostingConfig,
  options: ServiceBuildOptions = {}
): Promise<boolean> {
  if (!config.buildCommand) return true;

  const cwd = resolveServiceSubpath(
    serviceRoot,
    'staticHosting',
    'root',
    config.root || '.'
  );
  return runServiceBuildCommand(cwd, config.buildCommand, options);
}

// ---------------------------------------------------------------------------
// ZIP packaging (using archiver)
// ---------------------------------------------------------------------------

/** Package the static folder into a ZIP buffer. Rejects if the compressed size exceeds 100 MB. */
/**
 * Prove every emitted script in the folder is parseable JavaScript.
 *
 * A successful build does not mean a loadable app: Vite exits 0 while emitting
 * JavaScript the browser refuses to parse, leaving a blank page and one console
 * error. Measured case was a generated entity class reaching the bundle with
 * decorators on a class *expression*, past build, typecheck, lint and test.
 *
 * Grammar is delegated to `node --check`. The goal is passed explicitly with
 * `--input-type` and the source on stdin, because Node otherwise infers it from
 * the nearest `package.json` and rejects valid ESM under `"type": "commonjs"`.
 * A file is only rejected when it parses as neither a module nor a script.
 *
 * @returns Messages for the files that failed to parse; empty when all parse.
 * @throws When a check could not be run - a spawn failure is an environment
 *   problem, not evidence that the file is broken.
 */
export function findUnparseableScripts(resolvedStaticDir: string): string[] {
  const failures: string[] = [];

  /** Parses under one explicit goal. Returns the `SyntaxError`, or null if it parsed. */
  const parseFailure = (
    source: string,
    goal: 'module' | 'commonjs'
  ): string | null => {
    const result = spawnSync(
      process.execPath,
      [`--input-type=${goal}`, '--check'],
      {
        input: source,
        encoding: 'utf8',
        // Node echoes the offending line, so a minified bundle's diagnostic is
        // about the size of the source and the 1 MB default truncates it to
        // ENOBUFS with no `SyntaxError` in it. Sized in BYTES, since
        // `source.length` is UTF-16 units and non-ASCII would overflow again.
        maxBuffer: Buffer.byteLength(source, 'utf8') * 2 + 1024 * 1024,
      }
    );

    if (result.error) throw asEnvironmentFailure(result.error.message);
    if (result.signal) throw asEnvironmentFailure(`killed by ${result.signal}`);
    if (result.status === 0) return null;

    const stderr = result.stderr ?? '';
    const syntax = stderr
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('SyntaxError'))
      .join('; ');

    // Node writes a `[stdin]:<line>` header, then the offending line in full,
    // then the `SyntaxError:` summary. For a minified bundle the middle part is
    // megabytes, and on Linux the child can exit before it drains - losing the
    // summary while the header survives. Classify on the header, which is
    // written first, and use the summary only when it arrived.
    const reportedAPosition = /^\[stdin\]:\d+/mu.test(stderr);
    if (!syntax && !reportedAPosition)
      throw asEnvironmentFailure(stderr.trim());
    return syntax || 'SyntaxError (diagnostic truncated by the engine)';
  };

  const walk = (dir: string): void => {
    if (failures.length >= MAX_REPORTED_PARSE_FAILURES) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      // Unreadable directories are the folder validator's problem; failing here
      // would report a permissions error as a syntax error.
      return;
    }
    for (const entry of entries) {
      if (failures.length >= MAX_REPORTED_PARSE_FAILURES) return;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (SCRIPT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        const source = readFileSync(full, 'utf8');
        // Module first: every bundler this gate covers emits ESM, so the second
        // goal is rarely reached.
        const asModule = parseFailure(source, 'module');
        if (asModule === null) continue;
        if (parseFailure(source, 'commonjs') === null) continue;
        failures.push(
          `${relative(resolvedStaticDir, full) || entry.name}: ${asModule}`
        );
      }
    }
  };

  walk(resolvedStaticDir);
  return failures;
}

export async function packageStaticFolder(
  resolvedStaticDir: string
): Promise<Buffer> {
  const unparseable = findUnparseableScripts(resolvedStaticDir);
  if (unparseable.length > 0) {
    // Refused rather than warned: the deploy would succeed and the app would be
    // a blank page, which reads as a platform problem rather than a build one.
    throw new Error(
      `The built bundle is not parseable JavaScript, so the deployed app would be a blank page:\n` +
        unparseable.map((line) => `  - ${line}`).join('\n') +
        `\nThis is a build output problem - the browser never gets as far as running it.`
    );
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = new PassThrough();
    const archive = archiver('zip', { zlib: { level: 9 } });

    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('finish', () => {
      const buffer = Buffer.concat(chunks);
      if (buffer.byteLength > MAX_ZIP_SIZE_BYTES) {
        reject(
          new Error(
            `Compressed package size (${formatBytes(buffer.byteLength)}) exceeds the 100 MB limit. ` +
              'Reduce the number or size of files in your static folder.'
          )
        );
      } else {
        resolve(buffer);
      }
    });
    stream.on('error', reject);
    archive.on('error', reject);

    archive.pipe(stream);
    archive.directory(resolvedStaticDir, false);
    archive.finalize();
  });
}

// ---------------------------------------------------------------------------
// Deploy
// ---------------------------------------------------------------------------

/** Response from `/__private/webapp/deploy`. */
export interface StaticDeployResponse {
  success: boolean;
  deploymentId?: string;
  hostingUrl?: string;
  errorMessage: string | null;
}

/** Deploy a ZIP buffer to the remote static hosting endpoint. */
export async function deployStaticContent(
  zipBuffer: Buffer,
  endpoint: string,
  authorizationHeader: string,
  extraHeaders?: Record<string, string>,
  diagnostics?: Diagnostics
): Promise<StaticDeployResponse> {
  const body = new Uint8Array(zipBuffer);
  const resp = await fabricFetch(
    endpoint,
    {
      method: 'POST',
      headers: {
        Authorization: authorizationHeader,
        'Content-Type': 'application/zip',
        'Content-Length': String(body.byteLength),
        ...extraHeaders,
      },
      body,
    },
    diagnostics
  );

  const text = await throwIfNotOk(
    resp,
    'Static deploy failed',
    translateStaticHostingAccessError
  );
  let parsed: StaticDeployResponse;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Unexpected deploy response: ${text.substring(0, 200)}`);
  }
  if (!parsed.success && parsed.errorMessage) {
    throw new Error(`Static deploy failed: ${parsed.errorMessage}`);
  }
  return parsed;
}
