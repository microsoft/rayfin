# Spec Review Findings

This document records the rubber-duck review of `proposal.md` / `design.md` /
`tasks.md` / `specs/**` and how each finding is addressed before
implementation begins. Severity labels match the reviewer's output.

## Blocking issues

### B1. Rush lockstep contradiction prevents independent `rayfin-mcp` major bump

**Reviewer concern:** Phase 3 originally said we major-bump `rayfin-mcp` to
2.0.0, but `rayfin-mcp` is on the `typescript-sdk` lockstep policy.
SemVer-major-bumping only `rayfin-mcp` requires either (a) moving it off
lockstep, (b) bumping the whole SDK to 2.0.0, or (c) not treating asset removal
as a major.

**Resolution:**

- Add a new task in Phase 1 that moves `@microsoft/rayfin-mcp` off the
  `typescript-sdk` lockstep onto an `individualVersion` policy
  (`policyName: "rayfin-mcp"`, `lockedMajor: 1` initially).
- Treat removal of `node_modules/@microsoft/rayfin-mcp/assets/docs/` as removal
  of an internal asset path, not a supported public API, because the MCP tool
  names and schemas are preserved and now read package-owned docs through
  `@microsoft/rayfin-docs`.
- Add a new task in Phase 1 for `@microsoft/rayfin-docs`'s policy. Two
  candidates: (1) put it on `typescript-sdk` lockstep so it moves with the
  SDK API surface it indexes; (2) put it on its own individual policy.
  **Decision:** put it on `typescript-sdk` lockstep. The library reads
  versions of SDK packages it discovers; tying its own version to the SDK
  release cadence is the cleanest semver story.

### B2. Empty-corpus regression for CLI/MCP-only installs

**Reviewer concern:** Today, installing the CLI gives a Builder docs access
even outside a project (`rayfin docs search` works from anywhere). Phase 3
removes the bundled corpus and walks `node_modules` only. A user running
the CLI from a fresh directory or with no SDK installed gets an empty corpus.

**Resolution:**

- Adopt the reviewer's two-root source model:
  1. **Project corpus** — discovered from the Builder's project root
     (`process.cwd()` walking to the nearest `node_modules/`).
   2. **Tool baseline corpus** — `@microsoft/rayfin-guide` plus the catalog
      snapshot bundled in `@microsoft/rayfin-docs`. Resolved via
      `createRequire(toolPackageRoot)` so the baseline is always available.
- Update `proposal.md` and `design.md` to reflect the dual-source model in
  Decision 1 and Decision 4. Update `specs/rayfin-docs-library/spec.md`
  Requirement "Package Discovery" to specify ordered source roots:
  `[projectRoot, toolRoot]`.
- The eval's `raw-docs` transport gets the same dual-root semantics so its
  baseline matches CLI/MCP behaviour.

### B3. Untrusted `rayfinDocs` packages = prompt-injection / supply-chain risk

**Reviewer concern:** Indexing arbitrary package-provided markdown by default
turns any installed dependency into a documentation prompt-injection vector.
A malicious package declaring `rayfinDocs.module: "rayfin-core"` could poison
search results.

**Resolution:**

- Add a trust model (new Decision 10 in `design.md`):
  - **Default-trust scope:** `@microsoft/rayfin-*` only. Discovery indexes
    these without additional user opt-in.
   - **Catalog-trust:** packages explicitly listed in the bundled catalog
     are trusted by name. Useful for first-party packages outside the
     `@microsoft/rayfin-*` scope.
  - **User opt-in:** other `rayfinDocs`-declaring packages are NOT indexed
    by default. A `rayfin docs trust <package>` (or equivalent config in
    `~/.rayfin/trust.json`) is required to opt in.
- Add validation guards on every discovered package:
  - Reject duplicate `module` identifiers from non-default-trusted packages.
  - Reject `rayfinDocs.dir` values that resolve outside the package root
    (path-traversal protection).
  - Reject docs files larger than a configurable size limit (default 500 KB
    per file, 10 MB per package).
- Search results carry a `provenance: { package, version, trust }` field so
  consumers can render source/trust labels.
- Update `specs/rayfin-package-docs-convention/spec.md` with a new
  requirement enforcing the trust boundary.

