## Why

Today the entire Rayfin docs corpus has been bundled into `@microsoft/rayfin-mcp` and copied at build time from
`docs/site/docs/`. Every consumer (`rayfin-cli`, the MCP server itself, the eval harness, the new `raw-docs`
filesystem transport) reaches the same single corpus, version-locked to the MCP package's lockstep release
instead of the user's installed SDK packages.

That model has three structural problems that we've now measured:

1. **Doc drift is silent and possible.** A user who pins `@microsoft/rayfin-core@1.20.0` while transitively pulling
   `@microsoft/rayfin-mcp@^1.26.0` (the typical case after a CLI upgrade) gets docs for the 1.26.0 SDK API surface
   alongside an installed SDK at 1.20.0. The N=5 eval doesn't measure this directly, but the version-locking analysis
   walks through the scenarios where it bites.

2. **Coverage gaps are baked in at build time.** Four typescript-sdk packages on the lockstep policy have **no TypeDoc
   reference in the corpus today** (`rayfin-storage`, `rayfin-functions`, `rayfin-react`, `rayfin-auth-provider-fabric`,
   `fabric-embedded-host`). Adding them requires changes in the docgen pipeline, then a coordinated MCP release. There's
   no per-package agency.

3. **The agent has no path to discover packages it doesn't have installed.** Our N=5 LLM-agent eval shows the consistent
   failure mode: when a Builder asks "how do I do realtime subscriptions" or "how do I integrate Stripe", the agent
   either grep-spirals on raw-docs (T7 raw-docs +24.6s vs MCP) or fabricates an answer. There's no structured "this
   isn't in your installed corpus, but here's what would be" signal.

The proposed pivot makes `@microsoft/rayfin-docs` a **central indexing/discovery library** that walks the user's
installed packages and merges per-package docs into a unified search index. Each SDK package owns its own docs at its
own version; the indexer is version-agnostic about content and just discovers whatever's there. A new small
`@microsoft/rayfin-guide` package fills the cross-cutting Builder content gap, while a bundled catalog inside
`@microsoft/rayfin-docs` covers discoverability of packages the user hasn't installed yet.

This is a multi-phase change; the proposal scopes all five phases so dependencies are clear and so the eval baseline
(N=5 medians from the current PR) gives us a no-regression target across phases.

## What Changes

### New packages

- `@microsoft/rayfin-docs` — a runtime library exposing `DocsService`, `PackageDiscovery`, `SearchIndex`,
  `SymbolResolver`, and `CatalogResolver`. It owns the small bundled catalog snapshot used for package discovery. Used
  by `rayfin-mcp`, `rayfin-cli`, and any future surface (web playground, CI lints).
- `@microsoft/rayfin-guide` — markdown-only package holding cross-cutting Builder guides
  (`getting-started/`, `auth/overview.md`, `data/permissions.md`, `cli/*.md`, etc.). Declares the new `rayfinDocs`
  package.json field so the indexer picks it up.

### New convention

A `rayfinDocs` field in `package.json` declaring where a package's docs live and what kind they are. Adopted by every
typescript-sdk package and by `rayfin-guide`.

### Modified packages

- `@microsoft/rayfin-mcp` — drops the bundled docs corpus and the prebuild copy step. Becomes a thin MCP-tool surface
  that delegates to `rayfin-docs` discovery and indexing at runtime. Adds a new `discover_packages` tool.
- `@microsoft/rayfin-cli` — `docs list/search/get` subcommands re-implemented against `rayfin-docs`. Adds a new
  `rayfin docs discover <query>` subcommand. The CLI no longer reads docs from the MCP package. The `--lean` flag
  and compact JSON shipped in the prior PR remain.
- All typescript-sdk packages on the lockstep policy gain an `assets/docs/` directory and a `rayfinDocs` declaration.

### TypeDoc coverage gap closed

The current docgen pipeline doesn't generate references for `rayfin-storage`, `rayfin-functions`, `rayfin-react`,
`rayfin-auth-provider-fabric`, or `fabric-embedded-host`. Phase 3 fixes this as part of migrating each package to ship
its own docs.

### New agent capability

`discover_packages(query)` (MCP tool) and `rayfin docs discover <query>` (CLI command). Returns a structured list of
catalog matches with install commands when the query doesn't match anything in the installed corpus. Closes the
negative-task agent failure mode the eval surfaced.

## Capabilities

### New Capabilities

- `rayfin-docs-library` — runtime discovery, merging, indexing, search, and catalog resolution across packages with
  the `rayfinDocs` field. Replaces the bundled-corpus approach as the primary docs source for every Rayfin surface.
