# Tools packages agent notes

Code under `packages/tools/**` is ESM.
Use `.js` in all relative import specifiers.

```ts
import { run } from './run.js';
import { readConfig } from '../config/readConfig.js';
```

## Shared code

`@microsoft/rayfin-tools-common` (`packages/tools/common/`) is a private package for code shared across CLI, `create-rayfin`, and MCP. It must stay **universal** (no Node.js or DOM-specific APIs). See [`packages/tools/common/AGENTS.md`](./common/AGENTS.md).

## Docs and MCP

`@microsoft/rayfin-docs` (`packages/tools/docs-lib/`) owns `DocsService`, installed package discovery, docs search, symbol lookup, and catalog-backed package recommendations.
See [`packages/tools/docs-lib/AGENTS.md`](./docs-lib/AGENTS.md) before editing it.

`@microsoft/rayfin-mcp` (`packages/tools/mcp/`) exposes the docs service to agents through `list_docs`, `search_docs`, `get_doc`, and `discover_packages`.
See [`packages/tools/mcp/AGENTS.md`](./mcp/AGENTS.md) before editing it.

Docs lookup must stay version-locked to packages installed in the user's Rayfin project.
Construct CLI and MCP docs services with `discover: { from: process.cwd() }` so a global CLI or `npx @microsoft/rayfin-mcp` still walks the project-local `node_modules`, not the tool install location.
Do not reintroduce the old MCP-bundled docs corpus as a fallback.

## Adding a new tools package

After scaffolding a new package under `packages/tools/`, add its directory to `entryPoints` in [common/config/typedoc/typedoc.lint.json](../../common/config/typedoc/typedoc.lint.json) so `rush lint` validates its TSDoc. See [common/config/typedoc/AGENTS.md](../../common/config/typedoc/AGENTS.md) for the full convention and troubleshooting notes (including the cross-package `dist/*.d.ts` resolution caveat).

## Public API documentation

For any tools package whose `src/index.ts` (or `package.json` `exports`) is consumed by Builders — `@microsoft/rayfin-cli`, `@microsoft/create-rayfin`, `@microsoft/rayfin-mcp` — every public symbol must have a Builder-facing TSDoc comment. The same rules apply as for the SDK:

- Write comments for Builders consuming the tool, not for Rayfin contributors. Prefer `@example` for non-trivial APIs.
- Do **not** reference internal helpers, non-exported types, internal module paths (`_internal/...`, `dist/...`), internal env vars / feature flags / secrets / endpoints, or contributor-only notes in public TSDoc.
- If a symbol is exported only for cross-package wiring, tests, or other contributor-only consumers, tag it `@internal` so it is stripped from the documented surface.

Private-only tools packages such as `@microsoft/rayfin-tools-common` don't ship to Builders, but anything they re-export to other tools packages should still be `@internal` unless it's intended for end-user consumption.

Full rules and examples: [common/config/typedoc/AGENTS.md](../../common/config/typedoc/AGENTS.md#public-api-documentation-requirements).

## Architecture migration (in progress)

The Rayfin tools line (CLI, `create-rayfin`, MCP) is migrating to the target architecture in [`docs/rfc/rayfin-tools-architecture.md`](../../docs/rfc/rayfin-tools-architecture.md). Live status and the per-PR breakdown live in [`docs/rfc/rayfin-tools-architecture-migration.md`](../../docs/rfc/rayfin-tools-architecture-migration.md).

Two principles when working on this migration matter for every PR:

**Dual-path via `tools-arch-v2` feature flag.** New code lands behind the flag and is off by default. CI E2E runs as a matrix (flag off + flag on) so regressions surface before the default flips. The carrying cost is one `if (flag) { v2 } else { legacy }` branch per Layer 1 wrapper; the safety from being able to roll back per command is worth it.

**State changes are the contract; output is not.** Current tool output (text and `--json`) is known-buggy. Parity assertions between the legacy and v2 paths target on-disk and cloud state, not printed bytes. When the new path produces cleaner JSON, clearer error messages, or improved progress output, that is **success, not a regression**. Use [`packages/tools/cli-e2e/src/helpers/state-equivalence.ts`](./cli-e2e/src/helpers/state-equivalence.ts) for parity comparisons rather than snapshotting output.

The migration is also a chance to *improve*. Where the new architecture naturally enables a better design — e.g., one telemetry event per workflow step instead of one per command, typed `Result<T>` instead of thrown control flow, cancellation between steps — take it. Document the decision in the migration PR; do not bolt the improvement onto the legacy path.