## Should-fix issues

### S1. Discovery model insufficient for pnpm/Rush/workspaces

**Resolution:** Update `design.md` Decision 7 (cache) and add a new
Decision 11 covering discovery. Specify:

- Ordered roots: `[projectRoot, toolRoot, ...additionalRoots]`.
- Resolve packages via `createRequire(root).resolve("<pkg>/package.json")`
  for catalog-known packages, falling back to directory walking only for
  user-opt-in packages.
- Follow symlinks via `realpath`, with cycle protection.
- For pnpm symlink layouts, recognise `node_modules/.pnpm/.../node_modules/<pkg>`.
- For Rush workspace links, treat any `workspace:*`-resolved package as
  a content-hashed source for cache purposes.
- Add the explicit fixture matrix in `tasks.md` (npm flat, pnpm symlinks,
  nested, Rush workspace, scoped, duplicate versions).

### S2. Cache invalidation under-specified

**Resolution:** Update Decision 7 to use a richer cache key:

```
sha256({
  schemaVersion: DOCS_INDEX_SCHEMA_VERSION,
  searchConfigVersion: SEARCH_CONFIG_VERSION,
  rayfinDocsVersion: PKG_VERSION,
  sources: [
    {
      packageName,
      packageVersion,
      packageRoot: realpath,
      rayfinDocs: <normalized declaration>,
      contentSha: sha256(<docs tree>) // for workspace/local sources
    },
    ...
  ]
})
```

Atomic write (write-temp + rename). Schema validation on read with
rebuild-on-mismatch fallback.

### S3. Symbol ID migration unsafe; multiple ID formats

**Resolution:** Add a new section to `design.md` "Identity model" that picks
ONE canonical scheme:

- **Document ID:** `<packageName>::<relativePath>` (e.g.
  `@microsoft/rayfin-core::decorators/blob.md`).
- **Symbol ID:** `<packageName>::<exportName>` (e.g.
  `@microsoft/rayfin-data::EntityClient`).
- **Citation label:** `<module>::<short-path>` for human readability.
- **Old IDs:** maintained as aliases through MCP 2.x / CLI 1.x. The
  resolver tries the new ID first, falls back to old prefix mappings.
- **Module filter compatibility:** `--module ts-sdk` continues to mean
  "all `kind: api-reference` packages." `--module guide` →
  `@microsoft/rayfin-guide`. `--module host` → `@microsoft/rayfin-host-docs`
  when host docs are explicitly enabled.

Phase 2 dual-mode adds a deduplication rule: when the bundled corpus and a
per-package source both contain the same doc, the per-package source wins.

### S4. Phase 3 is too large; decompose

**Resolution:** Split Phase 3 into sub-phases in `tasks.md`:

- **Phase 3A**: migrate SDK packages incrementally; bundled corpus remains
  as fallback. Each SDK package is its own task with its own validation.
- **Phase 3B**: add `@microsoft/rayfin-guide`; CLI/MCP take it as runtime
  dep so it's always in the baseline corpus.
- **Phase 3C**: add CI gates proving every lockstep SDK package has valid
  `rayfinDocs` declaration + `assets/docs/` populated + included in
  publishable artifacts.
- **Phase 3D**: remove bundled MCP assets after the supported MCP tool surface
  has migrated to package-owned docs. Only after 3A-3C are green.

### S5. Backwards compatibility beyond MCP assets

**Resolution:** Add a BC checklist to `design.md`:

- Doc IDs returned by `search_docs` change format (new canonical scheme).
  External clients that store IDs and call `get_doc` later need backward
  resolution. **Action:** old IDs alias to new IDs through MCP 2.x.
- `--module` filter values stay the same (compatibility mapping above).
- JSON shape: `package` field is additive (existing `--lean` consumers
  unaffected). Snapshot tests added in Phase 1 to lock in the current
  shape and verify additions.
- `DocsService` import path changes from `@microsoft/rayfin-mcp` to
  `@microsoft/rayfin-docs`. **Action:** keep the supported MCP tool surface
  stable and avoid documenting the old internal asset path as a public API.
