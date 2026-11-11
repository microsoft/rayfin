## Context

Rayfin projects are currently expected to be single-package directories: a `rayfin/rayfin.yml` file at the project root and all service-relevant code (entities, functions, static assets) co-located in that same root.
npm/pnpm workspace monorepos split concerns across sub-packages (e.g., `packages/frontend/`, `packages/data/`, `packages/api/`), but the CLI has no way to express "the entity definitions live in `packages/data/`" — it always resolves relative to the project root.
This blocks workspace users from adopting Rayfin without restructuring their project layout.

The change introduces an optional per-service `path` field in `rayfin.yml`, resolved relative to the project root.
When absent, existing single-package resolution is preserved with no behavioral change.

Affected packages:

- **`@microsoft/rayfin-tools-common`** — `RayfinConfig` type definitions (`packages/tools/common/`)
- **`@microsoft/rayfin-cli`** — entity discovery, env generation, `rayfin up`, `rayfin dev` commands (`packages/tools/cli/`)
- **`samples/workspace-todo-app/`** — new npm-workspace sample

## Goals / Non-Goals

**Goals:**

- Add an optional `path?: string` field to every service entry that consumes code or files beyond `rayfin.yml` itself (currently: `data`, `staticHosting`, `functions`, `storage`; any future service following the same pattern should receive it by default)
- Implement a shared `resolveServicePath(projectRoot, servicePath?)` helper that returns `projectRoot` when `path` is absent
- Update entity discovery, build command execution, env generation, and `rayfin dev` to use the resolved service path
- Deliver a `samples/workspace-todo-app/` sample demonstrating a 3-package npm workspace wired via `path`
- Maintain full backward compatibility — omitting `path` must produce identical behavior to today

**Non-Goals:**

- Supporting absolute paths in the `path` field (relative paths only, anchored at the project root)
- Supporting `path` on `auth` — `auth` is fully host-managed with no external code input; if it gains code-input requirements in future, `path` should be added at that time
- Introducing a separate workspace manifest or discovery file outside `rayfin.yml`
- Automatic detection of workspace packages (explicit `path` values in `rayfin.yml` are required)
- Publishing `workspace-todo-app` as a scaffolding template

## Decisions

### D1: `path` lives on individual service entries, not at the top level

**Decision**: Add `path?: string` to every service entry that consumes code or files as input beyond `rayfin.yml` itself.
For the current service set that means `data` (entity definitions), `storage` (shares the same entity/data folder as `data`), `staticHosting` (source tree and build output), and `functions` (function code).
Services that are fully configuration-driven (`auth`) do not receive `path` unless they gain code-input requirements in a future change.
The field is placed inline on each service entry, not as a single top-level `workspaceRoot` or parallel `paths` map.

**Rationale**: The guiding principle is "if a service reads files from the project, it must be locatable to a specific package directory."
Applying this rule uniformly means `path` is always present where it is needed and absent where it is not, and the pattern naturally extends to new services without requiring a separate design decision each time.
A top-level `path` would force all services into one directory, defeating the purpose for multi-package layouts.
Inline service paths are consistent with the existing per-service configuration style already used by `dialect`, `folder`, and `buildCommand`.

**Alternative considered**: Top-level `workspace.packages` map — rejected because it requires the CLI to infer which service uses which package, introducing ambiguity.

---

### D2: `path` is resolved relative to the project root (directory containing `rayfin/`)

**Decision**: Treat `path` values as relative to `projectRoot` (the directory where `rayfin/rayfin.yml` was found), not relative to `process.cwd()` or the `rayfin/` subdirectory.

**Rationale**: `projectRoot` is the stable anchor already used by existing path resolution in the CLI.
Using `process.cwd()` would make behavior dependent on where the user runs the CLI, which is fragile.

**Alternative considered**: Relative to `rayfin/` — rejected because it would require paths like `../../packages/data` which is confusing and error-prone.

---

### D3: A dedicated `resolveServicePath` helper encapsulates the fallback logic

