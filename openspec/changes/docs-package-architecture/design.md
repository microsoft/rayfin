## Context

Background on how docs ship today is in `openspec/changes/rayfin-docs-cli/design.md` and in the previous PR's
`RESULTS.md`. The relevant facts that motivate this change:

1. The docs corpus was bundled into `@microsoft/rayfin-mcp` at build time
   (`prebuild: shx cp -r ../../../docs/site/docs assets && tsx scripts/build-search-index.ts`). MCP@1.26.0
   tarball was ~2 MB; ~681 markdown files plus a 2 MB minisearch index.
2. `@microsoft/rayfin-cli` lists `@microsoft/rayfin-mcp` as a runtime dep and reaches the corpus via
   `import.meta.url` resolution into `node_modules/@microsoft/rayfin-mcp/assets/docs/`.
3. The corpus is welded to MCP's lockstep version (`typescript-sdk` policy, currently 1.26.0). Other SDK packages
   on the same policy share the version; the CLI is on its own `cli` policy.
4. The N=5 LLM-agent eval measured the docs UX across three transports (cli, mcp, raw-docs filesystem).
   `raw-docs` was within 1% of MCP on wall time and 7% cheaper on fresh input tokens — the bundled-for-perf
   argument no longer holds.

The design space for the per-package pivot has three real questions: (a) where does the indexer live, (b) how
do packages declare their docs, (c) how does the agent discover packages it doesn't have. The decisions below
fix each.

## Goals / Non-Goals

**Goals:**

- Eliminate doc-version drift between the displayed docs and the user's installed SDK packages.
- Make `@microsoft/rayfin-docs` the single backend used by every Rayfin doc-facing surface (MCP server, CLI,
  future bots, future CI lints).
- Close the four-package TypeDoc coverage gap (`rayfin-storage`, `rayfin-functions`, `rayfin-react`,
  `rayfin-auth-provider-fabric`, `fabric-embedded-host`) as part of the migration to per-package docs.
- Give the agent a structured "this package isn't installed but here's how to find out about it" answer for
  out-of-scope queries (T7 realtime, T3 stripe), via `discover_packages`.
- Maintain the existing CLI `--json --lean` shape and the MCP wire-level tool shapes so external consumers don't
  break across the migration.
- Give Phase 1 (`extract rayfin-docs`) a no-regression target by re-running the N=5 eval and comparing to the
  baseline `RESULTS.md` shipped in PR #1143.

**Non-Goals:**

- A live-fetch model where the agent pulls docs from a network endpoint at every query. The library reads
  installed packages from disk; catalog updates ship with `@microsoft/rayfin-docs` version bumps.
- Generating docs from typescript source on the fly. TypeDoc still runs at package build time; `assets/docs/`
  ships with the tarball.
- Solving the .NET host service version drift. That problem is bounded and gets phase-5 attention; per-package
  docs alone don't solve it because the host is server-side.
- Search ranking improvements. We carry forward minisearch's current ranking; Tier 1 Task B in the
  agent-friendliness plan is where ranking experimentation lives.

## Decisions

### 1. `@microsoft/rayfin-docs` is the central library; mcp/cli are thin surfaces

**Rationale:** The current architecture has `DocsService` living in `@microsoft/rayfin-mcp` and the CLI importing
it from there. That's backwards — `DocsService` is fundamental, the MCP server is one surface. By extracting the
library, we (a) decouple doc-content updates from MCP/CLI release cycles, (b) make new surfaces (bots,
CI lints) trivial to add, (c) eliminate the indirection where the CLI is "an MCP package consumer that doesn't
need an MCP server."

**Alternatives considered:**
- Keep `DocsService` in `rayfin-mcp` but make it a peer dep of all surfaces. Rejected: peer deps are awkward in
  monorepo workflows and don't actually decouple the release cycle.
- Move `DocsService` to `@microsoft/rayfin-tools-common`. Rejected: that package is for cross-tool utilities;
  docs is a major capability that deserves its own package boundary.

### 2. Each package declares docs via a `rayfinDocs` field in `package.json`

**Rationale:** The convention is the contract. By making it a `package.json` field rather than a magic directory
name, third-party packages can opt in unambiguously, and the indexer's discovery has a clear "is this a Rayfin
docs package?" signal that doesn't false-positive on packages that happen to have `assets/docs/` for unrelated
reasons.

