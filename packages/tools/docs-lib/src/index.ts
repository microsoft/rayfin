import { createHash } from 'crypto';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { homedir, tmpdir } from 'os';
import { basename, dirname, join, resolve } from 'path';

import { getCatalog } from './catalog.js';
import {
  type DiscoveredPackage,
  type DiscoveryResult,
  type DiscoveryOptions,
  docKindToModule,
  discoverRayfinDocsPackages,
  hasExplicitDiscoverySource,
} from './discovery.js';
import { loadDocs, loadDocsFromPackage } from './loader.js';
import {
  DOCS_INDEX_SCHEMA_VERSION,
  DOCS_SEARCH_CONFIG_FINGERPRINT,
  type PrebuiltDocsIndex,
  createDocsIndex,
  docsVisibilityFingerprint,
  loadDocsIndexFromPrebuilt,
  searchDocs,
  serializeDocsIndex,
} from './search.js';
import type {
  DocEntry,
  DocListItem,
  DocModule,
  DocSearchScope,
  DocSearchResult,
  DocSectionRef,
} from './types.js';
import type { DocsVisibilityOptions } from './visibility.js';

const PREBUILT_INDEX_FILENAME = 'docs.search.json';
const DISCOVERED_CACHE_PREFIX = 'docs-index-';

export interface DocsIndexCacheOptions {
  /**
   * Directory used for on-disk index cache files. Defaults to
   * `~/.rayfin/cache` with a temp-directory fallback for write failures.
   */
  dir?: string;
  /**
   * Whether to read an existing cache file. Set `false` for CLI/MCP
   * `--no-cache` behavior while still updating the cache after rebuild.
   */
  read?: boolean;
  /** Whether to write a rebuilt cache file. Defaults to `true`. */
  write?: boolean;
}

/**
 * Skip reading existing on-disk cache files while still writing a fresh index
 * after rebuild. Used by CLI/MCP `--no-cache` flags.
 */
export const DOCS_CACHE_SKIP_READ: DocsIndexCacheOptions = { read: false };

export const DOCS_NO_CACHE_OPTION_DESCRIPTION =
  'Bypass any existing on-disk docs index cache and rebuild from installed package docs.';

interface ResolvedCacheOptions {
  enabled: boolean;
  dir?: string;
  read: boolean;
  write: boolean;
}

/**
 * Default loaded module set when no `modules` option is provided. Mirrors
 * the MCP `start` default and the CLI's builder default. Host docs are
 * .NET reference content (DocFX-generated, ~70% of corpus) and are
 * loaded only when explicitly requested via `--module host` (CLI) or
 * `--host-docs` (MCP).
 *
 * Exported so the CLI command group, the MCP `start` command, and the
 * build-time prebuilt-index emitter all read the same constant - changing
 * the default loaded set requires editing one site.
 */
export const DOCS_DEFAULT_MODULES: readonly DocModule[] = ['guide', 'ts-sdk'];

/**
 * Catalog-derived list of packages CLI/MCP probe for the `rayfinDocs`
 * field. Kept lazy so importing the docs library does not read bundled
 * catalog assets until discovery needs the default candidates.
 *
 * External consumers SHOULD NOT import this constant directly; treat it
 * as an internal default that may change shape between versions. The
 * `discover` option on `DocsService` accepts any candidate list — pass
 * your own if you need stable behavior across Rayfin versions.
 *
 * Packages not yet migrated to ship their own docs are silently skipped
 * by `discoverRayfinDocsPackages`; catalog candidates not present in
 * `node_modules` appear in `DiscoveryResult.notInstalled`.
 *
 * Experimental packages are deliberately still probed. `stability` only
 * gates install recommendations in `discoverPackages(query)` — once a
 * Builder has actually installed an experimental package, its docs
 * should be listable and searchable like any other.
 *
 * **`--module ts-sdk` compatibility:** when a discovered package
 * declares `kind: 'api-reference'`, its docs are tagged with the
 * legacy `module: 'ts-sdk'` so existing CLI/MCP filters keep working
 * across the migration. Individual packages remain addressable through
 * their globally unique doc ids (for example, `rayfin-core:index.md`).
 */
