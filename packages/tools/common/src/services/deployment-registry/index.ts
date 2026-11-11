/**
 * Deployment-registry product-service contract (Layer 3).
 *
 * Owns the multi-deployment registry (`rayfin/.deployments.json`) and the
 * `RAYFIN_PUBLIC_*` mirror into `rayfin/.env`: recording a deployment after
 * `rayfin up`, reading it back, listing deployments, and switching the active
 * one. It tracks deployment state; it does not perform deployments. Workflows
 * declare this in their `Deps` and never touch the filesystem or the registry
 * format directly.
 *
 * Phase 2 backs this with the CLI's existing deployment-registry and
 * deployment-env-file utils; the interface lives here so the `up` workflow
 * (and later other hosts) depend only on the universal contract. It is
 * intentionally Node-free, and every operation is async so a host whose
 * filesystem access is asynchronous can satisfy it; the CLI host wraps its
 * synchronous utils.
 *
 * Out of scope here (by design): interactive deployment selection, which is a
 * Layer 1 prompt concern, and hydrating a deployment from Fabric, which is
 * deferred until the Fabric operations interface exists.
 */

/**
 * A single deployment's metadata, with storage-format-agnostic field names
 * (no `fabric*` prefix). Mirrors `rayfin/.deployments.json` records.
 */
export interface DeploymentRecord {
  /** Rayfin item id of the deployed backend. */
  itemId: string;
  /** Fabric display name of the deployed backend item. */
  itemName?: string;
  /** Workload API URL for the deployed item. */
  apiUrl: string;
  /** Fabric workspace id the item lives in. */
  workspaceId: string;
  /** Entra tenant the workspace belongs to (disambiguates multi-tenant auth). */
  tenantId?: string;
  /** Publishable key issued for the deployment. */
  publishableKey?: string;
  /** Fabric portal URL (used to compose deep links). */
  portalUrl?: string;
  /** Public hosting URL for deployed static content. */
  hostingUrl?: string;
  /** ISO-8601 timestamp of the most recent `rayfin up` for this workspace. */
  deployedAt?: string;
}

/** The active deployment plus the workspace name it is keyed under. */
export interface ActiveDeployment {
  workspaceName: string;
  record: DeploymentRecord;
}

/** A registry entry with its active flag, as returned by `listDeployments`. */
export interface DeploymentListEntry {
  workspaceName: string;
  record: DeploymentRecord;
  active: boolean;
}

/** Facts produced when a deployment record is persisted. */
export interface DeploymentPersistenceResult {
  /** Storage key actually written after workspace-name normalization. */
  workspaceKey: string;
  /** Original env file backed up before its first v2-format rewrite. */
  envBackup?: { sourcePath: string; backupPath: string };
  /** Non-fatal registry parse advisories observed during persistence. */
  warnings: string[];
}

/** Facts produced when reading one deployment. */
export interface DeploymentReadResult {
  record: DeploymentRecord | null;
  warnings: string[];
}

/** Facts produced when listing deployments. */
export interface DeploymentListResult {
  deployments: DeploymentListEntry[];
  warnings: string[];
}

export interface DeploymentRegistryService {
  /**
   * Record a deployment for `workspaceName`: upsert its registry entry, mark
   * it active, and mirror the matching `RAYFIN_PUBLIC_*` values into
   * `rayfin/.env`. The deployment timestamp is stamped by the host at write
   * time, so `deployedAt` is not part of the input record.
   */
  persistDeployment(
    projectRoot: string,
    workspaceName: string,
    record: Omit<DeploymentRecord, 'deployedAt'>
  ): Promise<DeploymentPersistenceResult>;

  /** Read a deployment by workspace name, or `null` when absent. */
  readDeployment(
    projectRoot: string,
    workspaceName: string
  ): Promise<DeploymentReadResult>;

  /** Get the active deployment, or `null` when none is selected. */
  getActiveDeployment(projectRoot: string): Promise<ActiveDeployment | null>;

  /** List every deployment in the registry with its active flag. */
  listDeployments(projectRoot: string): Promise<DeploymentListResult>;

  /**
   * Mark a workspace active and refresh the `RAYFIN_PUBLIC_*` mirror in
   * `rayfin/.env` to point at it. Resolves `true` on success, `false` when the
   * workspace is not in the registry (in which case `.env` is left untouched).
   */
  setActiveDeployment(
    projectRoot: string,
    workspaceName: string
  ): Promise<boolean>;
}