**Field shape (proposed):**

```json
"rayfinDocs": {
  "version": 1,
  "dir": "assets/docs",
  "module": "rayfin-core",
  "kind": "api-reference"
}
```

- `version`: manifest schema version. Current value is `1`.
- `dir`: relative path from the package root to the docs directory. Default `assets/docs`.
- `module`: short identifier used for citations and module filtering (e.g. `rayfin-core`, `rayfin-data`,
  `guide`, `host`).
- `kind`: `"api-reference"` (TypeDoc-generated, owned by the package), `"guide"` (hand-authored cross-cutting
  content), or `"host"` (server-side reference). Drives display and grouping.

**Alternatives considered:**
- Magic `assets/docs/` directory with no metadata. Rejected: false-positive risk; no way to declare module
  identity or kind.
- A separate `.rayfin-docs.json` file at the package root. Rejected: adds another file to manage; `package.json`
  is the standard place for npm-resolvable metadata.

### 3. Cross-cutting Builder content moves to `@microsoft/rayfin-guide`

**Rationale:** Content like `getting-started/index.md`, `auth/overview.md`, `data/permissions.md`, `cli/*.md`
spans multiple SDK packages. It can't naturally live in any one of them. A dedicated `@microsoft/rayfin-guide`
package — markdown only, no code, declares `rayfinDocs.kind: "guide"` — gives the content a clear home and
lets it version on its own cadence (likely on the lockstep policy initially, but optionally independent later).

**Alternatives considered:**
- Put the guide content in `@microsoft/rayfin-docs`. Rejected: rayfin-docs is the LIBRARY (code only). Mixing
  content into it would give it a build pipeline (prebuild copies + index) and re-create the bundling problem
  we're trying to solve.
- Put the guide content in `@microsoft/rayfin-core`. Rejected: cross-cutting content shouldn't be owned by one
  SDK package.

### 4. Discoverability of not-yet-installed packages via bundled catalog

**Rationale:** The N=5 eval surfaced two consistent agent failure modes (T7 realtime, T3 stripe payments) where
the agent grep-spirals or fabricates because there's no structured "this isn't in your installed corpus, but
here's what would be" answer. The catalog gives the agent that signal — the package list is small (10s of
packages), authoritative (curated by the Rayfin team), and fits naturally inside `rayfin-docs`.

**Catalog manifest shape:**

```json
{
  "schemaVersion": 1,
  "generatedAt": "<ISO-8601>",
  "packages": [
    {
      "name": "@microsoft/rayfin-storage",
      "kind": "sdk",
      "summary": "Type-safe blob storage client...",
      "topics": ["blob upload", "file storage", "azure storage"],
      "installCommand": "npm install @microsoft/rayfin-storage",
      "homepageUrl": "https://docs.rayfin.dev/ts-sdk/rayfin-storage/"
    }
  ]
}
```

The `topics` array is what `CatalogResolver.discover(query)` matches against (plus name, summary).

**Alternatives considered:**
- Generate the catalog from the npm registry by listing `@microsoft/rayfin-*` packages. Rejected: noisy (catches
  internal-only packages, deprecated ones); requires network at install time; can't carry curated summaries.
- Hosted-only catalog (no bundled fallback). Rejected: breaks the offline story; a fresh-install agent should
  still be able to discover packages without network.

### 5. Bundled catalog only — updates ship as `rayfin-docs` version bumps

**Rationale:** Bundling a static `catalog.json` with `@microsoft/rayfin-docs` gives offline-correct behavior
and zero-config discovery. Catalog updates ride on the package's release cadence — to pick up newly-added
packages, consumers upgrade `@microsoft/rayfin-docs`. There is no hosted-endpoint refresh path: every install
gets a deterministic, signed-by-version catalog with no runtime network dependency.

**Alternatives considered:**
- Hosted-only catalog. Rejected: breaks the offline story; every cold start would attempt a network call.
- Hosted refresh as an opt-in (the prior Phase 5 plan). Dropped during the architectural pivot: the operational
  story (who runs the endpoint, what happens when it's unreachable, how does it stay in sync with the bundled
  catalog) added cost without solving a real Builder need at this stage. Bundled-with-version-bump is the
  simplest correct answer; we revisit only if cadence pressure ever materializes.

