# Rayfin Agent Skill & Plugin

## Purpose

Enable AI coding agents (Copilot CLI, Claude Code, VS Code Copilot Chat) to build Rayfin apps correctly by providing a skill with rules/anti-patterns and an MCP server for searchable documentation.

## Architecture

```text
1 published skill (rayfin-getting-started)   →  detect or scaffold a project, then hand off
1 in-project skill (rayfin, installed by CLI) →  rules, anti-patterns, CLI reference
1 MCP server (@microsoft/rayfin-mcp)          →  search_docs, get_doc, list_docs
```

The published skill installs globally and cannot know which Rayfin version a project pins, so it only routes.
The in-project skill is written by `rayfin init` and is version-locked to the packages actually installed, so it owns everything version-specific.
The MCP server provides what neither skill does — searchable API details on demand.

## Distribution

The plugin is developed in `plugin/` in this repo and mirrored to the public `microsoft/rayfin` repo, whose root *is* the plugin.
Builders install from the public repo and never see this one.
See [`.github/sync/README.md`](../../../.github/sync/README.md) for the mirror.

### Any harness

```text
npx plugins add microsoft/rayfin
```

The `plugins` CLI reads the vendor-neutral manifest and translates it into the native format for Claude Code, Cursor, Codex, Grok, Kimi, Copilot CLI, and VS Code.

### Copilot CLI

```text
/plugin marketplace add microsoft/rayfin
/plugin install rayfin@rayfin-skills
```

Discovery: `.github/plugin/marketplace.json` → `./` → `plugin.json` → `skills/`

### Gemini CLI

```text
gemini extensions install https://github.com/microsoft/rayfin
```

Discovery: `gemini-extension.json` at the repo root.

## Skill Content

### Rules (6 categories)

- **Platform**: TC39 decorators, Docker requirement, deployment targets, scaffolding with `npm create @microsoft/rayfin@latest`
- **Security**: Permission decorators required, RLS policies, publishable keys, Fabric SSO constraints
- **Data Modeling**: Entity decorators, field types, `@one`/`@many` relationships, FK naming (`{property}_id`), schema registration
- **Querying**: Fluent chain (`.select()` → `.where()` → `.orderBy()` → `.execute()`), FK filtering, `findById`, pagination
- **DAB / Schema**: `rayfin dev db apply`, `--force` flag, `--gen-config-only`, MSSQL constraints
- **Deployment**: Execute full workflow when user says "deploy" — `rayfin login` → `rayfin up` → `rayfin up status`

### Anti-Patterns (5)

- Never use raw `fetch()` for data operations
- Never omit permission decorators (defaults to overly permissive `authenticated: *`)
- Never use `@text()` without `max` on MSSQL — `NVARCHAR(MAX)` columns break DAB GraphQL schema generation and unique indexes
- Never use `@text()` for FK columns referencing `@uuid()` PKs
- Never skip `search_docs('known limitations')` before implementing entities

### Docs Lookup Order

Docs are package-owned. A package that ships them declares a `rayfinDocs` field in
its `package.json`, and `rayfinDocs.dir` gives the docs root (today, always
`assets/docs`). The version in `node_modules` is the version the project actually
has, so it is consulted first.

1. Read the owning package's docs directly — `@microsoft/rayfin-core` (decorators,
   field options, permission metadata), `@microsoft/rayfin-data` (queries,
   mutations, paging), `@microsoft/rayfin-guide` (guides, data modelling, auth, CLI
   workflows), `@microsoft/rayfin-client` (client composition)
2. `rayfin docs search '<topic>'` from the project root
3. `search_docs(query, module)` / `get_doc(...)` via MCP when connected

CLI and deployment questions have no `rayfinDocs` package; use `rayfin docs search`
or MCP for those.

## MCP Server

`@microsoft/rayfin-mcp` indexes the full Rayfin docs site and exposes:

- `search_docs(query, module)` — full-text search across `guide` and `ts-sdk` modules
- `get_doc(id | path | symbol)` — fetch by ID or resolve a symbol like `@entity`
- `list_docs(module)` — browse available topics

## File Layout

```text
plugin/                                staging copy of the public repo root
  skills/rayfin-getting-started/SKILL.md
  plugin.json                          vendor-neutral, and the root manifest
                                       the agent plugins schema expects
  .agents/plugins/marketplace.json
  .claude-plugin/plugin.json
  .claude-plugin/marketplace.json
  .codex-plugin/plugin.json
  .cursor-plugin/plugin.json
  .grok-plugin/plugin.json
  .kimi-plugin/plugin.json
  .github/plugin/marketplace.json      Copilot CLI
  gemini-extension.json
  kimi-marketplace.json

.github/sync/                          mirror into microsoft/rayfin
  plugin-export.paths
  plugin-version.paths
  promote.sh
  check-export.sh
  check-version.sh
  read-version.sh
  sync-local.sh
  selftest.sh
  README.md

packages/tools/cli/
  assets/agent-files/skills/rayfin/SKILL.md   version-locked in-project skill
```

