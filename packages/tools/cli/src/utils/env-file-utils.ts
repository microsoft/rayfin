/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Utilities for managing `rayfin/.env` — the single runtime env file.
 *
 * As of env-strategy v2 the CLI writes runtime values (ports, postgres
 * password) into `rayfin/.env` alongside deployment and user-managed
 * values. The legacy `rayfin/.temp/.env` location is no longer used.
 *
 * Parser/serializer are re-exports of the universal implementations in
 * `@microsoft/rayfin-tools-common` to provide one canonical `.env` format.
 */

import { access, constants, mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

import {
  clearDeploymentPublicEnv,
  mergeEnvVars,
  parseEnvContent,
  serializeEnvContent,
} from '@microsoft/rayfin-tools-common/_internal/config';

import { findRayfinProjectRoot } from './project-utils.js';

export interface EnvVariable {
  key: string;
  value: string;
}

/** A managed env update; `null` removes the key instead of preserving it. */
export interface EnvVariableUpdate {
  key: string;
  value: string | null;
}

// Hardcoded header for auto-generated `rayfin/.env` content.
const ENV_FILE_HEADER = [
  'Rayfin environment configuration',
  'Auto-managed by `rayfin dev` and `rayfin up` — safe to hand-edit.',
  'See docs/rfc/env-file-strategy.md for the full variable reference.',
];

/**
 * First line written by env-strategy v2 in any auto-managed `.env` file.
 * Used to detect v1-vintage files so we can back them up before the first
 * v2 rewrite (which would otherwise drop user comments).
 */
const V2_HEADER_SENTINEL = `# ${ENV_FILE_HEADER[0]}`;

let backupNoticeEmitted = false;

/** Facts produced by an environment-file write. */
export interface EnvFileWriteResult {
  /** Original file copied before a v1-to-v2 rewrite. */
  backup?: { sourcePath: string; backupPath: string };
}

/** Build the two user-facing lines that explain an environment backup. */
export function envBackupNoticeLines(backup: {
  sourcePath: string;
  backupPath: string;
}): [string, string] {
  return [
    `ℹ️  Backed up your previous ${backup.sourcePath} to ${backup.backupPath} before rewriting in env-strategy v2 format.`,
    '   Variable values are preserved; comments and ordering are not. Diff the two files to recover any custom content.',
  ];
}

/**
 * Get the path to `rayfin/.env` for a given rayfin directory.
 *
 * @param rayfinDir - The `rayfin/` directory (e.g. `<projectRoot>/rayfin`).
 */
function getEnvFilePath(rayfinDir: string): string {
  return join(rayfinDir, '.env');
}

/**
 * Validate environment variable key.
 * Must start with a letter or underscore and contain only letters, digits,
 * and underscores.
 */
function validateEnvKey(key: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new Error(
      `Invalid environment variable key: "${key}". Must start with a letter or underscore and contain only letters, numbers, and underscores.`
    );
  }
}

/**
 * Read an existing `rayfin/.env` into a Map. Returns an empty Map when the
 * file does not exist.
 */
export async function readEnvMap(
  rayfinDir: string
): Promise<Map<string, string>> {
  const filePath = getEnvFilePath(rayfinDir);
  try {
    const content = await readFile(filePath, 'utf8');
    return parseEnvContent(content);
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') {
      return new Map();
    }
    throw error;
  }
}

async function writeEnvMap(
  rayfinDir: string,
  vars: Map<string, string>
): Promise<EnvFileWriteResult> {
  await mkdir(rayfinDir, { recursive: true });
  const filePath = getEnvFilePath(rayfinDir);
  const backup = await backupV1EnvFileIfNeeded(filePath);
  const content = serializeEnvContent(vars, ENV_FILE_HEADER);
  await writeFile(filePath, content, 'utf8');
  return { backup };
}

/**
 * Back up a v1-vintage `rayfin/.env` to `rayfin/.env.bak` before the first
 * v2 rewrite. The serializer drops comments and re-orders keys, so a one-shot
 * sibling backup gives users a recovery path for hand-curated content
 * (e.g. commented-out environment switcher blocks).
 *
 * No-op when the file is missing, already in v2 format, or a `.bak` already
 * exists (we never overwrite a previous backup).
 */
async function backupV1EnvFileIfNeeded(
  filePath: string
): Promise<EnvFileWriteResult['backup']> {
  let existing: string;
  try {
    existing = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return undefined;
    throw error;
  }
  if (existing.length === 0) return undefined;
  if (existing.startsWith(V2_HEADER_SENTINEL)) return undefined;

  const backupPath = `${filePath}.bak`;
  try {
    await access(backupPath, constants.F_OK);
    // Backup already exists — don't clobber it.
    return undefined;
  } catch {
    // Backup absent, proceed.
  }

  await writeFile(backupPath, existing, 'utf8');
  return { sourcePath: filePath, backupPath };
}