let knownRayfinDocsPackages: readonly string[] | undefined;

export function getKnownRayfinDocsPackages(): readonly string[] {
  return (knownRayfinDocsPackages ??= getCatalog()
    .packages.filter((p) => p.modules.length > 0)
    .map((p) => p.name));
}

export type {
  DocEntry,
  DocListItem,
  DocModule,
  DocSearchResult,
  DocSearchScope,
  DocSection,
  DocSectionRef,
  DocSource,
  DocKind,
  RayfinDocsManifest,
} from './types.js';

export {
  type DiscoveredPackage,
  type DiscoveryResult,
  type DiscoveryOptions,
  type ManifestValidation,
  type TrustPredicate,
  defaultTrust,
  discoverRayfinDocsPackages,
  validateRayfinDocsManifest,
  docKindToModule,
} from './discovery.js';

export type { DocsIndex, PrebuiltDocsIndex } from './search.js';

// Catalog API — folded into rayfin-docs in the post-Phase-5
// consolidation. The catalog updates with the same trigger as the
// indexer ("we shipped a new SDK package"), so splitting them across
// packages just multiplies release coordination.
export {
  type Catalog,
  type CatalogPackage,
  type CatalogPackageKind,
  type CatalogPackageStability,
  type DiscoverItem,
  type DiscoverScore,
  getCatalog,
  discoverPackages,
  mapDiscoverResult,
  deriveInstallCommand,
  deriveUpdateCommand,
  _resetCatalogForTesting,
} from './catalog.js';

function modulesKey(modules: readonly DocModule[]): string {
  return [...modules].sort().join(',');
}

function isPrebuiltDocsIndex(value: unknown): value is PrebuiltDocsIndex {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as PrebuiltDocsIndex).schemaVersion === 'number' &&
    typeof (value as PrebuiltDocsIndex).configFingerprint === 'string' &&
    typeof (value as PrebuiltDocsIndex).visibilityFingerprint === 'string' &&
    Array.isArray((value as PrebuiltDocsIndex).modules) &&
    Array.isArray((value as PrebuiltDocsIndex).entries) &&
    !!(value as PrebuiltDocsIndex).miniSerialized &&
    typeof (value as PrebuiltDocsIndex).miniSerialized === 'object'
  );
}

function isCompatiblePrebuiltIndex(
  parsed: PrebuiltDocsIndex,
  modules: readonly DocModule[],
  enabledFlags: readonly string[]
): boolean {
  return (
    parsed.schemaVersion === DOCS_INDEX_SCHEMA_VERSION &&
    parsed.configFingerprint === DOCS_SEARCH_CONFIG_FINGERPRINT &&
    modulesKey(parsed.modules) === modulesKey(modules) &&
    parsed.visibilityFingerprint === docsVisibilityFingerprint(enabledFlags)
  );
}

/**
 * Load the prebuilt search index from disk if present and compatible with
 * the runtime's expected schema/config/module set. Returns `undefined`
 * when the prebuilt is missing, malformed, or stale - callers fall back to
 * source-building.
 */
function tryLoadPrebuiltIndex(
  assetsRoot: string,
  modules: readonly DocModule[],
  enabledFlags: readonly string[]
): PrebuiltDocsIndex | undefined {
  const path = join(assetsRoot, PREBUILT_INDEX_FILENAME);
  let parsed: PrebuiltDocsIndex;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as PrebuiltDocsIndex;
  } catch {
    // Missing file (ENOENT) or malformed JSON - fall back to source build.
    return undefined;
  }

  // Shape guard: a partially-written or hand-crafted file might parse as
  // JSON but be missing required fields. The contract of this helper is
  // "return undefined on any problem so the caller can fall back" - if the
  // payload is malformed, returning `parsed` would crash inside
  // `loadDocsIndexFromPrebuilt` instead of falling back cleanly.
  if (!isPrebuiltDocsIndex(parsed)) {
    return undefined;
  }

  return isCompatiblePrebuiltIndex(parsed, modules, enabledFlags)
    ? parsed
    : undefined;
}

