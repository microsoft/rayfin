/**
 * Framework-env product-service contract (Layer 3).
 *
 * Detects the project's frontend framework and (re)writes the framework-local
 * environment file (e.g. `.env.local`) that the static build reads, projecting
 * the active deployment's `RAYFIN_PUBLIC_*` values into the framework-prefixed
 * names a bundler expects (`VITE_*`, `NEXT_PUBLIC_*`, …). Workflows declare
 * this in their `Deps` and never touch the filesystem or framework detection
 * directly.
 *
 * Phase 2 backs this with the CLI's existing `detectFrontendFramework` and
 * `writeFrameworkEnvFile`; the interface lives here so the `up` workflow
 * depends only on the universal contract. It is intentionally Node-free —
 * the implementation that performs detection and filesystem IO lives in the
 * host (`cli/src/rayfin-services/`).
 */

import type { StaticHostingConfig } from '../../config/index.js';

/** Inputs for {@link FrameworkEnvService.writeEnvFile}. */
export interface WriteFrameworkEnvRequest {
  /** Absolute path to the Rayfin project root (the directory containing `rayfin/`). */
  projectRoot: string;
  /**
   * The detected framework identifier (e.g. `vite`, `nextjs`, `plain`),
   * typically the value returned by {@link FrameworkEnvService.detectFramework}.
   */
  framework: string;
  /**
   * Directory the env file is written to, relative to `projectRoot`. Defaults
   * to the configured frontend directory, or the project root when no static
   * frontend is supplied.
   */
  outputDir?: string;
  /** Frontend location, used when no explicit output directory is supplied. */
  staticHosting?: StaticHostingConfig;
}

export interface FrameworkEnvService {
  /**
   * Detect the frontend framework at the configured static-hosting directory
   * (or `projectRoot` when omitted), returning its identifier
   * (e.g. `vite`, `nextjs`), or `null` when no framework can be detected.
   */
  detectFramework(
    projectRoot: string,
    staticHosting?: StaticHostingConfig
  ): Promise<string | null>;

  /**
   * Regenerate the framework-local environment file from the active
   * deployment's values and return the absolute path written. Rejects when the
   * write fails.
   */
  writeEnvFile(request: WriteFrameworkEnvRequest): Promise<string>;
}
