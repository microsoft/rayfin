# TypeDoc lint config — agent notes

[typedoc.lint.json](./typedoc.lint.json) is the validation-only TypeDoc config consumed by `rush lint` / `rush lint:check`.
It runs TypeDoc with `emit: "none"` to surface broken `{@link}` references, undocumented public symbols, and other TSDoc issues without producing any output.

The actual TypeDoc binary is installed via the `rush-prettier` autoinstaller ([common/autoinstallers/rush-prettier/package.json](../../autoinstallers/rush-prettier/package.json)); there is no dependency on the docgen package.

## When you add a new published TS/Node package

Add the package directory to the `entryPoints` array in [typedoc.lint.json](./typedoc.lint.json).
The list is **explicit** (not globbed) because TypeDoc 0.28's `packages` strategy does not support `!` negation, and we need to exclude a few packages (see below).

Conventions:

- New SDK package under `packages/typescript-sdk/<name>` → add `"../../../packages/typescript-sdk/<name>"`.
- New tools package under `packages/tools/<name>` → add `"../../../packages/tools/<name>"`.
- Keep the list sorted by path.
- Each entry must have a `package.json` and a `src/index.ts`; the `packageOptions.entryPoints` block forces TypeDoc to read source instead of the package's built `dist/*.d.ts`.

Run `rush lint` (or just `node common/autoinstallers/rush-prettier/node_modules/typedoc/bin/typedoc --options common/config/typedoc/typedoc.lint.json` from the repo root) after adding a package to confirm it passes.

## Currently excluded packages

These are deliberately omitted from the entry-point list:

- `packages/tools/common` — no `STAGED.md`, internal universal helpers only; not on the published docs surface.

If you exclude additional packages, document the reason here.

## Public API documentation requirements

The packages listed in `entryPoints` are published to Builders.
Every symbol on a package's public surface (anything re-exported through `src/index.ts`, or anything reachable through `package.json` `exports`) is treated as part of the documented API and must follow these rules.

**Builder-facing TSDoc.** Every public class, interface, type, function, constant, and decorator must have a TSDoc comment that:

- Describes what the symbol does and when a Builder would use it.
- Is written for a Builder consuming the SDK — not for a contributor working on Rayfin internals.
- Uses `@param`, `@returns`, `@throws`, `@example`, and `@remarks` where they add real value. `@example` is strongly preferred for non-trivial APIs.
- Does **not** leak implementation details. The following must not appear in public TSDoc:
  - Internal helper functions, private methods, or non-exported types (use inline backticks rather than `{@link}` if you have to name them).
  - Internal module paths or file locations (`_internal/...`, `dist/...`, source file paths).
  - Internal environment variables, feature flags, secrets, credentials, connection strings, internal endpoints, or telemetry keys.
  - References to internal infrastructure, build steps, deployment pipelines, or upstream service identifiers Builders don't operate.
  - "TODO", "HACK", or contributor-only notes — move those to inline `//` comments inside the function body.

**Hide what shouldn't be on the Builder surface with `@internal`.** If a symbol is exported only for cross-package wiring, tests, telemetry, or other contributor-only consumers, tag it `@internal`:

```ts
/**
 * Reset the catalog cache between tests.
 *
 * @internal
 */
export function _resetCatalogForTesting(): void {
  // ...
}
```

The lint config sets `excludeInternal: true` (both at the root and in `packageOptions`), so `@internal` symbols are stripped from the documented surface and their references no longer trigger `notExported` warnings. Prefer `@internal` over creating a parallel `_internal/...` subpath when the symbol genuinely needs to be exported.

**When in doubt:** if a symbol is exported but isn't useful to a Builder, mark it `@internal`. If a symbol is useful to a Builder, give it a real Builder-facing comment with an example.

## Caveats and troubleshooting

### Stale `dist/*.d.ts` in dependency packages can cause false positives

`packageOptions.entryPoints: ["./src/index.ts"]` only controls how each package's *own* sources are read. When package A in the lint set imports types from package B via `@microsoft/rayfin-*`, the import resolves through `node_modules` → pnpm workspace symlink → B's `package.json` `types` field → `B/dist/index.d.ts`.

If B's `dist/` hasn't been rebuilt after a TSDoc edit, validation will report warnings (e.g. "Failed to resolve link to X") that don't appear in B's source.

**Symptoms:** `rush lint` reports a `{@link}` failure for a symbol in a *dependency* package even though `grep` shows that link no longer exists in source.

**Fixes (pick one):**

- Build the dependency package: `cd packages/<group>/<dep> && rushx build`, then re-run `rush lint`.
- Run a fresh repo-wide `rush build` before `rush lint` in CI.
- (Longer-term) Add `tsconfig` `paths` in `typedoc.lint.json` to redirect `@microsoft/rayfin-*` to source directories.

### Adding a re-export surfaces new `notExported` warnings

Re-exporting a type via the package's public `src/index.ts` brings its *transitive* type dependencies into the public surface. TypeDoc then warns about any of those that aren't also exported.

Fix by re-exporting the transitive types as well, or by replacing the public-API reference with a structural type / inline shape.

### Negative globs in `entryPoints` are not supported

TypeDoc 0.28's packages strategy parses `!pattern` as an empty path and crashes with `ENOENT: ... scandir ''`.
Enumerate the included packages explicitly instead.

### `{@link X}` references that cross package boundaries

TSDoc links resolve only within the conversion context of the package where the comment is *consumed*. When a comment on a re-exported type travels into a downstream package (e.g. `DocsService`'s constructor docs flowing into `@microsoft/rayfin-mcp`), bare `{@link Foo}` references can fail to resolve.

Prefer inline code (`` `Foo` ``) over `{@link Foo}` for any identifier defined in a different package than the comment, or for identifiers that aren't part of the public exported surface.

### `{@link X}` resolves in comment bodies but not inside `@throws`

TypeDoc resolves `{@link …}` in the prose body of a comment against the file's visible/imported symbols, so a body link like `{@link NetworkError}` resolves through `import { NetworkError } from '@microsoft/rayfin-lib'`. Inside an `@throws` tag the resolver uses a narrower scope — effectively the package's own exported reflections under `entryPointStrategy: "packages"` — so cross-package symbols fail with `Failed to resolve link to "…"` even though the same link works three lines up in the body of the same comment.

Convention for `@throws`:

- **Same-package error types** → use `{@link FunctionsError}` (same-package symbols resolve in `@throws`).
- **Cross-package error types** (anything from `@microsoft/rayfin-lib` such as `SdkError`, `NetworkError`, `AuthError`) → use inline code `` `NetworkError` ``.
- **Globals** (`Error`, `TypeError`, …) → use inline code `` `Error` ``.
- In the prose body of the same comment, `{@link CrossPackageType}` is fine and is the preferred form for narrative cross-references.