/** Render the legacy one-time backup notice for existing utility callers. */
function emitBackupNotice(result: EnvFileWriteResult): void {
  if (!result.backup || backupNoticeEmitted) return;
  backupNoticeEmitted = true;
  for (const line of envBackupNoticeLines(result.backup)) {
    console.warn(line);
  }
}

/**
 * Create (overwrite) `rayfin/.env` with the given variables.
 */
export async function createEnvFile(
  rayfinDir: string,
  variables: EnvVariable[]
): Promise<void> {
  for (const variable of variables) {
    validateEnvKey(variable.key);
  }
  const map = new Map<string, string>();
  for (const variable of variables) {
    map.set(variable.key, variable.value);
  }
  emitBackupNotice(await writeEnvMap(rayfinDir, map));
}

/**
 * Read all variables from `rayfin/.env`. Returns `[]` when the file is
 * missing.
 */
export async function readEnvFile(rayfinDir: string): Promise<EnvVariable[]> {
  const map = await readEnvMap(rayfinDir);
  return Array.from(map.entries(), ([key, value]) => ({ key, value }));
}

/**
 * Upsert variables into `rayfin/.env`. Existing keys not listed in
 * `variables` are preserved.
 */
export async function upsertEnvVariables(
  rayfinDir: string,
  variables: EnvVariable[]
): Promise<void> {
  for (const variable of variables) {
    validateEnvKey(variable.key);
  }
  const existing = await readEnvMap(rayfinDir);
  const updates = new Map<string, string>();
  for (const variable of variables) {
    updates.set(variable.key, variable.value);
  }
  const merged = mergeEnvVars(existing, updates);
  emitBackupNotice(await writeEnvMap(rayfinDir, merged));
}

/**
 * Apply managed updates to `rayfin/.env`, deleting entries whose value is
 * `null` while preserving unrelated user-managed keys.
 */
export async function updateEnvVariables(
  rayfinDir: string,
  variables: EnvVariableUpdate[]
): Promise<void> {
  for (const variable of variables) {
    validateEnvKey(variable.key);
  }
  const existing = await readEnvMap(rayfinDir);
  for (const variable of variables) {
    if (variable.value === null) {
      existing.delete(variable.key);
    } else {
      existing.set(variable.key, variable.value);
    }
  }
  emitBackupNotice(await writeEnvMap(rayfinDir, existing));
}

/**
 * Merge a pre-built `Map<string, string>` into `rayfin/.env`. Existing
 * values for other keys are preserved.
 *
 * Preferred entry point for commands (e.g. `rayfin up`) that already work
 * in `Map` form.
 */
export async function mergeEnvIntoFile(
  rayfinDir: string,
  updates: Map<string, string>
): Promise<void> {
  for (const key of updates.keys()) {
    validateEnvKey(key);
  }
  const existing = await readEnvMap(rayfinDir);
  const merged = mergeEnvVars(existing, updates);
  emitBackupNotice(await writeEnvMap(rayfinDir, merged));
}

/**
 * Replace the deployment-derived `RAYFIN_PUBLIC_*` projection in
 * `rayfin/.env` with `updates`.
 *
 * Unlike {@link mergeEnvIntoFile}, this clears every key listed in
 * `DEPLOYMENT_PUBLIC_ENV_KEYS` before merging — preventing stale values
 * from a previously-active deployment leaking into `rayfin/.env` after
 * `rayfin up switch`. Non-deployment keys (secrets, runtime ports, custom
 * `RAYFIN_PUBLIC_*` keys) are preserved.
 */
export async function replaceDeploymentEnvInFile(
  rayfinDir: string,
  updates: Map<string, string>
): Promise<void> {
  emitBackupNotice(await replaceDeploymentEnvInFileState(rayfinDir, updates));
}

/** Replace deployment variables and return write facts without rendering. */
export async function replaceDeploymentEnvInFileState(
  rayfinDir: string,
  updates: Map<string, string>
): Promise<EnvFileWriteResult> {
  for (const key of updates.keys()) {
    validateEnvKey(key);
  }
  const existing = await readEnvMap(rayfinDir);
  const cleared = clearDeploymentPublicEnv(existing);
  const merged = mergeEnvVars(cleared, updates);
  return writeEnvMap(rayfinDir, merged);
}

/**
 * Check whether `rayfin/.env` exists.
 */