## Future Work

### Auto-generated CLI Quick Reference

The `## CLI Quick Reference` section of `SKILL.md` is currently hand-maintained,
which puts it at risk of drifting from the actual CLI flag surface. Future work
should auto-generate that section at CLI build time by walking the Commander
tree and injecting the result between sentinel comments
(`<!-- BEGIN AUTO -->` / `<!-- END AUTO -->`) so the surrounding prose stays
hand-editable. Tracked alongside the skill bundling step in
`@microsoft/rayfin-cli`'s build pipeline (`scripts/bundle-templates.ts`).

### Provenance and producer authority

The current `ItemRecord.source` field is a forward-compatible Phase 1 stub:
every item carries `{ kind: 'cli', id: '@microsoft/rayfin-cli', versionOrSha }`
because the CLI is the only producer. Phase 2 introduces template-shipped
descriptors as a second producer (`{ kind: 'template', id: <template-id>,
versionOrSha: <template-sha> }`), and that's where provenance starts driving
behavior:

- **Orphan cleanup gating**: an item disappears from the active descriptor set
  for two unrelated reasons — the producer that wrote it stopped shipping it
  (genuine orphan), or the producer simply isn't loaded right now (e.g. branch
  switched to a different template revision). The current cleanup logic can't
  tell those apart. Phase 2 gates orphan cleanup on producer authority: only
  the producer that wrote an item can remove it, so a branch hop that loses a
  template-shipped item leaves the on-disk content intact instead of
  destructively cleaning up.
- **Branch-local CLI or template differences** must not corrupt cross-branch
  state. The provenance-aware orphan policy is the load-bearing piece here.
- **Template-shipped overrides of CLI-owned items**: precedence rules need to
  be defined so a template can ship a customized variant of `skill:rayfin`
  without colliding with the CLI's bundled version. Likely handled by giving
  templates their own namespace (e.g. `template:my-app:skill:rayfin`) instead
  of overriding existing ids.

### Provider model and plan/apply separation

The `AgentFilesManager` constructor's `descriptors` parameter is a Phase 1
seam, not the full provider boundary. Phase 2 needs:

- A `DescriptorProvider` interface so each provider can resolve its own set
  of descriptors at install time (CLI provider calls
  `getRayfinDescriptors(projectRoot)`; template provider reads
  `rayfin-template.yml`'s `agentExtensions` block).
- Explicit precedence rules between providers (today: only one).
- An asset/content injection boundary so providers can ship descriptor
  content without putting files inside the `@microsoft/rayfin-cli` package
  asset tree (S2-1 from the round-4 deep review).
- Public observed-state / desired-state / action types so consumers can
  preview and reason about reconcile decisions without going through
  `install()`. The current `--dry-run` flag delivers preview today via the
  same `install()` code path with writes short-circuited; the cleaner split
  introduces `planReconcile()` and `applyPlan()` as first-class API.

### Strategy.isOwnershipSigilBased()

`AgentFilesManager.classify()` and `qualifiesForAdoption()` branch on
`descriptor.kind` to decide whether sigil-based ownership applies (today:
only `skill`). When a third `ItemKind` is added, both call sites need to be
updated in lockstep. The right shape is a `Strategy.isOwnershipSigilBased()`
method so each strategy declares its own ownership semantics; the manager
then queries the strategy instead of branching on kind. Tracked as a
forward-compat refactor that lands when the third kind arrives.

### Lockfile traversal upper bound

`Object.keys(lockfile.items)` loops are bounded only by the lockfile's own
item count, which is user-writable. Realistic lockfiles have <10 items; a
hand-crafted lockfile with thousands of `<namespace>:<name>` entries would
cause O(n) file reads. Phase 2 should add an upper bound (e.g. 100 items)
in `validateLockfile` once the descriptor table grows large enough that the
limit becomes meaningful.

### Per-agent shim files

`AGENTS.md`, `.mcp.json`, and `.agents/skills/rayfin/SKILL.md` are the
universal-format files that Copilot CLI, VS Code Copilot, Claude Code,
Cursor, Gemini, and Codex either read directly or are converging on
reading. Agents that don't yet read these formats need per-agent shims:

- `.cursor/mcp.json` / `.cursor/rules.md` for Cursor
- `CLAUDE.md` for Claude Code
- `.gemini/settings.json` for Gemini CLI
- `.codex/AGENTS.md` for Codex

Per-agent shims are Phase 2 work — the descriptor table grows to include
per-agent shim variants, the strategies handle the per-agent format
translation, and the conflict matrix extends to cover shim-specific
behavior (e.g. shims should be lower-priority than the universal
counterpart).
