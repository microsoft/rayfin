# @microsoft/rayfin-tools-common

Private, shared utility package for Rayfin tools (CLI, `create-rayfin`, MCP). Not published.

## Commands

| Command | Purpose |
| --- | --- |
| `rush build --to @microsoft/rayfin-tools-common` | Build package and dependencies |
| `rushx build` | Build (from project directory) |
| `rushx test` | Run tests with Vitest |
| `rushx clean` | Remove `dist/` and `.tsbuildinfo` |

## Subspace

`rayfin-cli` — shared with CLI and MCP.

```bash
rush update --subspace rayfin-cli
```

## Universal / Polymorphic Constraint

This package's **public, universal surface** (the `src/index.ts` barrel and the `_internal/adapters`, `_internal/checks`, `_internal/config`, `_internal/telemetry`, `_internal/utils/retry`, `_internal/workflows` subpath barrels) **must run in both Node.js and browser/WebWorker** environments.

The package also ships a small set of **Node-only** sub-modules (`_internal/env-config/bootstrap`, parts of `_internal/templates`) for consumers (CLI, `create-rayfin`) that need filesystem, child-process, or git access.
These Node-only sub-modules are isolated behind their own subpath exports so universal callers never pull them in.

Enforce the universal contract by:

- **Do not import Node.js built-ins (`fs`, `os`, `path`, `child_process`, `util`, `node:*`, etc.) from any file reachable through a universal subpath.** Node-only files must live under a clearly Node-only subpath (`env-config/bootstrap.ts`, `templates/git/**`, `templates/engine/file-processor.ts`, `templates/manifest/parser.ts`, `templates/registry/loader.ts`, `templates/catalog/resolver.ts`).
- **Universal subpath barrels (e.g. `env-config/index.ts`, `templates/index.ts`) MUST NOT re-export Node-only symbols by default.** The single deliberate exception is `bootstrapEnvironmentConfig`, which is re-exported from `_internal/env-config` for convenience and explicitly documented as Node-only — browser consumers must avoid importing it.
- **No `process.env` access from universal files.** Use the narrow ambient `process` declaration in [`src/typings.d.ts`](./src/typings.d.ts), which intentionally types `process` as possibly `undefined` even though `@types/node` is now installed. Always guard with `typeof process !== 'undefined'`.
- **No DOM-specific APIs** that aren't available in WebWorker (`document`, `window`).
- Only ES2022 language features, standard Web APIs (`fetch`, `URL`, `crypto.subtle`, etc.), and (in Node-only sub-modules) Node built-ins.

> `@types/node` **is** a devDependency of this package because the Node-only sub-modules need it to compile. The universal contract is enforced by the subpath structure and the narrow `process` redeclaration in `typings.d.ts`, not by the absence of Node typings.

If a utility needs Node.js APIs and would only be used by a single consumer, prefer putting it in that consumer package (e.g. CLI-local helpers).
Only place Node-only code here when it is genuinely shared across multiple tools (CLI, `create-rayfin`).

## Conventions

- ESM (`"type": "module"`) — use `.js` extensions in all relative import specifiers.
- Barrel export from `src/index.ts`.
- All universal exports must be re-exported from `index.ts` to be part of the public surface.
- Node-only exports MUST be reached only through their dedicated subpath (e.g. `_internal/templates`, `_internal/env-config`) and never added to `index.ts`.

## Telemetry Module

Shared, universal telemetry primitives exported via `._internal/telemetry`:

- `isTelemetryEnabled()` — policy gate; consumers pass pre-resolved booleans (no env-var reads).
- `InvocationContext` — per-invocation context: tracks command, timing, and result.
- Event schemas (`RayfinCommandEvent`, `RayfinFaultEvent`, `RayfinActionEvent`).
- Sanitization helpers (`sanitizeException`, `extractSafeParamNames`, `boundField`).

All telemetry code is universal (no Node.js APIs).
Platform-specific transport (such as the OpenTelemetry SDK) lives in consumer packages.

## Config Module

Shared configuration utilities exported via `._internal/config`:

