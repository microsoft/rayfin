/**
 * Shared helpers for `rayfin docs` subcommands.
 *
 * Centralises the `DocsService` construction (lazy, memoised per process) so all
 * subcommands hit the same minisearch index without re-loading the docs corpus
 * on each invocation.
 */

import {
  DOCS_CACHE_SKIP_READ,
  DOCS_DEFAULT_MODULES,
  DOCS_NO_CACHE_OPTION_DESCRIPTION,
  DocsService,
  type DocModule,
  type DocSearchScope,
} from '@microsoft/rayfin-docs';
import {
  FEATURE_FLAGS_ENV_VAR,
  getRegisteredDocsFeatureFlags,
  parseFeatureFlags,
} from '@microsoft/rayfin-tools-common/_internal';

import { CliHandledError } from '../../errors.js';
import {
  type OutputMode,
  emitJson,
  modeError,
} from '../../utils/output-mode.js';

/** Stable schema for `--json` output. Bumped on breaking shape changes. */
export const DOCS_JSON_SCHEMA_VERSION = 1;

/** Valid module values mirror `DocModule` from `@microsoft/rayfin-docs`. */
export const DOC_MODULES: readonly DocModule[] = [
  'guide',
  'host',
  'ts-sdk',
] as const;

/** Valid search scopes mirror `DocSearchScope` from `@microsoft/rayfin-docs`. */
export const DOC_SCOPES: readonly DocSearchScope[] = [
  'docs',
  'symbols',
  'all',
] as const;

export const NO_CACHE_OPTION_DESC = DOCS_NO_CACHE_OPTION_DESCRIPTION;

function enabledDocsFlags(): string[] {
  return [
    ...parseFeatureFlags(
      new Map([
        [FEATURE_FLAGS_ENV_VAR, process.env[FEATURE_FLAGS_ENV_VAR] ?? ''],
      ])
    ),
  ].sort();
}

/**
 * Cache of `DocsService` instances keyed by their loaded module set. Each
 * CLI invocation typically constructs at most one service; the cache exists
 * for tests / repeated calls and keys on the module set so that
 * `--module host` (host-only) does not collide with the default
 * (guide+ts-sdk) service. `--no-cache` bypasses this process cache too.
 */
const cachedServices = new Map<string, DocsService>();

function modulesKey(modules: readonly DocModule[]): string {
  return [...modules].sort().join(',');
}

function createDocsService(
  modules: readonly DocModule[],
  options?: { noCache?: boolean; cacheDir?: string }
): DocsService {
  const cache =
    options?.noCache === true
      ? {
          ...DOCS_CACHE_SKIP_READ,
          ...(options.cacheDir ? { dir: options.cacheDir } : {}),
        }
      : options?.cacheDir
        ? { dir: options.cacheDir }
        : undefined;

  return new DocsService({
    modules: [...modules],
    enabledFlags: enabledDocsFlags(),
    registeredFlags: getRegisteredDocsFeatureFlags(),
    ...(cache ? { cache } : {}),
    // Use `process.cwd()` as the discovery base so a globally-installed
    // CLI walks the USER's project node_modules - not the global
    // install location's. The user is expected to run `rayfin docs ...`
    // from their project root.
    discover: {
      from: process.cwd(),
    },
  });
}

/**
 * Lazily construct (and reuse) the appropriate `DocsService` for the
 * requested module filter. The CLI's default loaded set mirrors
 * `DOCS_DEFAULT_MODULES` from `@microsoft/rayfin-docs` (guide + ts-sdk) -
 * host docs are .NET reference (DocFX-generated, ~70% of corpus) and not
 * part of the typical builder lookup. Pass `--module host` to opt in to
 * a host-only service for that one invocation.
 *
 * Every module set is loaded from packages discovered through the
 * `rayfinDocs` package.json convention. The CLI intentionally does not
 * fall back to `@microsoft/rayfin-mcp`'s historical bundled corpus:
 * docs must be version-locked to the packages installed in the user's
 * project, and missing/new functionality is surfaced through
 * `rayfin docs discover` instead.
 */
export function getDocsService(
  moduleFilter?: DocModule,
  options?: { noCache?: boolean; cacheDir?: string }
): DocsService {
  const modules: readonly DocModule[] =
    moduleFilter === 'host' ? ['host'] : DOCS_DEFAULT_MODULES;
  if (options?.noCache === true) {
    return createDocsService(modules, options);
  }

  const key = [
    modulesKey(modules),
    `flags=${enabledDocsFlags().join(',')}`,
    ...(options?.cacheDir ? [`cacheDir=${options.cacheDir}`] : []),
  ].join('|');
  let service = cachedServices.get(key);
  if (!service) {
    service = createDocsService(modules, options);
    cachedServices.set(key, service);
  }
  return service;
}

/** Reset memoised services. Test-only; not exported from the package. */
export function resetDocsServiceForTesting(): void {
  cachedServices.clear();
}

/**
 * Override the memoised service with a test double for the *default*
 * (builder) module set. Test-only.
 */
