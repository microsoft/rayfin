/**
 * SecretStore adapter — token / credential persistence.
 *
 * Node hosts back this with MSAL token-cache persistence under
 * `~/.rayfin/`. Keys are opaque strings owned by the caller; values are
 * arbitrary strings (typically serialized tokens).
 */
export interface SecretStore {
  /** Resolve the stored value for `key`, or `undefined` if absent. */
  get(key: string): Promise<string | undefined>;

  /** Store `value` under `key`, overwriting any existing value. */
  set(key: string, value: string): Promise<void>;

  /** Remove `key`. No-op if absent (idempotent). */
  delete(key: string): Promise<void>;
}
