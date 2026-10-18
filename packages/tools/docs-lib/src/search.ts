import MiniSearch, { type Options as MiniSearchOptions } from 'minisearch';

import type {
  DocEntry,
  DocModule,
  DocSearchResult,
  DocSearchScope,
  DocSectionRef,
} from './types';

/**
 * Schema version for the on-disk prebuilt search index
 * (`assets/docs.search.json`). Bumped on any breaking change to the
 * serialized structure so a stale prebuilt forces a runtime fallback.
 *
 * Version 2: stores the MiniSearch index as a plain object (consumed by
 * `MiniSearch.loadJS`) instead of a pre-stringified `miniJSON` field.
 * Avoids escape-bloating the asset and a redundant second `JSON.parse`
 * on the cold-start path that every CLI invocation pays.
 */
export const DOCS_INDEX_SCHEMA_VERSION = 3;

/**
 * Single source of truth for MiniSearch construction. Both `createDocsIndex`
 * (build-time and runtime source-build path) and `MiniSearch.loadJS`
 * (runtime prebuilt path) read from this object so a config change in source
 * is automatically reflected by `DOCS_SEARCH_CONFIG_FINGERPRINT` below; a
 * fingerprint mismatch triggers a runtime fallback.
 *
 * Frozen at module load so a runtime mutation can't desync from the
 * fingerprint stored in the prebuilt envelope.
 */
export const DOCS_SEARCH_OPTIONS: MiniSearchOptions<DocEntry> = Object.freeze({
  fields: ['title', 'content', 'symbols'],
  // Keep storeFields minimal - everything the search/snippet path needs
  // is fetched via `entriesById`, not the index. `module` is stored only
  // because some callers filter on it directly from MiniSearch results.
  storeFields: ['module'],
  searchOptions: Object.freeze({
    boost: Object.freeze({ title: 2, symbols: 1.5 }),
    prefix: true,
  }),
}) as MiniSearchOptions<DocEntry>;

/**
 * Recursively-stable JSON.stringify that sorts keys at every nesting level.
 * Plain `JSON.stringify(obj, Object.keys(obj).sort())` only applies the
 * key allow list at the top level — nested object keys silently disappear,
 * which made `DOCS_SEARCH_CONFIG_FINGERPRINT` blind to changes inside
 * `searchOptions.boost`, `searchOptions.prefix`, etc. Captured by the
 * deep-review pass on PR #1143.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map(
    (key) =>
      `${JSON.stringify(key)}:${stableStringify(
        (value as Record<string, unknown>)[key]
      )}`
  );
  return `{${parts.join(',')}}`;
}

/**
 * Stable fingerprint of `DOCS_SEARCH_OPTIONS`. Used in the prebuilt index
 * envelope so a runtime that reads a prebuilt JSON with a different config
 * falls back to source-building rather than silently using stale options.
 */
export const DOCS_SEARCH_CONFIG_FINGERPRINT =
  stableStringify(DOCS_SEARCH_OPTIONS);

export function docsVisibilityFingerprint(flags: readonly string[]): string {
  const normalized = [...new Set(flags.map((flag) => flag.trim().toLowerCase()))]
    .filter(Boolean)
    .sort();
  return stableStringify(normalized);
}

export interface DocsIndex {
  mini: MiniSearch<DocEntry>;
  entriesById: Map<string, DocEntry>;
  symbolToSections: Map<string, DocSectionRef[]>;
}

export function createDocsIndex(entries: DocEntry[]): DocsIndex {
  const mini = new MiniSearch<DocEntry>(DOCS_SEARCH_OPTIONS);

  mini.addAll(entries);

  const { entriesById, symbolToSections } = buildEntryAndSymbolMaps(entries);

  return { mini, entriesById, symbolToSections };
}

/**
 * Build the `entriesById` and `symbolToSections` maps from raw entries.
 * Extracted so the prebuilt-index load path can rebuild these maps without
 * paying for minisearch index construction.
 */