export function setDocsServiceForTesting(service: DocsService): void {
  cachedServices.clear();
  cachedServices.set(
    [
      modulesKey(DOCS_DEFAULT_MODULES),
      `flags=${enabledDocsFlags().join(',')}`,
    ].join('|'),
    service
  );
}

/**
 * Validate a `--module` flag value against the known module list. Throws
 * a plain `Error` if the value is unrecognised; `handleDocsCommandError`
 * is the single point that prints the message and wraps it as a
 * `CliHandledError`. Throwing `CliHandledError` directly here would
 * silently swallow the message because the top-level handler suppresses
 * its print on the assumption it was already emitted at the throw site.
 */
export function parseModuleFlag(
  value: string | undefined
): DocModule | undefined {
  if (value === undefined) {
    return undefined;
  }
  if ((DOC_MODULES as readonly string[]).includes(value)) {
    return value as DocModule;
  }
  throw new Error(
    `Unknown module '${value}'. Valid modules: ${DOC_MODULES.join(', ')}.`
  );
}

/**
 * Validate a `--scope` flag value. Throws plain `Error` if the value is
 * unrecognised so typos don't silently fall back to defaults.
 */
export function parseScopeFlag(
  value: string | undefined
): DocSearchScope | undefined {
  if (value === undefined) {
    return undefined;
  }
  if ((DOC_SCOPES as readonly string[]).includes(value)) {
    return value as DocSearchScope;
  }
  throw new Error(
    `Unknown scope '${value}'. Valid scopes: ${DOC_SCOPES.join(', ')}.`
  );
}

/**
 * Validate a `--limit` flag value. Returns `undefined` if not provided.
 * Throws plain `Error` if the value isn't a positive integer in [1, 50]
 * (matches the cap used by the MCP search tool).
 */
export function parseLimitFlag(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 50) {
    throw new Error(
      `Invalid --limit '${value}'. Must be a positive integer between 1 and 50.`
    );
  }
  return parsed;
}

/**
 * Stamp a successful response with the standard `status` + `schemaVersion`
 * preamble shared across `rayfin docs --json` outputs.
 */
export function jsonOk<T extends Record<string, unknown>>(
  payload: T
): { status: 'ok'; schemaVersion: number } & T {
  return {
    status: 'ok',
    schemaVersion: DOCS_JSON_SCHEMA_VERSION,
    ...payload,
  };
}

/**
 * Emit a docs JSON response in either "envelope" or "lean" form.
 *
 * - `lean: false` (default): emits the standard `status` + `schemaVersion`
 *   envelope around the payload. Backwards-compatible with scripts that
 *   parse the meta fields.
 * - `lean: true`: emits ONLY the inner payload value, compact, no envelope.
 *   This is the optimal shape for LLM consumption - drops 7 envelope
 *   fields and ~25-30% of bytes (since the surrounding `emitJson` is
 *   already compact). The trade-off is no `status` indicator, so callers
 *   must rely on exit code (and the error path still emits the envelope
 *   so failures remain unambiguous).
 *
 * The `value` argument is the inner payload (e.g. `{ items, count }` for
 * list, `{ results, count }` for search, `{ entry }` for get). In lean
 * mode we extract the canonical inner array/object the caller cares
 * about: `items`, `results`, `sections`, or `entry` — falling back to
 * the whole value if no canonical inner field is present.
 */
export function emitDocsJson<T extends Record<string, unknown>>(
  value: T,
  lean: boolean,
  leanValue?: unknown
): void {
  if (!lean) {
    emitJson(jsonOk(value));
    return;
  }
  const inner =
    leanValue ??
    value.items ??
    value.results ??
    value.sections ??
    value.entry ??
    value;
  emitJson(inner);
}

/**
 * Collapse whitespace and truncate a string to `max` characters, appending
 * an ellipsis when truncated. Used by list / search / get for one-line
 * display of doc content.
 */
export function trimSnippet(value: string, max = 200): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/**
 * Single point that prints a command failure in the active output mode and
 * wraps it as `CliHandledError` so the top-level handler maps it to the
 * right exit code without double-printing.
 *
 * - In `json` mode, emits `{ status: "error", schemaVersion: 1, error: ... }`
 *   on stdout so JSON consumers can fail closed on shape skew.
 * - In `text` mode, prints `❌ <message>` on stderr.
 *
 * Already-`CliHandledError` inputs are surfaced verbatim - the contract is
 * "the message was already printed by the throw site". All other errors
 * (including the `Error`s thrown by the flag parsers above) flow through
 * the print + wrap path, so flag-parse failures emit a structured response
 * instead of exiting silently.
 */
export function handleDocsCommandError(mode: OutputMode, err: unknown): never {
  if (err instanceof CliHandledError) {
    throw err;
  }
  const message = err instanceof Error ? err.message : String(err);
  if (mode === 'json') {
    emitJson({
      status: 'error',
      schemaVersion: DOCS_JSON_SCHEMA_VERSION,
      error: message,
    });
  } else {
    modeError(mode, `❌ rayfin docs failed: ${message}`);
  }
  throw new CliHandledError(err instanceof Error ? err : new Error(message));
}
