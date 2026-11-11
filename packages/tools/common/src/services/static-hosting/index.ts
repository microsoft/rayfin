/**
 * Static-hosting product-service contract (Layer 3).
 *
 * Validates, builds, packages, and deploys the static frontend configured via
 * `services.staticHosting` in `rayfin.yml`, and persists the resulting hosting
 * URL. Workflows declare this in their `Deps` and compose its operations from
 * steps; the orchestration (validate → build → package → deploy → persist)
 * lives in the workflow, not here.
 *
 * The interface is intentionally fine-grained — each operation maps to one
 * existing capability so the host implementation
 * (`cli/src/rayfin-services/static-hosting.ts`) is a thin delegation. It is
 * Node-free: binary payloads are `Uint8Array` (not Node `Buffer`) so the
 * contract is satisfiable in any host.
 */
import type { RayfinConfig, StaticHostingConfig } from '../../config/index.js';

/** Result of validating the configured static folder. */
export interface StaticFolderValidation {
  /** Whether the configured folder exists. */
  exists: boolean;
  /** Whether the folder is empty (or missing). */
  empty: boolean;
  /** Absolute path the folder resolved to. */
  resolvedPath: string;
  /** Human-readable explanation when validation failed. */
  message?: string;
  /** Number of files found under the folder. */
  fileCount: number;
  /** Total size of those files in bytes. */
  totalSizeBytes: number;
}

/** Outcome of a static deploy request. */
export interface StaticDeployResult {
  /** Whether the deploy succeeded. */
  success: boolean;
  /** Server-assigned deployment id, when provided. */
  deploymentId?: string;
  /** Public hosting URL for the deployed content, when provided. */
  hostingUrl?: string;
  /** Error detail when `success` is `false`; `null` on success. */
  errorMessage: string | null;
}

/** Inputs for {@link StaticHostingService.persistHostingUrl}. */
export interface PersistHostingUrlRequest {
  /** The hosting URL returned by the deploy API. */
  hostingUrl: string;
  /** Current `services` config from `rayfin.yml`. */
  services: RayfinConfig['services'];
  /** Absolute path to the project root (contains `rayfin.yml`). */
  projectRoot: string;
  /** Workspace display name used to locate the deployment record. */
  workspaceName: string;
  /**
   * Optional callback to re-apply updated runtime settings to the backend.
   * When omitted, the backend POST is skipped (only local persistence runs).
   */
  postSettings?: (updatedServices: RayfinConfig['services']) => Promise<void>;
}

/** Facts produced while persisting a deployed static-hosting URL. */
export interface PersistHostingUrlResult {
  /** Whether `rayfin.yml` was updated with the hosting redirect origin. */
  configUpdated: boolean;
  /** Storage key written when the deployment record was patched. */
  workspaceKey?: string;
  /** Non-fatal persistence or runtime-settings advisories. */
  warnings: string[];
}

/** Outcome of writing `services.staticHosting.anonymousAccess` to `rayfin.yml`. */
export type PersistAssetAccessResult =
  | { status: 'persisted' }
  | { status: 'failed'; error: string };

export interface StaticHostingService {
  /**
   * Validate that the configured static folder exists and contains files.
   *
   * Async so a host whose filesystem access is asynchronous can satisfy the
   * contract; the CLI host wraps its synchronous util.
   */
  validateFolder(
    projectRoot: string,
    config: StaticHostingConfig
  ): Promise<StaticFolderValidation>;

  /**
   * Run the configured build command. Resolves `true` on success (or when no
   * build command is configured), `false` on failure.
   */
  runBuild(projectRoot: string, config: StaticHostingConfig): Promise<boolean>;

  /**
   * Package the resolved static folder into a ZIP payload. Rejects when the
   * compressed size exceeds the deploy API limit.
   */
  packageFolder(resolvedStaticDir: string): Promise<Uint8Array>;

  /** Deploy a packaged ZIP payload to the remote static-hosting endpoint. */
  deploy(
    pkg: Uint8Array,
    endpoint: string,
    authorizationHeader: string,
    extraHeaders?: Record<string, string>
  ): Promise<StaticDeployResult>;

  /**
   * Persist a hosting URL after deployment: register the redirect URI, apply
   * updated settings (when `postSettings` is provided), and record the URL in
   * the deployment registry. Best-effort — local persistence failures do not
   * reject.
   */
  persistHostingUrl(
    request: PersistHostingUrlRequest
  ): Promise<PersistHostingUrlResult>;

  /**
   * Write `services.staticHosting.assetAccess` to `rayfin.yml` so the
   * chosen access posture is checked in and the next deploy never asks again.
   *
   * Persistence only — the caller keeps the value it asked to write and threads
   * it forward, so the file and the wire payload cannot disagree within a run
   * without the config object being mutated behind anyone's back. Unlike
   * {@link persistHostingUrl} this is not best-effort: a deploy must not
   * announce a posture the project does not record, so a failure is reported.
   */
  persistAssetAccess(request: {
    projectRoot: string;
    assetAccess: NonNullable<StaticHostingConfig['assetAccess']>;
  }): Promise<PersistAssetAccessResult>;
}