- Raw-docs transport: provide a `rayfin docs export --format raw-dir
  <out-dir>` command that materialises the merged corpus into a
  filesystem layout. Eval's raw-docs transport uses this rather than
  re-implementing discovery.

### S6. Catalog should arrive earlier

**Resolution:** Move basic `CatalogResolver` from Phase 4 → Phase 2. The
catalog snapshot ships in Phase 2 inside `@microsoft/rayfin-docs` with a
minimal initial manifest; rich `discover_packages` agent UX stays in Phase
4 but the resolver is in place earlier so Phase 3 doesn't regress discovery
for users searching for not-yet-installed packages.

### S7. Test strategy needs concrete fixture matrix

**Resolution:** Add to `tasks.md` Phase 1 (Section 1.5) and Phase 2
(Section 2.4):

- Fixture `node_modules` layouts: npm flat, pnpm symlinks (with `.pnpm`),
  nested, Rush workspace, scoped, duplicate versions.
- Malformed `rayfinDocs` field test cases.
- Path-traversal attempt rejection.
- Symlink cycle / escape detection.
- Cache hit / miss / corruption / schema-mismatch rebuild.
- `npm pack` artifact validation per migrated SDK package.
- Snapshot tests for existing CLI/MCP JSON output.

### S8. N=5 wall-time gates are weak

**Resolution:** Add deterministic perf gates alongside the LLM eval gates:

- Discovery cold-start time (median of 100 runs).
- Index build time on a 681-doc corpus.
- Cache load time.
- Process startup time for `rayfin docs --version` (lightweight CLI invocation).
- MCP server initialize time.
- Memory footprint at steady state.
- Search latency p50/p95 for a fixed query set.

LLM eval keeps N=5 as a smoke test for correctness regressions; the
perf gates use deterministic fixtures with stable medians.

### S9. Guide content ownership ambiguity

**Resolution:** Pick one canonical model. **Decision:** `packages/guide/assets/docs/`
becomes canonical after Phase 3B. `docs/site/docusaurus.config.ts` updates
to source from there. The Docusaurus site continues to render
equivalently. Contributors author guide content in
`packages/guide/assets/docs/` directly. `docs/site/docs/guide/` is
removed at Phase 3B (with a deprecation note pointing at the new
location).

### S10. Cross-package guide drift remains

**Resolution:** Add an optional `appliesTo` field to guide doc frontmatter:

```yaml
---
title: "Magic Link Sign-in"
appliesTo:
  "@microsoft/rayfin-data": ">=1.26 <2"
  "@microsoft/rayfin-core": ">=1.26 <2"
---
```

The indexer reads this; search results carry an `appliesTo` field;
agents/UIs can warn or filter when the user's installed package versions
don't satisfy the constraint. **Phase:** add the field validation in
Phase 2; populate the metadata for known guides in Phase 3B; surface
it in MCP/CLI outputs in Phase 4.

## Nice-to-have / deferred

### N1. Layer separation (`DocsSourceProvider` interface)

**Reviewer concern:** The library is described as reusable by web
surfaces, but `PackageDiscovery` is Node-specific.

**Resolution:** Add a `DocsSourceProvider` interface in Phase 1 that
`NodePackageDiscovery` implements. Future providers (browser-static,
hosted-fetch, in-memory test) can be added without forking the indexer.
Keep the interface minimal in Phase 1 — just enough for the Node
implementation to satisfy it.

### N2. Catalog drift UX

**Resolution:** Include `generatedAt` and `catalogSchemaVersion` in
discovery responses. If no match found and catalog is older than 30
days, surface a stale-catalog hint. Hosted refresh stays in Phase 5.

### N3. Install size budget

**Resolution:** Add tarball-size CI gates for each migrated SDK package
in Phase 3A. Per-package docs budgets: 500 KB normal, 2 MB hard cap with
review.

## What this means for implementation order

The blocking issues are addressed in **Phase 1** (lockstep policy update,
two-root source model, trust scope) so the foundation is sound. The
should-fix issues split between Phase 1 (cache key, identity model,
deterministic perf gates, fixture matrix, source provider interface) and
Phase 2-3 (catalog earlier, guide ownership canonical, appliesTo metadata).

Phase 1 is still the right starting point. The findings sharpen its
scope rather than expanding it.