function buildEntryAndSymbolMaps(entries: DocEntry[]): {
  entriesById: Map<string, DocEntry>;
  symbolToSections: Map<string, DocSectionRef[]>;
} {
  const entriesById = new Map<string, DocEntry>();
  const symbolToSections = new Map<string, DocSectionRef[]>();

  for (const entry of entries) {
    entriesById.set(entry.id, entry);

    const sectionSymbols = new Set<string>();
    for (const section of entry.sections) {
      if (!section.symbols.length) {
        continue;
      }

      for (const symbol of section.symbols) {
        sectionSymbols.add(symbol);
        const key = symbol.toLowerCase();
        const list = symbolToSections.get(key) ?? [];
        list.push({
          symbol,
          entryId: entry.id,
          module: entry.module,
          path: entry.path,
          title: entry.title,
          heading: section.heading,
          content: section.content,
          ...(entry.source ? { source: entry.source } : {}),
        });
        symbolToSections.set(key, list);
      }
    }

    for (const symbol of entry.symbols) {
      if (sectionSymbols.has(symbol)) {
        continue;
      }

      const key = symbol.toLowerCase();
      const list = symbolToSections.get(key) ?? [];
      list.push({
        symbol,
        entryId: entry.id,
        module: entry.module,
        path: entry.path,
        title: entry.title,
        heading: entry.title,
        content: entry.content,
        ...(entry.source ? { source: entry.source } : {}),
      });
      symbolToSections.set(key, list);
    }
  }

  return { entriesById, symbolToSections };
}

/**
 * Envelope written to `assets/docs.search.json` by the build-time index
 * emitter and read by `loadDocsIndexFromPrebuilt` at runtime. Versioned and
 * fingerprinted so a runtime that finds a stale or mismatched prebuilt
 * silently falls back to source-building rather than serving incorrect data.
 *
 * `miniSerialized` holds the plain-object form returned by
 * `MiniSearch#toJSON()`. Storing the live object (not a pre-stringified
 * inner string) means the outer `JSON.stringify` of the envelope handles
 * serialization exactly once, and the runtime load is a single
 * `JSON.parse` followed by `MiniSearch.loadJS` — no double-parse and no
 * escape-bloated string.
 *
 * `symbolToSections` is intentionally NOT persisted. We tried in PR #1143
 * round 3 and the empirical eval showed the larger JSON parse cost ate
 * the rebuild savings - net mean +3.4 ms across the default suite. The
 * runtime walk over `entries` is the right tradeoff.
 */
export interface PrebuiltDocsIndex {
  schemaVersion: number;
  configFingerprint: string;
  visibilityFingerprint: string;
  modules: DocModule[];
  entries: DocEntry[];
  miniSerialized: ReturnType<MiniSearch<DocEntry>['toJSON']>;
}

/** Build the on-disk envelope from a freshly constructed in-memory index. */
export function serializeDocsIndex(
  entries: DocEntry[],
  modules: DocModule[],
  index: DocsIndex,
  enabledFlags: readonly string[] = []
): PrebuiltDocsIndex {
  return {
    schemaVersion: DOCS_INDEX_SCHEMA_VERSION,
    configFingerprint: DOCS_SEARCH_CONFIG_FINGERPRINT,
    visibilityFingerprint: docsVisibilityFingerprint(enabledFlags),
    modules: [...modules].sort(),
    entries,
    miniSerialized: index.mini.toJSON(),
  };
}

/**
 * Rehydrate a `DocsIndex` from a prebuilt envelope. The caller is expected
 * to have already validated that the envelope's `schemaVersion`,
 * `configFingerprint`, and `modules` match what the runtime needs - this
 * helper trusts those invariants.
 */
export function loadDocsIndexFromPrebuilt(
  prebuilt: PrebuiltDocsIndex
): DocsIndex {
  const mini = MiniSearch.loadJS<DocEntry>(
    prebuilt.miniSerialized,
    DOCS_SEARCH_OPTIONS
  );
  const { entriesById, symbolToSections } = buildEntryAndSymbolMaps(
    prebuilt.entries
  );
  return { mini, entriesById, symbolToSections };
}