- `parseRayfinYaml`, `parseRayfinYamlInterpolated` — parse `rayfin.yml`.
- `interpolateConfig`, `interpolateString`, `coerceType` — config interpolation.
- `DatabaseDialect` — dialect enum and types.

This module is universal — it does not import Node.js APIs. Consumers that need an `~/.rayfin` user config directory should derive it themselves (e.g. CLI's `RAYFIN_CONFIG_DIR` constant) rather than adding a Node-only helper here.

## Adapters Module (target architecture)

Platform-primitive interfaces exported via `._internal/adapters`. Part of the tools architecture migration (see [`docs/rfc/rayfin-tools-architecture.md`](../../../docs/rfc/rayfin-tools-architecture.md)). All universal — interfaces only, no implementations. Each host supplies one real impl per adapter; tests supply fakes.

- `Logger`, `Progress`, `Fs`, `CommandRunner`, `Http`, `SecretStore`, `Auth`, `UserInteraction`, `TelemetryHandle`, `CancellationToken`.
- **Verbose lives on `Diagnostics`, not `Logger`.** `Logger` is `log`/`warn`/`error` (normal human output; `log` is the info level). `Diagnostics.debug({ area, message, data })` is the structured verbose channel that Layer 1 renders or silences based on `--verbose` — the workflow never sees the flag. Do not add an `info`/`debug` level to the adapter `Logger`.
- **Naming caution:** the adapter `Logger` (`log`/`warn`/`error`, human-output rendering) is **distinct** from the legacy diagnostics `Logger` in `src/logger.ts` (`info`/`warn`/`error`/`debug`, used by telemetry and checks). They coexist under separate subpaths (`_internal/adapters` vs the root `_internal` barrel) until the diagnostics surface migrates. Do not merge them without a deliberate reconciliation.

## Workflows Module (target architecture)

Layer 2 workflow contracts exported via `._internal/workflows`:

- `Result<T>` (`ok` | `cancelled` | `failed`), `Workflow<Req, Res, Deps>`, `Step<I, O, Deps>`, plus the `ok` / `cancelled` / `failed` constructors.
- Phase 1 ships only the type primitives; concrete workflows (`up/`, `init/`, …) land in later phases.

## Retry Module

Universal retry primitives exported via `._internal/utils/retry`:

- `withRetry`, `HttpError`, `RETRY_CONFIG`, `parseRetryAfterHeader`. Single source of truth for transient-failure retry mechanics (RFC Rule #5). The CLI's `utils/retry-utils.ts` re-exports these for back-compat.

## Env-Config Module

Shared environment-configuration model exported via `._internal/env-config`:

- `EnvironmentConfig`, `EnvironmentConfigField`, `EnvironmentConfigGroup`, `RAYFIN_ENV_CONFIG_VARS` — universal types and metadata describing the five `RAYFIN_*` override variables.
- **Node-only**: `bootstrapEnvironmentConfig()` (defined in `env-config/bootstrap.ts`) hydrates `process.env.RAYFIN_*` from `~/.rayfin/auth.json` and uses `fs`, `os`, and `path`. It is re-exported from the `_internal/env-config` barrel for convenience but must only be invoked from Node entry points (CLI / `create-rayfin`). Browser consumers must import only the universal symbols listed above.
- **Back-compat**: the legacy `._internal/auth` subpath re-exports the same symbols and is **deprecated**. It exists only so existing CLI / `create-rayfin` imports keep working across the rename; new code MUST import from `._internal/env-config`. The module was renamed from `auth/` to free `services/auth/` for the Rayfin auth product service (see the tools architecture migration RFC).

## Templates Module

Extensible template engine exported via `._internal/templates`:

- **Universal**: types, validation helpers, manifest schema validation, scaffolding utilities, `isGitUrl`, `generateProjectSlug` — safe to bundle into browser consumers.
- **Node-only**: git fetcher, file processor, manifest parser, registry loader, and catalog resolver — these import `fs`, `fs/promises`, `os`, `path`, `child_process`, and `util`. Only import these from Node entry points; do not reference them from browser code.