**Decision**: Add `resolveServicePath(projectRoot: string, servicePath?: string): string` to `@microsoft/rayfin-tools-common` (or co-locate it in the CLI's `config-utils.ts`).
The helper returns `resolve(projectRoot, servicePath)` when `servicePath` is present, and `projectRoot` when absent.

**Rationale**: The fallback-to-project-root pattern must be applied consistently in entity discovery, env generation, build command resolution, and `rayfin dev`.
Centralizing it prevents divergence between call sites and makes the "no path = project root" contract explicit and testable.

**Alternative considered**: Inline the fallback at each call site — rejected because there are at least four call sites and drift would likely introduce bugs.

---

### D4: `path` is added to `RayfinConfig` in `@microsoft/rayfin-tools-common`, not in CLI-local types

**Decision**: The `path` field is added to the canonical `RayfinConfig` interface in `packages/tools/common/src/config/types.ts` so tools can read it without duplication.

**Rationale**: `RayfinConfig` is already shared. Keeping `path` in the canonical type prevents tools from maintaining divergent models of path-qualified YAML.

---

### D5: `workspace-todo-app` template uses npm workspaces; Rush project validates via `rayfin init`

**Decision**: The sample's *template* uses the `workspaces` field in a root `package.json` (npm workspaces), representing the Builder experience.
The sample is registered as a single Rush project in the `samples` subspace.
Its Rush build pipeline runs `rayfin init -t ./template`, rewrites SDK deps to local paths, then installs and builds — dogfooding the template system and validating the workspace layout on every CI run.

**Rationale**: npm workspaces are the lowest common denominator for Builder-facing samples.
Rather than registering each sub-package in Rush (which would require the template to use `workspace:*` protocol and pnpm), the sample wraps the template in a thin Rush project that exercises `rayfin init`.
This validates both the template and the CLI's init command in a single build step, while keeping the template itself a faithful representation of what Builders will create.

### D6: `package.json` exports and `tsconfig.json` settings per package role

**Decision**: Each sub-package in the workspace sample follows one of three role profiles based on its runtime target.
The profiles are grounded in the repo's existing `tsconfig.base.json` (`"module": "esnext"`, `"moduleResolution": "bundler"`, ESM-only `exports`).

**Browser-only** (e.g., `packages/frontend/` — Vite/React app):

- `package.json`: `"type": "module"`. App packages (not consumed by other packages) omit `exports`.
  If the package is consumed as a library by other workspace packages, add:
  ```json
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" }
  }
  ```
- `tsconfig.json`: extend the workspace root `tsconfig.base.json`, keep `"lib": ["ES2022", "DOM", "DOM.Iterable"]`.
  Do **not** add `@types/node` — browser packages must not accidentally compile against Node.js globals.

**Node.js-only** (e.g., `packages/data/` — entity definitions; `packages/api/` — functions):

- `package.json`: `"type": "module"`.
  ```json
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" }
  }
  ```
- `tsconfig.json`: extend the workspace root `tsconfig.base.json`, override `"lib"` to `["ES2022"]` (drop `DOM`).
  Add `@types/node` as a dev dependency and include `"types": ["node"]` under `compilerOptions` so Node.js built-ins resolve correctly.

**Isomorphic / shared types** (e.g., `packages/shared/` — types used in both browser and Node.js):

- `package.json`: `"type": "module"`.
  ```json
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" }
  }
  ```
- `tsconfig.json`: extend the workspace root `tsconfig.base.json`, override `"lib"` to `["ES2022"]` (no `DOM`, no Node.js types).
  Isomorphic packages **must not** import from `node:*` built-ins or from DOM APIs directly — use dependency injection or conditional imports if environment-specific behaviour is needed.

**Rationale**: The `"moduleResolution": "bundler"` base already handles ESM cross-package imports without `.js` extension tricks.
Separating `lib` by role prevents accidental use of platform-specific globals (e.g., a data package calling `document.querySelector` or a frontend package calling `fs.readFileSync`), which would only surface as runtime errors.
CJS interop (`"require"` condition) is intentionally omitted — all packages in the workspace target modern toolchains (Vite, tsc, the Rayfin CLI) that consume ESM natively.

**Alternative considered**: A single shared tsconfig for all sub-packages — rejected because it forces the same `lib` on browser and Node.js packages, masking environment mismatches at compile time.

---

### D7: No migration required; a guided migration command is deferred to a future change

**Decision**: Existing single-package projects require no changes — omitting `path` is identical to today's behavior.
A guided migration command (e.g., `rayfin migrate workspace`) that restructures an existing project into a workspace layout is explicitly deferred to a separate, follow-on change.

**Rationale**: Forcing migration or prompting users during `rayfin up`/`rayfin dev` would be disruptive and is out of scope for a purely additive field.
However, the transition from a flat layout to a workspace layout is non-trivial (moving files, updating `package.json` references, rewriting `rayfin.yml`), and a guided command would meaningfully reduce the friction of adoption.
Deferring it keeps this change focused while explicitly preserving the intent to deliver the tooling later.

**Scope of the future migration command** (informational, not committed here):
- Detect the current single-package layout
- Propose a target workspace structure based on which services are enabled
- Move source files to sub-packages, update `rayfin.yml` with `path` values, and regenerate `package.json` workspace entries
- Provide a `--dry-run` flag and a rollback path

---

### D8: Data service supports a `buildCommand` for workspace pre-compilation

**Decision**: Add `buildCommand?: string` to the data service entry in `RayfinConfig`, mirroring the existing field on `staticHosting` and `functions`. When set, the CLI executes it from the resolved data service root before entity discovery.

**Rationale**: In a workspace layout, entity classes live in sub-packages that must be built before the CLI can import them. The `buildCommand` runs the workspace build (e.g., `npm run build` which invokes `tsc -b` and follows project references) to produce the `dist/` output that the CLI then imports via package exports (D11). In single-package projects the field is omitted and behavior is identical to before.

The build command runs with `cwd` set to the resolved data service root (e.g., `packages/data/`), consistent with how `staticHosting.buildCommand` and `functions.buildCommand` run from their respective service roots.

**Alternative considered**: Having the CLI automatically detect and build workspace dependencies — rejected because it would require the CLI to understand npm/pnpm workspace topology, which is out of scope and fragile. An explicit `buildCommand` gives the builder full control.

---

### D9: workspace-todo-app is Rush-managed via template init pattern

**Decision**: The `workspace-todo-app` is registered as a single project in `rush.json` (samples subspace). Its build pipeline:

1. `rayfin init target -t ./template --skip-install --overwrite` — scaffolds the template into `target/`
2. `link-local-sdk.js` — rewrites `@microsoft/rayfin-*` version specs to `file:` paths pointing at local monorepo packages
3. `npm install` + `npm run build` in `target/` — validates the output compiles

The `template/` directory is the source of truth (committed); `target/` is `.gitignored` (generated).

**Rationale**: Rush's pnpm workspace does not honor npm `workspaces` fields in nested projects — internal sub-packages don't get symlinked. Rather than fighting this (registering 4+ sub-packages, switching to pnpm workspaces), the template-init pattern gives us:

- Single `rush.json` entry
- CI validation of both the template content AND `rayfin init -t` correctness
- Clean separation: template/ shows the Builder experience; target/ is ephemeral build output
- No protocol mismatch (template uses npm workspaces natively; Rush doesn't need to understand them)

**Alternatives considered**:

- Standalone (not Rush-managed): no CI coverage, drift risk — rejected
- Register sub-packages individually in Rush: forces pnpm `workspace:*` protocol, 4+ rush.json entries, template no longer matches Builder experience — rejected
- pnpm workspaces with sub-package registration: cleaner than npm but same multi-entry complexity — rejected in favor of the simpler template-init approach

---

### D10: Entity definitions can be distributed across workspace packages

**Decision**: Entity definitions (decorated classes) are not required to all live in one package. The workspace sample demonstrates splitting entities: `Todo` and `Category` live in the `data` package while `Image` lives in the `shared` package. The combined `TodoAppSchema` type is assembled in the `data` package's `src/index.ts`, which re-exports all entity classes.

**Rationale**: Real workspace projects will naturally distribute domain types across packages by concern. With package exports entity resolution (D11), the CLI imports directly from the data package's `exports` entry point — the package's `index.ts` serves as the single collection point for all entities, regardless of which internal or external packages they originate from. No separate `rayfin/data/` re-export layer is needed.

This pattern requires that referenced packages are built before the CLI's entity discovery runs, which is why the `data.buildCommand` (D8) is essential for workspace layouts.

---

### D11: CLI resolves entities from package.json exports when available

**Decision**: When the data service root contains a `package.json` with an `exports` field (or `main`), the CLI imports entities directly from the resolved entry point rather than compiling `rayfin/data/` and globbing `rayfin/.temp/compiled/data/*.js`. The CLI falls back to the existing `compileRayfinDirectory` + glob approach when no `package.json` or resolvable exports exist.

The resolution order is:
1. `exports["."]` — conditional (`import` > `require` > `default`) or string shorthand
2. Top-level `exports` as a string
3. `main` field
4. Fallback: existing `compileRayfinDirectory` + glob

**Rationale**: Workspace packages already have a `package.json` with an `exports` entry pointing to the built output (e.g., `./dist/src/index.js`). The `buildCommand` (D8) ensures the package is built before discovery. Importing from the package's own exports entry is:
- **Simpler for the builder**: entity classes live in `src/` and are re-exported from `index.ts` — no need to maintain a parallel `rayfin/data/` directory with re-export files and a separate `rayfin/tsconfig.json`.
- **Consistent with Node.js conventions**: the CLI consumes the package the same way any other consumer would.
- **Backward compatible**: single-package projects (like the existing `todo-app`) don't have a `package.json` at the data service root, so they fall back to the existing `compileRayfinDirectory` + glob flow with zero changes.

The `resolvePackageExports()` function is exported from `dab-config-generator.ts` for testability and is covered by dedicated unit tests.

**Alternative considered**: Always requiring `rayfin/data/` re-export files — rejected because it adds boilerplate that workspace builders must maintain, creates confusion about where entity definitions "really" live, and is unnecessary when the package already exports everything the CLI needs.

---

## Risks / Trade-offs

- **Path traversal in `path` values** → Mitigation: validate that the resolved path stays within the project root at config-load time; reject paths with `..` components that escape the project boundary.
- **Sample drift** → `workspace-todo-app` could fall behind the main `todo-app` as features are added. Mitigation: the sample is explicitly scoped as a structural reference, not a feature showcase; keep it minimal.
- **No validation of `path` existence at startup** → A misconfigured `path` pointing to a non-existent directory will only surface as an error when the affected operation runs (e.g., entity discovery). Mitigation: add an existence check in `resolveServicePath` when a non-default path is provided, with a clear error message.

## Migration Plan

See D7.
No migration is required for existing projects — omitting `path` preserves current behavior exactly.

For projects adopting workspace layout:

1. Add `path: <relative-path>` to the relevant service entries in `rayfin.yml`.
2. Run `rayfin dev` or `rayfin up` as usual.
3. No lock-file or dependency changes are needed.

Rollback: remove the `path` fields from `rayfin.yml`.
No database or deployment state is affected.

A guided migration command to automate the transition from a flat to workspace layout is tracked as a follow-on change (see D7).

## Open Questions

- **Should `rayfin init` prompt for workspace layout during scaffolding?** Out of scope for this change but worth tracking as a follow-up once `workspace-todo-app` is validated.
- **Should `path` be supported on `auth`?** Currently excluded since it is fully host-managed, but a future need (e.g., auth middleware co-located in a separate package) could warrant it. Excluded for now.
- **Should the CLI auto-discover well-known workspace packages when `workspaces` is present in the root `package.json`?** If the root `package.json` declares npm workspaces and a service has no `path` set, the CLI could check for conventionally named packages (e.g., `frontend`, `data`, `functions`) and use them as defaults.
  This would be a **silent breaking change** for any existing workspace project that has packages with those names but relies on the current "absent `path` = project root" fallback — Rayfin would silently switch to a different directory with no config change.
  Two options to mitigate this if the feature is pursued in a future change:
  1. Emit a warning when a well-known package name is detected but no `path` is set, so users are aware before any behavior changes.
  2. Gate auto-resolution behind an explicit opt-in flag in `rayfin.yml` (e.g., `workspace.autoResolveServicePaths: true`) so the fallback contract is never broken implicitly.
- **Should the CLI expose a separate setting or flag for the Rayfin project root?** This would only be needed if we want to override the directory containing `rayfin/rayfin.yml`; it is not required for git-root mismatches today.