function buildSnippet(content: string, query: string, maxLength = 200) {
  const lower = content.toLowerCase();
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

  let matchIndex = -1;
  let matchLength = 0;

  for (const term of terms) {
    const index = lower.indexOf(term);
    if (index !== -1 && (matchIndex === -1 || index < matchIndex)) {
      matchIndex = index;
      matchLength = term.length;
    }
  }

  if (matchIndex === -1) {
    const snippet = content.slice(0, maxLength);
    return { snippet, snippetStart: 0, snippetEnd: snippet.length };
  }

  const start = Math.max(0, matchIndex - Math.floor(maxLength / 2));
  const end = Math.min(content.length, start + maxLength);
  const snippet = content.slice(start, end);
  return {
    snippet,
    snippetStart: matchIndex,
    snippetEnd: matchIndex + matchLength,
  };
}

function searchDocsByContent(
  index: DocsIndex,
  query: string,
  moduleFilter?: DocModule
): DocSearchResult[] {
  const results = index.mini.search(query);
  const filtered = moduleFilter
    ? results.filter((result) => result.module === moduleFilter)
    : results;

  return filtered.map((result) => {
    const entry = index.entriesById.get(result.id);
    const content = entry?.content ?? '';
    const { snippet, snippetStart, snippetEnd } = buildSnippet(content, query);
    return {
      id: result.id,
      module: (entry?.module ?? result.module) as DocSearchResult['module'],
      path: (entry?.path ?? result.path) as string,
      title: (entry?.title ?? result.title) as string,
      snippet,
      snippetStart,
      snippetEnd,
      score: result.score ?? 0,
      symbols: entry?.symbols ?? (result.symbols as string[]) ?? [],
      kind: 'doc',
      ...(entry?.source ? { source: entry.source } : {}),
    };
  });
}

function scoreSymbolMatch(symbolKey: string, terms: string[]): number {
  let score = 0;
  for (const term of terms) {
    if (symbolKey === term) {
      score += 3;
      continue;
    }
    if (symbolKey.startsWith(term)) {
      score += 2;
      continue;
    }
    if (symbolKey.includes(term)) {
      score += 1;
    }
  }
  return score;
}

function searchDocsBySymbols(
  index: DocsIndex,
  query: string,
  moduleFilter?: DocModule
): DocSearchResult[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

  if (!terms.length) {
    return [];
  }

  const results: DocSearchResult[] = [];
  for (const [symbolKey, sections] of index.symbolToSections.entries()) {
    const score = scoreSymbolMatch(symbolKey, terms);
    if (score <= 0) {
      continue;
    }

    for (const section of sections) {
      if (moduleFilter && section.module !== moduleFilter) {
        continue;
      }

      const { snippet, snippetStart, snippetEnd } = buildSnippet(
        section.content,
        query
      );
      results.push({
        id: section.entryId,
        module: section.module,
        path: section.path,
        title: section.title,
        heading: section.heading,
        symbol: section.symbol,
        snippet,
        snippetStart,
        snippetEnd,
        score,
        symbols: [section.symbol],
        kind: 'symbol',
        ...(section.source ? { source: section.source } : {}),
      });
    }
  }

  return results;
}

export function searchDocs(
  index: DocsIndex,
  query: string,
  moduleFilter?: DocModule,
  limit = 10,
  scope: DocSearchScope = 'docs'
): DocSearchResult[] {
  if (scope === 'docs') {
    return searchDocsByContent(index, query, moduleFilter).slice(0, limit);
  }

  if (scope === 'symbols') {
    const symbolResults = searchDocsBySymbols(index, query, moduleFilter).sort(
      (a, b) => b.score - a.score
    );
    return symbolResults.slice(0, limit);
  }

  const docResults = searchDocsByContent(index, query, moduleFilter);
  const symbolResults = searchDocsBySymbols(index, query, moduleFilter);

  return [...docResults, ...symbolResults]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
