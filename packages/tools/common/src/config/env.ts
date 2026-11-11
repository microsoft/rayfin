/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DeploymentInfo } from './types.js';

/**
 * Shared `.env` file parser and serializer.
 *
 * Universal: no `node:fs` imports. The caller reads/writes the file content.
 *
 * Used by `@microsoft/rayfin-cli` for `.env` I/O.
 */

/**
 * Parse `.env` file content into a `Map<key, value>`.
 *
 * Supports:
 * - `KEY=VALUE` and `export KEY=VALUE`.
 * - `#` comments (full-line only).
 * - Single- and double-quoted values; quotes are stripped.
 * - Inside double-quoted values, the escape sequences `\n`, `\r`, `\t` are expanded.
 * - Blank lines and surrounding whitespace are ignored.
 *
 * Later occurrences overwrite earlier ones (matches `dotenv` behavior).
 */
export function parseEnvContent(content: string): Map<string, string> {
  const vars = new Map<string, string>();

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    // Strip optional `export ` prefix.
    const stripped = line.startsWith('export ')
      ? line.slice('export '.length).trim()
      : line;

    const eq = stripped.indexOf('=');
    if (eq <= 0) {
      continue;
    }

    const key = stripped.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }

    let value = stripped.slice(eq + 1).trim();

    // Strip a trailing inline comment only when the value is unquoted.
    const firstChar = value.charAt(0);
    const isDoubleQuoted = firstChar === '"' && value.endsWith('"');
    const isSingleQuoted = firstChar === "'" && value.endsWith("'");

    if (isDoubleQuoted) {
      value = value
        .slice(1, -1)
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t');
    } else if (isSingleQuoted) {
      value = value.slice(1, -1);
    } else {
      // Strip trailing inline comment: value # comment
      const hashIdx = value.indexOf(' #');
      if (hashIdx !== -1) {
        value = value.slice(0, hashIdx).trimEnd();
      }
    }

    vars.set(key, value);
  }

  return vars;
}

/**
 * Serialize a variable map to `.env` file content.
 *
 * Values containing whitespace, `#`, or `"` are double-quoted with `\n`, `\r`,
 * `\t` escaped. Keys are emitted in insertion order (use a pre-sorted Map if
 * alphabetical output is desired).
 *
 * @param vars - Variables to serialize.
 * @param header - Optional multi-line header (each line will be prefixed with `# `
 *               if it does not already start with `#`). A trailing blank line
 *               is inserted automatically.
 */
export function serializeEnvContent(
  vars: Map<string, string>,
  header?: readonly string[]
): string {
  const lines: string[] = [];

  if (header && header.length > 0) {
    for (const line of header) {
      lines.push(line.startsWith('#') || line === '' ? line : `# ${line}`);
    }
    if (lines[lines.length - 1] !== '') {
      lines.push('');
    }
  }

  for (const [key, value] of vars) {
    lines.push(`${key}=${formatEnvValue(value)}`);
  }

  return lines.join('\n') + '\n';
}

/**
 * Merge `updates` into `base`, returning a new Map.
 * Values in `updates` win. Preserves insertion order of `base`, then appends
 * new keys from `updates`.
 */
export function mergeEnvVars(
  base: Map<string, string>,
  updates: Map<string, string>
): Map<string, string> {
  const merged = new Map(base);
  for (const [key, value] of updates) {
    merged.set(key, value);
  }
  return merged;
}

