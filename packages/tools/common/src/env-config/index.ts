/**
 * Shared environment-configuration model for Rayfin tools.
 *
 * Five `RAYFIN_*` env vars constitute the user-supplied "environment
 * override" model. They split into two semantically distinct groups:
 *
 *   - **Authentication overrides** (`auth` group) — `RAYFIN_AUTHORITY_HOST`,
 *     `RAYFIN_CLIENT_ID`, `RAYFIN_FABRIC_SCOPE`. These re-target the
 *     MSAL sign-in itself and SHOULD NOT be used by end-users; they
 *     exist so contributors can point the CLI at an alternate Fabric
 *     environment with a different Entra app registration.
 *
 *   - **Endpoint overrides** (`endpoint` group) — `RAYFIN_FABRIC_API_URL`,
 *     `RAYFIN_FABRIC_PORTAL_URL`. Each variable is read by
 *     downstream code via `process.env` and can be set independently
 *     (in the shell or in `rayfin/.env`) for one-off invocations.
 *
 * Persistence to `~/.rayfin/auth.json` is gated on the **auth** group.
 * Setting any auth var triggers persistence and requires all five
 * variables to be set; setting only endpoint vars is allowed but is
 * NOT persisted (the user is using them as one-off process env values).
 *
 * Callers (today: `@microsoft/rayfin-cli` and `@microsoft/create-rayfin`)
 * read these vars at startup so a single `rayfin login` against an
 * alternate Fabric environment survives across subsequent CLI /
 * `create-rayfin` invocations.
 *
 * Both the env-var → persisted-field mapping ({@link RAYFIN_ENV_CONFIG_VARS})
 * and the persisted shape ({@link EnvironmentConfig}) live here in
 * `@microsoft/rayfin-tools-common` so that the CLI, `create-rayfin`,
 * and any future tools share a single source of truth and don't take
 * dependencies on each other's internals.
 *
 * The shared model itself is **universal** — it does not import Node.js
 * APIs and is safe to bundle into browser/WebWorker consumers. The Node-only
 * filesystem hydration helper `bootstrapEnvironmentConfig` is also re-exported
 * below for convenience, but only Node-only consumers (CLI entry points) should
 * reference it. Browser/WebWorker consumers must import only the
 * universal symbols below.
 */

/**
 * Sub-fields of the persisted `environmentConfig` block in
 * `~/.rayfin/auth.json`. Each maps 1:1 to one of the five
 * `RAYFIN_*` environment variables in {@link RAYFIN_ENV_CONFIG_VARS}.
 */
export type EnvironmentConfigField =
  | 'authorityHost'
  | 'clientId'
  | 'fabricScope'
  | 'fabricApiUrl'
  | 'fabricPortalUrl';

/**
 * Group classification for each entry in {@link RAYFIN_ENV_CONFIG_VARS}.
 *
 * - `auth` — authentication override (`RAYFIN_AUTHORITY_HOST`,
 *   `RAYFIN_CLIENT_ID`, `RAYFIN_FABRIC_SCOPE`). Setting any auth var
 *   triggers persistence at login and requires every entry across
 *   both groups to be set.
 * - `endpoint` — endpoint override (`RAYFIN_FABRIC_API_URL`,
 *   `RAYFIN_FABRIC_PORTAL_URL`). When no auth var is set, endpoint
 *   vars can be set freely as one-off process env values but are not
 *   persisted by `rayfin login`.
 */
export type EnvironmentConfigGroup = 'auth' | 'endpoint';

/**
 * User-supplied environment configuration, persisted alongside the
 * auth state so that exporting the relevant `RAYFIN_*` env vars
 * (`RAYFIN_AUTHORITY_HOST`, `RAYFIN_CLIENT_ID`, `RAYFIN_FABRIC_SCOPE`,
 * `RAYFIN_FABRIC_API_URL`, `RAYFIN_FABRIC_PORTAL_URL`) once before
 * `rayfin login` survives across subsequent CLI invocations.
 *
 * The portal URL is included as a first-class knob (rather than relying
 * solely on derivation from the API host) because non-`*.fabric.microsoft.com`
 * Fabric hosts (for example, the `analysis-df.windows.net` family) have
 * no algorithmic relationship between their API host and the matching
 * portal host, and even within `*.fabric.microsoft.com` a single API
 * host (`api.fabric.microsoft.com`) maps to multiple legitimate portals
 * (`app`, `daily`, `dxt`). Persisting the portal URL avoids the
 * scaffolded project silently pointing at the production portal.
 *
 * All sub-fields are individually optional so the schema is forward-
 * compatible: future overrides can be added without invalidating older
 * persisted state, and an older CLI reading a newer file ignores any
 * unknown sub-fields.
 */
export interface EnvironmentConfig {
  /** Entra ID authority host (no trailing slash, no tenant segment). */
  authorityHost?: string;
  /** Entra ID first-party application client ID for MSAL. */
  clientId?: string;
  /** OAuth scope used when acquiring Fabric tokens. */
  fabricScope?: string;
  /** Fabric REST API base URL (typically `<origin>/v1`). */
  fabricApiUrl?: string;
  /** Fabric portal URL (typically with a trailing slash). */
  fabricPortalUrl?: string;
}

/**
 * The five environment-config knobs that constitute the user-supplied
 * Fabric environment override. Single source of truth shared by:
 *
 *   - {@link bootstrapEnvironmentConfig} (Node-only) — hydrates
 *     `envVar` from persisted `configField` at startup.
 *   - CLI `commands/login.ts` — reads `envVar` from `process.env`,
 *     enforces the persistence rule (auth-group var set ⇒ all five
 *     must be set ⇒ persist all five), and writes the persisted
 *     `configField`s on successful sign-in.
 *   - CLI `commands/logout.ts` — clears `envVar` from the in-process env.
 *
 * The `group` field tags each knob as either `auth` or `endpoint`; see
 * {@link EnvironmentConfigGroup} for the validation/persistence rules
 * keyed off the tag.
 *
 * Adding or renaming a knob means editing this array and nothing else.
 */
export const RAYFIN_ENV_CONFIG_VARS: ReadonlyArray<{
  /** `RAYFIN_*` env var read by tooling / hydrated by bootstrap. */
  envVar: string;
  /** Sub-field on the persisted `environmentConfig` block. */
  configField: EnvironmentConfigField;
  /** Validation group — see {@link EnvironmentConfigGroup}. */
  group: EnvironmentConfigGroup;
}> = [
  {
    envVar: 'RAYFIN_AUTHORITY_HOST',
    configField: 'authorityHost',
    group: 'auth',
  },
  { envVar: 'RAYFIN_CLIENT_ID', configField: 'clientId', group: 'auth' },
  { envVar: 'RAYFIN_FABRIC_SCOPE', configField: 'fabricScope', group: 'auth' },
  {
    envVar: 'RAYFIN_FABRIC_API_URL',
    configField: 'fabricApiUrl',
    group: 'endpoint',
  },
  {
    envVar: 'RAYFIN_FABRIC_PORTAL_URL',
    configField: 'fabricPortalUrl',
    group: 'endpoint',
  },
];

/**
 * Re-export the Node-only bootstrap helper from the same `_internal/env-config`
 * subpath so consumers have a single import site for the shared
 * environment-config model and the entry-point hydration helper.
 *
 * Only Node-only consumers (`@microsoft/rayfin-cli`,
 * `@microsoft/create-rayfin`) should call `bootstrapEnvironmentConfig`;
 * see `./bootstrap.ts` for details.
 */
export { bootstrapEnvironmentConfig } from './bootstrap.js';