- `rayfin-package-docs-convention` — the `rayfinDocs` field in `package.json` declaring per-package doc roots, kind,
  and module identity. The mechanism that makes per-package docs ship with each package's version.

### Modified Capabilities

- `rayfin-docs-cli` — the CLI's `docs` subcommand group becomes a thin surface over `rayfin-docs`. Adds a `discover`
  subcommand and a `--package <name>` filter. The existing `--json --lean` shape and `list/search/get` subcommands
  remain compatible.
- `rayfin-mcp` (informally; the MCP server) — drops bundled assets and the prebuild step. Tool surface gains
  `discover_packages`. `list_docs`, `search_docs`, `get_doc` keep their wire shapes.
- `builder-documentation` — Builder guide content moves from `docs/site/docs/guide/` to a `@microsoft/rayfin-guide`
  package's `assets/docs/`. Authoring location and rendering on the Docusaurus site stay equivalent; the published
  artefact moves.

## Impact

### npm artifact shape changes

- `@microsoft/rayfin-mcp` tarball drops from ~2 MB to ~50 KB (no bundled docs).
- `@microsoft/rayfin-cli` tarball stays roughly the same; the CLI no longer transitively depends on `rayfin-mcp` for
  docs (it depends on `rayfin-docs` directly), so it sheds the FastMCP / zod / tsx footprint.
- Per-SDK-package tarballs each grow by their own docs (~50–500 KB depending on package surface). These costs are
  opt-in: a Builder who installs `@microsoft/rayfin-core` only pays for core's docs, not the entire corpus.
- A new `@microsoft/rayfin-guide` package (~1 MB) ships the cross-cutting guides.
- `@microsoft/rayfin-docs` ships a small bundled discovery manifest.

### Source structure changes

- `packages/tools/docs-lib/` — new home for `@microsoft/rayfin-docs`. Pure TypeScript library; no `prebuild` step.
- `packages/typescript-sdk/<pkg>/assets/docs/` — new per-package doc roots. Generated by an updated docgen pipeline.
- `packages/typescript-sdk/<pkg>/package.json` — adds `rayfinDocs` field.
- `packages/guide/` — new home for `@microsoft/rayfin-guide`.
- `packages/tools/docs-lib/assets/catalog.json` — bundled catalog snapshot used by `CatalogResolver`.
- `packages/tools/mcp/` — sheds `src/docs/` (lifted into rayfin-docs) and `assets/docs/` (no longer bundled). Becomes
  a small wrapper.
- `packages/tools/cli/src/commands/docs/` — re-implemented against `rayfin-docs`. The command surface stays the same
  for existing users; new `discover` subcommand added.
- `docs/site/docusaurus.config.ts` — uses `@microsoft/rayfin-docs` discovery to register one Docusaurus docs plugin
  instance per package-owned `assets/docs` source. The site no longer copies `packages/docgen/dist` into
  `docs/site/docs` before building.

### Eval harness changes

- The existing `eval/llm-agent-comparison/` harness's three transports (cli, mcp, raw-docs) keep working. The corpus
  underneath them changes from "bundled in MCP" to "merged from discovered packages" but the agent-facing tool surface
  is identical.
- A fourth optional transport (`rayfin-docs library directly`) is added to measure surface-layer overhead.
- Phase 4 introduces `discover_packages` evaluation tasks: queries about packages not currently installed should
  surface install recommendations rather than grep-spiraling.

### Backwards compatibility

- The MCP server's three existing tools (`list_docs`, `search_docs`, `get_doc`) keep their wire shapes. Existing MCP
  clients see no breaking change.
- The CLI's `docs list/search/get` keep their argv shapes. The `--lean` and `--json` flags continue to work.
- `@microsoft/rayfin-mcp@2.x` (the version that drops bundled docs) needs a major bump because the package no longer
  ships `assets/docs/` — any consumer that was reaching into `node_modules/@microsoft/rayfin-mcp/assets/docs/` directly
  (the eval's `raw-docs` transport, hypothetically external scripts) breaks. We migrate the eval and document the
  change in the migration guide.
- Per-package docs are an additive change for SDK packages (each package gains an `assets/docs/` it didn't have
  before). No existing consumers depend on the absence of that directory.

### Agent behavior for feature discovery

- If a feature lives in a package the project has not installed, `discover_packages` / `rayfin docs discover`
  returns the catalog entry and install command from `@microsoft/rayfin-docs`.
- If a feature exists only in a newer package version than the project currently has installed, the installed docs
  intentionally do not show it. The catalog response includes an update command so the agent can explain that the
  package must be upgraded before the newer functionality and its docs become available.