function formatEnvValue(value: string): string {
  // Quote if value contains whitespace, `#`, `"`, or control characters.
  if (/[\s#"]/.test(value) || /[\n\r\t]/.test(value)) {
    const escaped = value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    return `"${escaped}"`;
  }
  return value;
}

// ── Frontend framework mapping for `rayfin env` ────────────────────────

/**
 * Supported frontend frameworks for `rayfin env --framework`.
 */
export type FrontendFramework = 'vite' | 'nextjs' | 'plain';

/**
 * Map a Rayfin `RAYFIN_PUBLIC_*` variable to the framework-specific variable
 * name a frontend build pipeline expects.
 *
 * For `vite` and `nextjs`, well-known keys map to their canonical frontend
 * names (e.g. `RAYFIN_PUBLIC_ITEM_ID` → `VITE_FABRIC_ITEM_ID`, not
 * `VITE_RAYFIN_PUBLIC_ITEM_ID`). These mappings are the supported public
 * surface for builders and are documented in
 * `packages/guide/assets/docs/cli/environment-variables.md`. Any custom
 * `RAYFIN_PUBLIC_*` variable not listed here is translated generically
 * (framework prefix + `RAYFIN_` + original key minus `RAYFIN_PUBLIC_`).
 */
const FRAMEWORK_ALIASES: Record<
  Exclude<FrontendFramework, 'plain'>,
  Record<string, string>
> = {
  vite: {
    RAYFIN_PUBLIC_API_URL: 'VITE_RAYFIN_API_URL',
    RAYFIN_PUBLIC_PUBLISHABLE_KEY: 'VITE_RAYFIN_PUBLISHABLE_KEY',
    RAYFIN_PUBLIC_FUNCTIONS_URL: 'VITE_RAYFIN_FUNCTIONS_URL',
    RAYFIN_PUBLIC_ITEM_ID: 'VITE_FABRIC_ITEM_ID',
    RAYFIN_PUBLIC_WORKSPACE_ID: 'VITE_FABRIC_WORKSPACE_ID',
    RAYFIN_PUBLIC_TENANT_ID: 'VITE_FABRIC_TENANT_ID',
    RAYFIN_PUBLIC_PORTAL_URL: 'VITE_FABRIC_PORTAL_URL',
    RAYFIN_PUBLIC_SERVICE_MODE: 'VITE_SERVICE_MODE',
    RAYFIN_PUBLIC_FRONTEND_PORT: 'VITE_PORT',
  },
  nextjs: {
    RAYFIN_PUBLIC_API_URL: 'NEXT_PUBLIC_RAYFIN_API_URL',
    RAYFIN_PUBLIC_PUBLISHABLE_KEY: 'NEXT_PUBLIC_RAYFIN_PUBLISHABLE_KEY',
    RAYFIN_PUBLIC_FUNCTIONS_URL: 'NEXT_PUBLIC_RAYFIN_FUNCTIONS_URL',
    RAYFIN_PUBLIC_ITEM_ID: 'NEXT_PUBLIC_FABRIC_ITEM_ID',
    RAYFIN_PUBLIC_WORKSPACE_ID: 'NEXT_PUBLIC_FABRIC_WORKSPACE_ID',
    RAYFIN_PUBLIC_TENANT_ID: 'NEXT_PUBLIC_FABRIC_TENANT_ID',
    RAYFIN_PUBLIC_PORTAL_URL: 'NEXT_PUBLIC_FABRIC_PORTAL_URL',
    RAYFIN_PUBLIC_SERVICE_MODE: 'NEXT_PUBLIC_SERVICE_MODE',
    RAYFIN_PUBLIC_FRONTEND_PORT: 'PORT',
  },
};

const FRAMEWORK_PREFIX: Record<Exclude<FrontendFramework, 'plain'>, string> = {
  vite: 'VITE_',
  nextjs: 'NEXT_PUBLIC_',
};

/**
 * The `RAYFIN_PUBLIC_` prefix. Only variables with this prefix are exposed to
 * frontend builds via {@link mapPublicEnvForFramework}.
 */
export const RAYFIN_PUBLIC_PREFIX = 'RAYFIN_PUBLIC_';

/**
 * Given a `RAYFIN_PUBLIC_*` key, return the framework-specific target key.
 * Returns `null` if the key does not start with `RAYFIN_PUBLIC_`.
 */
export function mapPublicEnvKey(
  key: string,
  framework: FrontendFramework
): string | null {
  if (!key.startsWith(RAYFIN_PUBLIC_PREFIX)) {
    return null;
  }
  if (framework === 'plain') {
    return key.slice(RAYFIN_PUBLIC_PREFIX.length);
  }
  const aliased = FRAMEWORK_ALIASES[framework][key];
  if (aliased) {
    return aliased;
  }
  // Generic fallback: retain the `RAYFIN_` brand so custom keys are
  // consistent with the alias table (e.g. RAYFIN_PUBLIC_FOO → VITE_RAYFIN_FOO).
  return (
    FRAMEWORK_PREFIX[framework] +
    'RAYFIN_' +
    key.slice(RAYFIN_PUBLIC_PREFIX.length)
  );
}

/**
 * Filter a variable map to `RAYFIN_PUBLIC_*` entries and remap keys for the
 * given frontend framework.
 *
 * Secrets and tooling overrides (any key without the `RAYFIN_PUBLIC_` prefix)
 * are dropped — they are never exposed to frontend builds.
 */
export function mapPublicEnvForFramework(
  vars: Map<string, string>,
  framework: FrontendFramework
): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, value] of vars) {
    const mapped = mapPublicEnvKey(key, framework);
    if (mapped !== null) {
      result.set(mapped, value);
    }
  }
  return result;
}

