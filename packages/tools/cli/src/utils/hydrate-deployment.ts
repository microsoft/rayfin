/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Hydrate a Rayfin project's local deployment metadata from a known
 * Fabric workspace + item, by fetching the BaaS endpoint and publishable
 * key via the same Fabric API paths used by `rayfin up`.
 *
 * Used by `rayfin init --workspace-id … --item-id …` (typically invoked
 * via `npm create @microsoft/rayfin@latest`) to wire up a freshly
 * scaffolded project to an already-deployed cloud item, so that
 * `npm run dev` can talk to the cloud backend without a separate
 * `rayfin up` run.
 */

import { getRayfinAuth, loadAuthState } from '../auth/index.js';
import { MONIKER_HEADER, resolveFabricPortalUrl } from '../config/constants.js';
import { RayfinItemManager } from '../services/fabric/rayfin-item.js';
import { WorkspaceManager } from '../services/fabric/workspace.js';

import { hasAmbientToken, getAmbientToken } from './ambient-env.js';
import {
  writeDeploymentEnvFile,
  type DeploymentEnvVars,
} from './env-fabric-utils.js';
import { fabricFetch } from './http-client.js';

export interface HydrateOptions {
  projectRoot: string;
  workspaceId: string;
  itemId: string;
  /** Optional Entra ID tenant override for auth. */
  tenantId?: string;
  /**
   * When `true`, fall back to interactive (browser / device-code) auth if
   * no ambient token and no cached silent token are available. Callers
   * MUST only set this when stdin/stdout are a TTY — otherwise the prompt
   * will hang invisibly.
   *
   * Defaults to `false` to preserve the historical silent-only behavior
   * for child-process invocations (e.g. `runRayfinInitFromTemplate`) and
   * agent/CI contexts that have not opted into interactive auth.
   */
  interactive?: boolean;
}

export interface HydrateResult {
  workspaceDisplayName: string;
  baasEndpoint: string;
  publishableKey: string;
  /** Synthetic path returned by `writeDeploymentEnvFile`. */
  envFilePath: string;
}

/**
 * Acquire a Fabric token, optionally falling back to interactive auth.
 *
 * Resolution order:
 * 1. Ambient `RAYFIN_TOKEN` value.
 * 2. Cached MSAL silent token from a prior `rayfin login`.
 * 3. If `interactive` is true, browser / device-code auth (loud).
 *
 * Throws if every available path fails. Callers MUST NOT pass
 * `interactive: true` from a context where stdio is redirected — the
 * device-code prompt would otherwise hang invisibly.
 */
async function acquireToken(
  _tenantId?: string,
  interactive = false
): Promise<string> {
  if (hasAmbientToken()) {
    return getAmbientToken()!;
  }
  const auth = await getRayfinAuth();
  // Tenant is honored by the singleton via persisted auth state; an
  // explicit tenantId override is not currently piped through.
  const result = await auth.acquireToken(undefined, {
    silentOnly: !interactive,
  });
  return result.token;
}

/**
 * Authenticate to Fabric and read deployment metadata without changing
 * local files or cloud resources.
 *
 * Auth defaults to **silent-only** (ambient token or cached silent
 * token). Pass `interactive: true` from a TTY-attached parent process to
 * fall back to a browser / device-code prompt — this is what
 * `create-rayfin` does so users running the portal-emitted command
 * without a prior `rayfin login` get a one-time auth flow instead of a
 * silent failure that leaves the project pointed at a non-existent local
 * backend.
 *
 * On total auth failure (no ambient token, no cached session, and
 * either `interactive: false` or interactive auth itself fails), this
 * throws with an actionable message so callers can surface it as a
 * warning and fall back to a minimal pre-seed.
 */
export async function readDeploymentFromFabric(
  options: HydrateOptions
): Promise<{
  workspaceDisplayName: string;
  deployment: DeploymentEnvVars & {
    rayfinApiUrl: string;
    publishableKey: string;
  };
}> {
  const { workspaceId, itemId, tenantId, interactive = false } = options;

  let token: string;
  try {
    token = await acquireToken(tenantId, interactive);
  } catch {
    // Re-throw with a user-actionable message; keeps the failure path
    // explicit for callers that surface it as a warning. The message
    // differs based on whether interactive auth was attempted so the
    // user gets a useful next step in either context.
    if (interactive) {
      throw new Error(
        'Fabric authentication failed. Run `rayfin login`, then re-run this command (or `rayfin up`) to wire up the deployment.'
      );
    }
    throw new Error(
      'No cached Fabric session and stdin is not a TTY. Run `rayfin login` once on this machine, then re-run this command (or `rayfin up`).'
    );
  }

  const workspaceManager = new WorkspaceManager(token);
  const rayfinItemManager = new RayfinItemManager(token);

  // Resolve the workspace display name so the deployment record is keyed
  // sensibly.
  const workspace = await workspaceManager.getWorkspace(workspaceId);

  // Fetch the BaaS endpoint via extendedProperties.
  const extendedProps = await rayfinItemManager.getExtendedProperties(
    workspaceId,
    itemId
  );
  const baasEndpoint = extendedProps.BaaSEndpoint;

  // Fetch the publishable key from the workload's private endpoint.
  const itemEndpoint = rayfinItemManager.getRayfinItemEndpoint(
    workspaceId,
    itemId
  );
  const keyUrl = `${itemEndpoint}/__private/publishable-key`;
  const authorizationHeader = rayfinItemManager.getAuthorizationHeader();

  const resp = await fabricFetch(keyUrl, {
    method: 'GET',
    headers: {
      Authorization: authorizationHeader,
      [MONIKER_HEADER]: itemId,
    },
  });
  if (!resp.ok) {
    throw new Error(
      `Failed to retrieve publishable key: HTTP ${resp.status} ${resp.statusText}`
    );
  }
  const body = await resp.text();
  let publishableKey: string;
  try {
    const parsed = JSON.parse(body);
    publishableKey =
      typeof parsed === 'string' ? parsed : parsed.publishableKey;
  } catch {
    publishableKey = body.trim();
  }
  if (!publishableKey) {
    throw new Error('Publishable key response was empty.');
  }

  // Resolve tenant for the portal URL (matches rayfin up).
  const authState = await loadAuthState();
  const effectiveTenantId = tenantId ?? authState?.tenantId;
  const portalBase = resolveFabricPortalUrl({
    configuredPortalUrl: process.env.RAYFIN_FABRIC_PORTAL_URL,
    backendUrl: baasEndpoint,
  }).replace(/\/+$/, '');

  // Return the bare portal origin; the registry helper composes the deep
  // link as `<portalUrl>/groups/<ws>/appbackends/<item>?ctid=<tenant>`.
  return {
    workspaceDisplayName: workspace.displayName,
    deployment: {
      rayfinItemId: itemId,
      rayfinApiUrl: baasEndpoint,
      fabricWorkspaceId: workspaceId,
      fabricTenantId: effectiveTenantId ?? undefined,
      publishableKey,
      fabricPortalUrl: portalBase,
      hostingUrl: undefined,
    },
  };
}

/** Fetch and persist deployment metadata for an existing Fabric item. */
export async function hydrateDeploymentFromFabric(
  options: HydrateOptions
): Promise<HydrateResult> {
  const { workspaceDisplayName, deployment } =
    await readDeploymentFromFabric(options);
  const envFilePath = await writeDeploymentEnvFile(
    options.projectRoot,
    workspaceDisplayName,
    deployment
  );

  return {
    workspaceDisplayName,
    baasEndpoint: deployment.rayfinApiUrl,
    publishableKey: deployment.publishableKey,
    envFilePath,
  };
}