function normalizeCacheOptions(
  cache: boolean | DocsIndexCacheOptions | undefined,
  defaultEnabled: boolean
): ResolvedCacheOptions {
  if (cache === false) {
    return { enabled: false, read: false, write: false };
  }
  if (cache === true || cache === undefined) {
    return {
      enabled: cache === true || defaultEnabled,
      read: true,
      write: true,
    };
  }
  return {
    enabled: true,
    ...(cache.dir ? { dir: cache.dir } : {}),
    read: cache.read ?? true,
    write: cache.write ?? true,
  };
}

function defaultDocsCacheBase(useTemp = false): string {
  if (useTemp) {
    return join(tmpdir(), 'rayfin', 'cache');
  }
  const home = homedir();
  return home
    ? join(home, '.rayfin', 'cache')
    : join(tmpdir(), 'rayfin', 'cache');
}

function defaultDocsCacheDir(discoverFrom?: string, useTemp = false): string {
  const base = defaultDocsCacheBase(useTemp);
  if (!discoverFrom) {
    return base;
  }
  const projectHash = createHash('sha256')
    .update(resolve(discoverFrom))
    .digest('hex')
    .slice(0, 16);
  return join(base, 'projects', projectHash);
}

function discoveredCacheKey(
  packages: readonly DiscoveredPackage[],
  modules: readonly DocModule[],
  enabledFlags: readonly string[]
): string {
  const payload = {
    schemaVersion: DOCS_INDEX_SCHEMA_VERSION,
    configFingerprint: DOCS_SEARCH_CONFIG_FINGERPRINT,
    visibilityFingerprint: docsVisibilityFingerprint(enabledFlags),
    modules: [...modules].sort(),
    packages: packages
      .map((pkg) => ({
        name: pkg.packageName,
        version: pkg.packageVersion,
        module: pkg.manifest.module,
        kind: pkg.manifest.kind,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function discoveredCachePath(
  packages: readonly DiscoveredPackage[],
  modules: readonly DocModule[],
  enabledFlags: readonly string[],
  cache: ResolvedCacheOptions,
  discoverFrom?: string
): string {
  const dir = cache.dir ?? defaultDocsCacheDir(discoverFrom);
  return join(
    dir,
    `${DISCOVERED_CACHE_PREFIX}${discoveredCacheKey(packages, modules, enabledFlags)}.json`
  );
}

function fallbackDiscoveredCachePath(
  packages: readonly DiscoveredPackage[],
  modules: readonly DocModule[],
  enabledFlags: readonly string[],
  cache: ResolvedCacheOptions,
  discoverFrom?: string
): string | undefined {
  if (cache.dir) {
    return undefined;
  }
  return discoveredCachePath(packages, modules, enabledFlags, {
    ...cache,
    dir: defaultDocsCacheDir(discoverFrom, true),
  });
}

function tryLoadDiscoveredIndexCache(
  cachePaths: readonly string[],
  modules: readonly DocModule[],
  enabledFlags: readonly string[],
  cache: ResolvedCacheOptions
): PrebuiltDocsIndex | undefined {
  if (!cache.enabled || !cache.read || cachePaths.length === 0) {
    return undefined;
  }

  for (const cachePath of cachePaths) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(cachePath, 'utf8'));
    } catch {
      continue;
    }
    if (!isPrebuiltDocsIndex(parsed)) {
      continue;
    }
    if (isCompatiblePrebuiltIndex(parsed, modules, enabledFlags)) {
      return parsed;
    }
  }
  return undefined;
}

function normalizeDiscoveryOptions(
  discover: DiscoveryOptions
): DiscoveryOptions {
  if (hasExplicitDiscoverySource(discover)) {
    return discover;
  }
  return {
    ...discover,
    candidates: getKnownRayfinDocsPackages(),
  };
}

function pruneStaleDiscoveredIndexCaches(currentPath: string): void {
  try {
    const dir = dirname(currentPath);
    const currentName = basename(currentPath);
    for (const entry of readdirSync(dir)) {
      if (
        entry !== currentName &&
        entry.startsWith(DISCOVERED_CACHE_PREFIX) &&
        entry.endsWith('.json')
      ) {
        unlinkSync(join(dir, entry));
      }
    }
  } catch {
    // Cache cleanup is best-effort; stale files are harmless but bounded.
  }
}

function writeDiscoveredIndexCache(
  targetPath: string | undefined,
  fallbackPath: string | undefined,
  cache: ResolvedCacheOptions,
  prebuilt: PrebuiltDocsIndex
): void {
  if (!cache.enabled || !cache.write || !targetPath) {
    return;
  }

  try {
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, JSON.stringify(prebuilt));
    pruneStaleDiscoveredIndexCaches(targetPath);
    return;
  } catch (err) {
    if (cache.dir) {
      throw err;
    }
  }

  if (!fallbackPath) {
    return;
  }
  try {
    mkdirSync(dirname(fallbackPath), { recursive: true });
    writeFileSync(fallbackPath, JSON.stringify(prebuilt));
    pruneStaleDiscoveredIndexCaches(fallbackPath);
  } catch {
    // Cache writes are a performance optimization; docs can still be served.
  }
}

function parseQualifiedSymbol(
  symbol: string
): { owner: string; symbol: string } | undefined {
  const separator = symbol.lastIndexOf('::');
  if (separator <= 0 || separator >= symbol.length - 2) {
    return undefined;
  }
  return {
    owner: symbol.slice(0, separator).toLowerCase(),
    symbol: symbol.slice(separator + 2),
  };
}

export class DocsService {
  private entries!: DocEntry[];
  private entriesById!: Map<string, DocEntry>;
  private symbolToSections!: Map<string, DocSectionRef[]>;
  private searchIndex!: ReturnType<typeof createDocsIndex>['mini'];
  private discoveryReport?: DiscoveryResult;

  private hydrateFromPrebuilt(prebuilt: PrebuiltDocsIndex): void {
    this.entries = prebuilt.entries;
    const index = loadDocsIndexFromPrebuilt(prebuilt);
    this.entriesById = index.entriesById;
    this.symbolToSections = index.symbolToSections;
    this.searchIndex = index.mini;
  }

  constructor(options: {
    /**
     * Directory containing the legacy bundled corpus layout
     * `docs/<module>/...` plus an optional `docs.search.json` prebuilt
     * index. At least one of `assetsRoot` and `discover` must be set.
     */
    assetsRoot?: string;
    /**
     * Phase 2+ source: discover packages declaring the `rayfinDocs` field
     * and load each declaring package's docs. If `candidates` is omitted,
     * DocsService probes only Rayfin's known docs package list instead of
     * walking the entire `node_modules` tree. The `from` argument is passed
     * to package discovery and used as the `createRequire` base.
     */
    discover?: DiscoveryOptions;
    /**
     * Optional filter applied to both legacy `assetsRoot` docs and
     * discovered package docs.
     */
    modules?: readonly DocModule[];
    /** Active documentation flags used to resolve gated regions. */
    enabledFlags?: readonly string[];
    /** Registered flags accepted by documentation markers. */
    registeredFlags?: readonly string[];
    /**
     * Optional on-disk cache for indexes built from discovered installed
     * packages. Enabled by default for discover-only mode so CLI/MCP cold
     * starts stay fast while docs remain version-locked to installed package
     * versions. Pass `false` or `{ read: false }` for `--no-cache` behavior.
     */
    cache?: boolean | DocsIndexCacheOptions;
  }) {
    if (!options.assetsRoot && !options.discover) {
      throw new Error(
        'DocsService requires at least one source: pass `assetsRoot` (legacy bundled corpus), `discover` (per-package discovery), or both. Both modes can compose during the Phase 2/3 migration; per-package entries override bundled ones on collision.'
      );
    }
    if (options.assetsRoot !== undefined && options.assetsRoot.length === 0) {
      throw new Error(
        '`assetsRoot` must be a non-empty path. Pass `undefined` (omit the option) to skip the bundled-corpus source entirely.'
      );
    }

    const modules = options.modules ?? DOCS_DEFAULT_MODULES;
    const enabledFlags = [
      ...new Set(
        (options.enabledFlags ?? []).map((flag) => flag.trim().toLowerCase())
      ),
    ].filter(Boolean);
    const visibility: DocsVisibilityOptions = {
      enabledFlags,
      registeredFlags: options.registeredFlags ?? [],
    };
    const cache = normalizeCacheOptions(
      options.cache,
      !!options.discover && !options.assetsRoot
    );

    // Discovery results — empty array when discover wasn't passed OR
    // when discovery returned no packages. We compute this BEFORE
    // committing to the bundled fast path so an empty discovery doesn't
    // sacrifice the prebuilt-index speedup.
    const discoveredEntries: DocEntry[] = [];
    let discoveredPackages: DiscoveredPackage[] = [];
    let discoveredCacheFile: string | undefined;
    let discoveredFallbackCacheFile: string | undefined;
    if (options.discover) {
      const discoveryOptions = normalizeDiscoveryOptions(options.discover);
      const report = discoverRayfinDocsPackages(discoveryOptions);
      this.discoveryReport = report;
      discoveredPackages = report.discovered.filter((pkg) =>
        modules.includes(docKindToModule(pkg.manifest.kind))
      );
      discoveredCacheFile =
        !options.assetsRoot && discoveredPackages.length > 0 && cache.enabled
          ? discoveredCachePath(
              discoveredPackages,
              modules,
              enabledFlags,
              cache,
              discoveryOptions.from
            )
          : undefined;
      discoveredFallbackCacheFile =
        !options.assetsRoot && discoveredPackages.length > 0 && cache.enabled
          ? fallbackDiscoveredCachePath(
              discoveredPackages,
              modules,
              enabledFlags,
              cache,
              discoveryOptions.from
            )
          : undefined;
      if (!options.assetsRoot) {
        const cached = tryLoadDiscoveredIndexCache(
          [discoveredCacheFile, discoveredFallbackCacheFile].filter(
            (path): path is string => !!path
          ),
          modules,
          enabledFlags,
          cache
        );
        if (cached) {
          this.hydrateFromPrebuilt(cached);
          return;
        }
      }
      for (const pkg of discoveredPackages) {
        discoveredEntries.push(...loadDocsFromPackage(pkg, visibility));
      }
    }

    if (options.assetsRoot) {
      const root = options.assetsRoot;
      const prebuilt = tryLoadPrebuiltIndex(root, modules, enabledFlags);
      if (prebuilt && discoveredEntries.length === 0) {
        // Fast path: prebuilt-only mode (no discovery to merge with).
        // Rehydrate index + entries from the prebuilt envelope without
        // re-walking markdown OR rebuilding the MiniSearch index.
        // Critical for CLI cold start — Phase 2 broke this path before
        // by always passing `discover` even when no packages declared
        // rayfinDocs; restored here by deferring the fast-path decision
        // until AFTER discovery has actually produced results.
        this.hydrateFromPrebuilt(prebuilt);
        return;
      }
      const bundled = prebuilt
        ? prebuilt.entries
        : loadDocs(root, [...modules], visibility);
      if (discoveredEntries.length === 0) {
        // No discovery overlay — skip the merge map entirely.
        this.entries = bundled;
      } else {
        const merged = new Map<string, DocEntry>();
        for (const entry of bundled) {
          merged.set(entry.id, entry);
        }
        for (const entry of discoveredEntries) {
          // Per-package wins on collision: later `set` overwrites the
          // earlier bundled entry with the same id.
          merged.set(entry.id, entry);
        }
        this.entries = [...merged.values()];
      }
    } else {
      // discover-only mode (no bundled corpus).
      this.entries = discoveredEntries;
    }

    const index = createDocsIndex(this.entries);
    this.entriesById = index.entriesById;
    this.symbolToSections = index.symbolToSections;
    this.searchIndex = index.mini;
    if (!options.assetsRoot && discoveredPackages.length > 0) {
      writeDiscoveredIndexCache(
        discoveredCacheFile,
        discoveredFallbackCacheFile,
        cache,
        serializeDocsIndex(this.entries, [...modules], index, enabledFlags)
      );
    }
  }

  /**
   * Returns a frozen snapshot of the discovery report from
   * construction, if `discover` was passed. `undefined` when no
   * discovery ran (bundled-only mode). Useful for surfacing "package X
   * is in your trust list but not installed" or "manifest invalid;
   * skipped" diagnostics. The returned object is deep-frozen so
   * consumers cannot mutate the service's internal state.
   */
  getDiscoveryReport(): DiscoveryResult | undefined {
    if (!this.discoveryReport) return undefined;
    // Deep clone via JSON round-trip then freeze. Discovery results
    // are small structured data — never functions or class instances —
    // so JSON is safe and avoids exposing the internal references.
    const frozen = JSON.parse(
      JSON.stringify(this.discoveryReport)
    ) as DiscoveryResult;
    Object.freeze(frozen);
    Object.freeze(frozen.discovered);
    Object.freeze(frozen.notInstalled);
    Object.freeze(frozen.untrustedSkipped);
    Object.freeze(frozen.invalidManifest);
    return frozen;
  }

  listDocs(module?: DocModule): DocListItem[] {
    return this.entries
      .filter((entry) => (module ? entry.module === module : true))
      .map((entry) => ({
        id: entry.id,
        module: entry.module,
        path: entry.path,
        title: entry.title,
        ...(entry.source ? { source: entry.source } : {}),
      }));
  }

  getDocById(id: string): DocEntry | undefined {
    return this.entriesById.get(id);
  }

  getDocsByPath(path: string, module?: DocModule): DocEntry[] {
    const normalized = path.replace(/^\//, '');
    return this.entries.filter(
      (entry) =>
        entry.path === normalized && (module ? entry.module === module : true)
    );
  }

  getDocByPath(path: string, module?: DocModule): DocEntry | undefined {
    const matches = this.getDocsByPath(path, module);
    return matches.length === 1 ? matches[0] : undefined;
  }

  searchDocs(
    query: string,
    module?: DocModule,
    limit = 10,
    scope: DocSearchScope = 'docs'
  ): DocSearchResult[] {
    return searchDocs(
      {
        mini: this.searchIndex,
        entriesById: this.entriesById,
        symbolToSections: this.symbolToSections,
      },
      query,
      module,
      limit,
      scope
    );
  }

  getSymbolDocs(symbol: string, module?: DocModule): DocSectionRef[] {
    const qualified = parseQualifiedSymbol(symbol);
    const key = (qualified?.symbol ?? symbol).toLowerCase();
    const sections = this.symbolToSections.get(key) ?? [];
    return sections.filter((section) => {
      if (module && section.module !== module) {
        return false;
      }
      if (!qualified) {
        return true;
      }
      return (
        section.source?.packageName.toLowerCase() === qualified.owner ||
        section.source?.module.toLowerCase() === qualified.owner
      );
    });
  }
}