// ── Deployment helpers ─────────────────────────────────────────────────

/**
 * Sanitize a Fabric workspace display name into a registry-safe slug.
 *
 * Rules match the legacy `.env.fabric-*` suffix sanitizer so workspace keys
 * remain stable across the migration.
 *
 * Input is truncated to 200 characters before processing to bound regex cost
 * (CodeQL: polynomial-regex mitigation).
 */
export function sanitizeWorkspaceName(displayName: string): string {
  const bounded = displayName.slice(0, 200);
  return bounded
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Compose the canonical Fabric deep link to a deployed Rayfin item.
 *
 * Shape: `<portalUrl>/groups/<workspaceId>/appbackends/<itemId>[?ctid=<tenantId>]`.
 *
 * Trailing slashes on `portalUrl` are stripped so callers can pass settings
 * values verbatim without producing `//groups/...`. The `?ctid=` suffix is
 * appended last so the marker `/groups/.../appbackends/` consumed by
 * {@link extractPortalUrl} remains parseable.
 *
 * `tenantId` is the Entra ID tenant the workspace belongs to; supplying it
 * makes cross-tenant Fabric portal links route the auth popup to the correct
 * authority. The MSIT Power BI portal does not use this query parameter. The
 * value is URL-encoded before being appended so arbitrary tenant identifiers
 * cannot inject extra query params.
 *
 * @throws if `workspaceId` or `itemId` is empty — both are required path
 * segments, and an empty value would yield a malformed `/groups//appbackends/`
 * link.
 */
export function composeFabricItemDeepLink(
  portalUrl: string,
  workspaceId: string,
  itemId: string,
  tenantId?: string
): string {
  if (!workspaceId || !itemId) {
    throw new Error(
      'composeFabricItemDeepLink: workspaceId and itemId must be non-empty'
    );
  }
  let portalBase = portalUrl;
  while (portalBase.endsWith('/')) {
    portalBase = portalBase.slice(0, -1);
  }
  let isMsitPowerBiPortal = false;
  try {
    isMsitPowerBiPortal =
      new URL(portalBase).hostname.toLowerCase().replace(/\.$/, '') ===
      'msit.powerbi.com';
  } catch {
    // Preserve the existing string-composition behavior for custom values.
  }
  const ctid =
    tenantId && !isMsitPowerBiPortal
      ? `?ctid=${encodeURIComponent(tenantId)}`
      : '';
  return `${portalBase}/groups/${workspaceId}/appbackends/${itemId}${ctid}`;
}

/**
 * Recover the Fabric portal URL from a stored `fabricDeepLink` value.
 *
 * `fabricDeepLink` has the shape produced by {@link composeFabricItemDeepLink}:
 * `<portalUrl>/groups/<wsId>/appbackends/<itemId>[?ctid=<tenantId>]`.
 * Returns `undefined` when the link is absent or cannot be parsed.
 */
export function extractPortalUrl(
  deepLink: string | undefined,
  workspaceId: string
): string | undefined {
  if (!deepLink) return undefined;
  const marker = `/groups/${workspaceId}/appbackends/`;
  const idx = deepLink.indexOf(marker);
  return idx > 0 ? deepLink.slice(0, idx) : undefined;
}

/**
 * The complete set of `RAYFIN_PUBLIC_*` keys that {@link deploymentInfoToPublicEnv}
 * may produce. Used by callers that need to clear stale deployment-derived
 * values from `rayfin/.env` before merging in a new deployment's projection
 * (e.g. on `rayfin up switch`).
 *
 * Keep in sync with the `vars.set(...)` calls in {@link deploymentInfoToPublicEnv}.
 */
export const DEPLOYMENT_PUBLIC_ENV_KEYS = [
  'RAYFIN_PUBLIC_API_URL',
  'RAYFIN_PUBLIC_PUBLISHABLE_KEY',
  'RAYFIN_PUBLIC_ITEM_ID',
  'RAYFIN_PUBLIC_WORKSPACE_ID',
  'RAYFIN_PUBLIC_TENANT_ID',
  'RAYFIN_PUBLIC_PORTAL_URL',
  // This is not produced by deploymentInfoToPublicEnv, but we need to clear this so that RayfinClient
  // can use the deployed function instead of localhost after rayfin up
  'RAYFIN_PUBLIC_FUNCTIONS_URL',
] as const;

/**
 * Remove every deployment-derived `RAYFIN_PUBLIC_*` key from `vars`.
 *
 * Used before merging a fresh deployment projection so a switch from a
 * deployment that defined (e.g.) `RAYFIN_PUBLIC_PORTAL_URL` to one that does
 * not won't leave the previous value behind.
 *
 * Returns a new Map; the input is not mutated. User-defined `RAYFIN_PUBLIC_*`
 * keys outside the known set are preserved.
 */
export function clearDeploymentPublicEnv(
  vars: Map<string, string>
): Map<string, string> {
  const result = new Map(vars);
  for (const key of DEPLOYMENT_PUBLIC_ENV_KEYS) {
    result.delete(key);
  }
  return result;
}

/**
 * Convert a {@link DeploymentInfo} record into the `RAYFIN_PUBLIC_*`
 * variables that should be written to `rayfin/.env` for frontend consumption.
 *
 * `hostingUrl` is intentionally excluded — it is registry-only per RFC.
 */
export function deploymentInfoToPublicEnv(
  info: DeploymentInfo
): Map<string, string> {
  const vars = new Map<string, string>();
  if (info.fabricApiUrl) vars.set('RAYFIN_PUBLIC_API_URL', info.fabricApiUrl);
  if (info.publishableKey) {
    vars.set('RAYFIN_PUBLIC_PUBLISHABLE_KEY', info.publishableKey);
  }
  if (info.fabricItemId) vars.set('RAYFIN_PUBLIC_ITEM_ID', info.fabricItemId);
  if (info.fabricWorkspaceId) {
    vars.set('RAYFIN_PUBLIC_WORKSPACE_ID', info.fabricWorkspaceId);
  }
  if (info.fabricTenantId) {
    vars.set('RAYFIN_PUBLIC_TENANT_ID', info.fabricTenantId);
  }
  const portalUrl = extractPortalUrl(
    info.fabricDeepLink,
    info.fabricWorkspaceId ?? ''
  );
  if (portalUrl) {
    vars.set('RAYFIN_PUBLIC_PORTAL_URL', portalUrl);
  }
  return vars;
}
