/**
 * CLI implementation of the {@link SecretStore} adapter.
 *
 * Persists opaque key/value secrets to a single owner-only JSON file under
 * `~/.rayfin/` (the same config dir MSAL's token cache uses). This store is
 * intentionally separate from the MSAL token cache, which `@azure/msal-node`
 * manages internally through its own cache plugin.
 *
 * The file is written with mode `0o600` and its parent directory with
 * `0o700` for defense-in-depth, matching the CLI's `auth.json` handling.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SecretStore } from '@microsoft/rayfin-tools-common/_internal/adapters';

import { RAYFIN_CONFIG_DIR } from '../auth/constants.js';

/** Filename for the CLI's adapter-managed secret store. */
const SECRETS_FILE = 'secrets.json';

/**
 * Read the secret map from disk, returning an empty map when the file is
 * absent or unreadable (a missing store is the common first-run case).
 */
async function readStore(filePath: string): Promise<Record<string, string>> {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
    return {};
  } catch {
    return {};
  }
}

/** Persist the secret map with owner-only permissions. */
async function writeStore(
  filePath: string,
  store: Record<string, string>
): Promise<void> {
  await mkdir(RAYFIN_CONFIG_DIR, { recursive: true, mode: 0o700 });
  await writeFile(filePath, JSON.stringify(store, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
}

/** File-backed {@link SecretStore} implementation for the CLI host. */
export const cliSecretStore: SecretStore = {
  async get(key: string): Promise<string | undefined> {
    const filePath = join(RAYFIN_CONFIG_DIR, SECRETS_FILE);
    const store = await readStore(filePath);
    return store[key];
  },

  async set(key: string, value: string): Promise<void> {
    const filePath = join(RAYFIN_CONFIG_DIR, SECRETS_FILE);
    const store = await readStore(filePath);
    store[key] = value;
    await writeStore(filePath, store);
  },

  async delete(key: string): Promise<void> {
    const filePath = join(RAYFIN_CONFIG_DIR, SECRETS_FILE);
    const store = await readStore(filePath);
    if (key in store) {
      delete store[key];
      await writeStore(filePath, store);
    }
  },
};
