/**
 * Data product-service contract (Layer 3).
 *
 * Generates the Data API Builder (DAB) configuration from a project's
 * TypeScript entity decorators and applies it to a DAB server — either the
 * local dev server or the deployed remote workload. Workflows declare this in
 * their `Deps` and never touch the filesystem, DAB endpoints, or output
 * rendering directly.
 *
 * Phase 2 backs this with the CLI's existing `applyDbConfig`; the interface
 * lives here so the `up` workflow depends only on the universal contract.
 * It is intentionally Node-free — the implementation that performs filesystem
 * and network IO lives in the host (`cli/src/rayfin-services/data.ts`).
 */
import type { Dialect } from '../../config/index.js';

/** Where a generated database configuration is applied. */
export type DataConfigTarget = 'local' | 'remote';

/** Inputs for {@link DataService.applyDatabaseConfig}. */
export interface ApplyDatabaseConfigRequest {
  /** Absolute path to the Rayfin project root. */
  projectRoot: string;
  /**
   * Apply to the local dev DAB server (`local`) or the deployed remote Rayfin
   * workload (`remote`).
   */
  target: DataConfigTarget;
  /**
   * Allow the DAB controller to accept a configuration that may result in data
   * loss. Defaults to `false`.
   */
  force?: boolean;
  /** Database dialect of the generated configuration. Defaults to `mssql`. */
  dialect?: Dialect;
  /**
   * Pre-resolved remote endpoint URL. Only honored when `target` is `remote`;
   * when omitted the host resolves the active deployment's endpoint.
   */
  remoteEndpoint?: string;
  /**
   * Pre-resolved `Bearer <token>` authorization header for the remote apply.
   * When provided, the host uses it directly instead of reacquiring auth, so
   * the credentials resolved upstream (e.g. the token `rayfin up` already
   * acquired, honoring `--tenant` / encryption fallback) are reused. Only
   * honored when `target` is `remote`; when omitted the host reacquires.
   */
  authorizationHeader?: string;
  /**
   * Rayfin item id of the deployment target, sent as the workload resource
   * moniker on a remote apply. Required during `rayfin up`: the apply runs
   * before the deployment is recorded, so the host cannot fall back to the
   * active-deployment registry for the moniker. Only honored when `target` is
   * `remote`.
   */
  itemId?: string;
  /**
   * Path to the data service package, relative to the project root
   * (`services.data.path`). Resolves the entity source root for generation in
   * multi-package projects, relative to {@link ApplyDatabaseConfigRequest.projectRoot}.
   * Omit to use the project root.
   */
  servicePath?: string;
  /** Build command to run before entity compilation (`services.data.buildCommand`). */
  buildCommand?: string;
  /**
   * Retry transient failures from the remote apply request. Generation,
   * compilation, and local validation failures are never retried.
   */
  retryTransientErrors?: boolean;
}

export interface DataService {
  /**
   * Regenerate the DAB configuration from the project's entities and apply it
   * to the requested target. A project with no entities is a no-op. Rejects
   * when generation or the apply request fails.
   */
  applyDatabaseConfig(request: ApplyDatabaseConfigRequest): Promise<void>;
}

export {
  applyDataConfigWithRetries,
  isRetryableDataApplyError,
  type DataApplyRetryOptions,
} from './apply-with-retries.js';