### 6. Cross-package symbol resolution via package-qualified lookup

**Rationale:** With per-package docs, multiple packages can define the same plain symbol name. The package source
metadata now gives agents a safe disambiguation path: `get_doc` / `getSymbolDocs` accepts plain symbols for
back-compat and package-qualified symbols such as `@microsoft/rayfin-data::EntityClient` or
`rayfin-data::EntityClient` when the caller needs one package's definition.

**Implementation note:** This PR handles lookup-time disambiguation in `@microsoft/rayfin-docs`. A richer docgen
symbol graph can still be added later if TypeDoc starts emitting explicit cross-reference metadata, but the current
PR does not require generated markdown IDs to change.

**Alternatives considered:**
- Lazy resolution at agent-query time only. Rejected: requires a network/IPC roundtrip per cross-reference;
  bad for token cost.
- Bake all cross-references into a giant offline graph. Rejected: defeats the per-package independence goal.

### 7. Cache the merged search index keyed by installed-package fingerprint

**Rationale:** Walking `node_modules/` and rebuilding the merged index on every CLI/MCP cold start would slow
the cold start meaningfully (today's prebuilt index loads in ~1.5s; rebuilding from scratch would be 3–5s).
Cache key:

```
sha256(schemaVersion, MiniSearch config, requested modules, sorted([(pkgName, pkgVersion, manifestModule, manifestKind) for each selected rayfinDocs package]))
```

Persist as `~/.rayfin/cache/projects/<project-hash>/docs-index-<hash>.json`. Invalidation is automatic — `npm install` changes the
fingerprint, the next CLI/MCP call rebuilds and prunes older `docs-index-*.json` files from that project-scoped cache directory.
If the default cache location is unwritable, implementations may use an equivalent temp-dir cache path for the
same fingerprint. CI environments can pre-warm the cache or pass `--no-cache`.

This is also the feature-availability contract for agents: `search_docs` only describes capabilities present in
the installed package versions. When a query misses, `discover_packages` can point at a package to install or at
an installed package to update, but the docs for that newer capability do not become available until the project
updates its dependency and the fingerprint changes.

`DocsService` keeps the validation path bounded by default: unless a caller passes explicit package roots or an
explicit candidate list, it probes the catalog-derived known Rayfin package list instead of walking every package
in a large `node_modules`. MCP constructs a fresh docs service for each docs tool request; cache hits keep that
request cheap while still detecting installs or updates during a long-running session.

**Alternatives considered:**
- No cache; rebuild every time. Rejected: regression vs current cold-start.
- File-watcher daemon. Rejected: infrastructure heavy.

### 8. Phasing — five phases, each shippable

The implementation is staged so each phase is independently valuable and reversible:

- **Phase 1: Extract `rayfin-docs` library.** Pure code refactor. mcp/cli switch to
  `import { DocsService } from "@microsoft/rayfin-docs"` and call it directly rather than importing docs logic
  through MCP.
- **Phase 2: `rayfinDocs` convention + multi-source discovery.** Pilot one or two SDK packages with their own
  `assets/docs/`. Indexer learns to merge package-owned sources and MCP/CLI use discovery as their docs source,
  not a copied MCP corpus.
- **Phase 3: Migrate all SDK packages.** Each lockstep package gets its own docs. `rayfin-guide` ships. The
  four-package TypeDoc coverage gap is closed.
- **Phase 4: bundled catalog + `discover_packages`.** Catalog manifest, CLI/MCP discovery surfaces. Eval gains
  discovery-task assertions.
- **Phase 5: Host-docs decoupling.** Host docs move to `@microsoft/rayfin-host-docs` so .NET host service
  reference content is owned by the host package itself, separate from the SDK / MCP corpus.

Phases 1-3 are required to deliver the "no drift" outcome. Phases 4-5 add value but the system works without
them.

### 9. `rayfin-mcp` removes its internal bundled corpus path

**Rationale:** Removing the bundled corpus from `rayfin-mcp` is safe for the supported MCP tool surface because
the server now reads package-owned docs through `@microsoft/rayfin-docs`. Direct filesystem reads from
`node_modules/@microsoft/rayfin-mcp/assets/docs/` were never an exported API; the eval harness migrates to walk all
installed `rayfinDocs`-declaring packages instead. The package change is recorded as a minor update because the MCP
server adds package discovery behavior while preserving its existing tool names and schemas.

### 10. Per-package `assets/docs/` is the single source of truth; the Docusaurus site renders from it

**Rationale:** This decision *replaces* the earlier non-goal that said `docs/site/docs/` would remain the
canonical authoring location. The pre-pivot framing kept two physical copies of the same content (the
authoring tree at `docs/site/docs/` plus the per-package tree at `<pkg>/assets/docs/`) which is exactly the
duplication problem this PR is supposed to remove. The right end-state is one author location per logical
doc.

**Where each kind of content lives in the end state:**

| Content kind | Author location | Notes |
|---|---|---|
| Hand-written Builder guides | `packages/guide/assets/docs/` | Migrated from `docs/site/docs/guide/` |
| TypeDoc reference per SDK package | `packages/typescript-sdk/<pkg>/assets/docs/` | Generated by `packages/docgen/` running per-package |
| DocFX host reference | `packages/host-docs/assets/docs/` | Generated from the .NET host projects |
| Catalog manifest | `packages/tools/docs-lib/assets/catalog.json` | Hand-curated; ships with rayfin-docs |

**How the Docusaurus site reads them:** the site uses `@microsoft/rayfin-docs` to discover workspace package roots
and then configures `@docusaurus/plugin-content-docs` with multiple instances — one per logical doc area
(Builder guide, each SDK package's reference, host reference). Each instance points at the package's own
`assets/docs/` directory and exposes it under a stable `routeBasePath` (for example `/docs/guide`,
`/docs/ts-sdk/rayfin-core`, `/docs/ts-sdk/rayfin-data`, `/docs/host`). The site reads from the per-package paths
directly with no copy step or generated tree. What an agent sees through `@microsoft/rayfin-docs` and what a
human reader sees on the website are produced from the same source files.

**Migration order (Phase 3b — separate follow-up PR):** docgen pipeline rewires (TypeDoc + DocFX emit
per-package) → guide content `git mv` from `docs/site/docs/guide/` to `packages/guide/assets/docs/` →
configure `@docusaurus/plugin-content-docs` multi-instance in `docs/site/docusaurus.config.js` → gitignore
`docs/site/docs/{guide,host,ts-sdk}/`. MCP/CLI must continue serving from package-discovered `assets/docs/`
throughout this migration so agents stay grounded on installed package versions (Decision 9).

### 11. Agent behavior for missing versus newer functionality

**Rationale:** Version-locked docs intentionally hide APIs that are not present in the user's installed package
versions. That prevents agents from recommending functionality that cannot compile or run. It creates two
separate "no result" cases, and both need explicit tool support:

1. **Package not installed.** The requested capability lives in a Rayfin package missing from the user's project.
   `discover_packages` returns the catalog entry plus an install command, e.g. `npm install @microsoft/rayfin-storage`.
2. **Package installed but too old.** The requested capability is real but newer than the installed package docs.
   The same catalog result carries an update command, e.g. `npm install @microsoft/rayfin-storage@latest`, and
   explains that docs are loaded from installed package versions.

The agent should search installed docs first, call catalog discovery only after a miss, then choose between
"install this package" and "update this package" based on whether the package is already present in the project
dependency graph.

## Open Questions

- **Q1.** Should `@microsoft/rayfin-guide` be on the typescript-sdk lockstep policy, on its own
  individualVersion policy, or independent? Lockstep gives version alignment with the SDK API the guide
  describes; independence lets us ship guide-only fixes without coordinating an SDK release. **Tentative
  position:** lockstep for Phase 3, with the option to break out later if guide cadence diverges.

- **Q2.** Where do TypeDoc-generated docs come from when the docgen pipeline runs?
  Today the central `packages/docgen/` config emits to `docs/site/docs/ts-sdk/`. In the new world it should emit
  per-package — into `packages/typescript-sdk/<pkg>/assets/docs/`. The pipeline gains an iteration over packages,
  each running TypeDoc with its own scope. **Tentative position:** keep the central config but add a
  per-package emit target; the central config decides what to scope to which package.

- **Q3.** What's the cache fingerprint when running from a workspace (i.e. `workspace:*` deps)?
  In a published-install case the version is concrete. In a Rush workspace it's `workspace:*`. We probably want
  to add a content hash (sha256 of `assets/docs/` tree) as a fallback fingerprint when version is `workspace:*`.

- **Q4.** Catalog generation cadence. If a new `@microsoft/rayfin-foo` package is added to the platform, how
  soon does the catalog reflect it? **Tentative position:** the catalog is regenerated on every Rush release
  via a script that walks all `rayfinDocs`-declaring packages on the typescript-sdk policy. So catalog updates
  ride along with the rest of the SDK release cadence.

- **Q5.** Does the catalog include packages that exist *outside* the npm @microsoft/rayfin-* scope? E.g. an
  internal package, a partner-team package, a third-party `rayfin-realtime-extension`. **Tentative position:**
  yes, the catalog supports an "external" entry kind. Useful for discovery but the indexer doesn't auto-trust
  external packages — they need to be manually installed.

## Risks

- **R1: Indexer cold start regression.** Walking `node_modules/` and merging packages is more work than loading
  one prebuilt index. Mitigation: aggressive caching (Decision 7), benchmarked against the N=5 eval baseline.
  Phase 1 acceptance gate: cold start within 10% of the current MCP load time.

- **R2: docgen pipeline complexity.** Per-package emit targets are a change to the central docgen config.
  Mitigation: keep the existing aggregated emit as a fallback during Phase 2 (dual-mode). Cut over to
  per-package only when Phase 3 is ready.

- **R3: Catalog staleness.** Bundled catalog will lag behind newly-published packages. Mitigation: catalog
  updates ship with each `rayfin-docs` release (every few weeks at typical SDK release cadence). If lag pressure
  ever materializes, we can revisit a hosted refresh; for now, version-bump-only keeps the operational story
  simple.

- **R4: Cross-package symbol references break during phased migration.** During Phase 2 (some packages migrated,
  some still in the bundled corpus), cross-references between a migrated package and a not-yet-migrated one
  could break. Mitigation: indexer's `SymbolResolver` handles both source styles during the transition;
  Phase 2 ships explicit dual-source support and an integration test that exercises a cross-source reference.

- **R5: Removed internal `rayfin-mcp` asset path** (Decision 9). Anyone reaching into `node_modules/@microsoft/rayfin-mcp/assets/docs/`
  directly breaks. Mitigation: search the codebase + docs + community references and provide a migration recipe
  in the package's changelog and the OpenSpec archive.

## Acceptance Criteria

**Phase 1 (extract library):**
- `@microsoft/rayfin-docs` is a published package with `DocsService` re-exported.
- `rayfin-mcp` and `rayfin-cli` import `DocsService` from `rayfin-docs`. No behavioural change.
- N=5 eval re-run shows ≤10% wall-time regression vs the baseline `RESULTS.md` and zero correctness regression.

**Phase 2 (rayfinDocs convention):**
- `rayfinDocs` field documented in `rayfin-docs/README.md` and validated by the indexer's loader.
- One pilot SDK package (proposed: `rayfin-core`) ships its own `assets/docs/` and is indexed via the new path.
- Dual-mode indexing (bundled + per-package) verified with an integration test.

**Phase 3 (full migration):**
- Every typescript-sdk lockstep package ships its own `assets/docs/` with `rayfinDocs` declared.
- The four currently-uncovered packages (`rayfin-storage`, `rayfin-functions`, `rayfin-react`,
  `rayfin-auth-provider-fabric`, `fabric-embedded-host`) have TypeDoc-generated reference docs.
- `@microsoft/rayfin-guide` ships with the migrated cross-cutting Builder content.
- `rayfin-mcp` ships without bundled docs while preserving its MCP tool surface.
- N=5 eval re-run: no correctness regression; expected wall-time tied with or marginally better than baseline
  due to docs being loaded only for installed packages (smaller working set).

**Phase 4 (catalog + discover):**
- `@microsoft/rayfin-docs` ships with a complete bundled `catalog.json` for every Rayfin package on the lockstep
  policy.
- `discover_packages` MCP tool and `rayfin docs discover` CLI subcommand functional.
- Eval gains discovery-task assertions (T3 stripe + T7 realtime score full credit when the agent surfaces a
  catalog answer).

**Phase 5 (decoupling):**
- `@microsoft/rayfin-host-docs` ships host service reference docs separately from the bundled MCP/rayfin-docs
  ecosystem, with its own `rayfinDocs` declaration the indexer picks up automatically.
