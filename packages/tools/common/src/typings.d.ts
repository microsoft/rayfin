/**
 * Narrow ambient redeclaration of `process` that intentionally overrides
 * the rich `NodeJS.Process` type from `@types/node`.
 *
 * Even though `@types/node` is now a devDependency (required to compile
 * the Node-only sub-modules under `_internal/env-config` and `_internal/templates`),
 * the **public, universal** surface of this package must still tolerate
 * running in browsers / WebWorkers where `process` is
 * undefined. This local declaration keeps `process` typed as possibly
 * `undefined` and limited to a small allowlist of fields, so universal
 * code is forced to write `typeof process !== 'undefined'` guards and
 * cannot accidentally reach for Node-only members like `process.cwd()`
 * or `process.argv`.
 *
 * `stderr` is declared as optional so the Node-only
 * `bootstrapEnvironmentConfig` helper (re-exported from the
 * `_internal/env-config` subpath) can write diagnostics under a non-null
 * narrowing — universal callers must not touch this field.
 *
 * Node-only sub-modules that genuinely need the full `NodeJS.Process`
 * surface should import from `node:process` explicitly rather than
 * relying on the global.
 */
declare const process:
  | {
      env: Record<string, string | undefined>;
      platform: string;
      stderr?: { write(message: string): boolean };
    }
  | undefined;