export async function envFileExists(rayfinDir: string): Promise<boolean> {
  const filePath = getEnvFilePath(rayfinDir);
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove all port-related environment variables (`RAYFIN_*_PORT`) from
 * `rayfin/.env`. Non-port variables (deployment public vars, postgres
 * password) are preserved.
 */
export async function removePortVariables(rayfinDir?: string): Promise<void> {
  try {
    if (!rayfinDir) {
      const projectRoot = findRayfinProjectRoot(process.cwd());
      rayfinDir = join(projectRoot, 'rayfin');
    }

    const existing = await readEnvMap(rayfinDir);
    if (existing.size === 0) {
      return;
    }

    const portVariablePattern = /^RAYFIN_.*_PORT(?:_ALIASES)?$/;
    let changed = false;
    for (const key of Array.from(existing.keys())) {
      if (portVariablePattern.test(key)) {
        existing.delete(key);
        changed = true;
      }
    }
    if (changed) {
      emitBackupNotice(await writeEnvMap(rayfinDir, existing));
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('Could not find rayfin project root')
    ) {
      return;
    }
    throw error;
  }
}

// ── Port reader helpers ────────────────────────────────────────────────

interface GetPortOptions {
  /** Path to the `rayfin/` directory. Auto-discovered from `process.cwd()` when omitted. */
  rayfinDir?: string;
  /** Pre-read env vars to avoid I/O; takes precedence over `rayfinDir`. */
  envVars?: EnvVariable[];
}

async function getPortFromEnv(
  envVarName: string,
  defaultPort: number,
  options?: GetPortOptions
): Promise<number> {
  try {
    let envVars = options?.envVars;
    if (!envVars) {
      let rayfinDir = options?.rayfinDir;
      if (!rayfinDir) {
        const projectRoot = findRayfinProjectRoot(process.cwd());
        rayfinDir = join(projectRoot, 'rayfin');
      }
      envVars = await readEnvFile(rayfinDir);
    }
    const portVar = envVars.find((v) => v.key === envVarName);
    return portVar ? parseInt(portVar.value, 10) : defaultPort;
  } catch {
    return defaultPort;
  }
}

/**
 * Get the WebService port from environment or default to 5168.
 *
 * @param options - Either a string (rayfinDir path) for backwards compatibility,
 *                  or an options object with rayfinDir and/or envVars.
 * @returns WebService HTTP port number.
 */
export async function getWebServicePort(
  options?: string | GetPortOptions
): Promise<number> {
  const opts = typeof options === 'string' ? { rayfinDir: options } : options;
  return getPortFromEnv('RAYFIN_WEBSERVICE_HTTP_PORT', 5168, opts);
}

/**
 * Get the SQL Server port from environment or default to 1433.
 *
 * @param options - Either a string (rayfinDir path) for backwards compatibility,
 *                  or an options object with rayfinDir and/or envVars.
 * @returns SQL Server port number.
 */
export async function getSqlServerPort(
  options?: string | GetPortOptions
): Promise<number> {
  const opts = typeof options === 'string' ? { rayfinDir: options } : options;
  return getPortFromEnv('RAYFIN_SQLSERVER_PORT', 1433, opts);
}

/**
 * Get the PostgreSQL port from environment or default to 5432.
 *
 * @param options - Either a string (rayfinDir path) for backwards compatibility,
 *                  or an options object with rayfinDir and/or envVars.
 * @returns PostgreSQL port number.
 */
export async function getPostgresPort(
  options?: string | GetPortOptions
): Promise<number> {
  const opts = typeof options === 'string' ? { rayfinDir: options } : options;
  return getPortFromEnv('RAYFIN_POSTGRES_PORT', 5432, opts);
}

/**
 * Get the Azurite Blob port from environment or default to 10000.
 *
 * @param options - Either a string (rayfinDir path) for backwards compatibility,
 *                  or an options object with rayfinDir and/or envVars.
 * @returns Azurite Blob port number.
 */
export async function getAzuriteBlobPort(
  options?: string | GetPortOptions
): Promise<number> {
  const opts = typeof options === 'string' ? { rayfinDir: options } : options;
  return getPortFromEnv('RAYFIN_AZURITE_BLOB_PORT', 10000, opts);
}

/**
 * Get the Azurite Queue port from environment or default to 10001.
 *
 * @param options - Either a string (rayfinDir path) for backwards compatibility,
 *                  or an options object with rayfinDir and/or envVars.
 * @returns Azurite Queue port number.
 */
export async function getAzuriteQueuePort(
  options?: string | GetPortOptions
): Promise<number> {
  const opts = typeof options === 'string' ? { rayfinDir: options } : options;
  return getPortFromEnv('RAYFIN_AZURITE_QUEUE_PORT', 10001, opts);
}

/**
 * Get the Azurite Table port from environment or default to 10002.
 *
 * @param options - Either a string (rayfinDir path) for backwards compatibility,
 *                  or an options object with rayfinDir and/or envVars.
 * @returns Azurite Table port number.
 */
export async function getAzuriteTablePort(
  options?: string | GetPortOptions
): Promise<number> {
  const opts = typeof options === 'string' ? { rayfinDir: options } : options;
  return getPortFromEnv('RAYFIN_AZURITE_TABLE_PORT', 10002, opts);
}
