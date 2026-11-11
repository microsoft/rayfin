/** An access token plus the metadata callers need to cache and reuse it. */
export interface AuthToken {
  /** The bearer token string. */
  token: string;
  /**
   * Expiry as epoch milliseconds, when known. Callers treat `undefined`
   * as "unknown" and re-acquire rather than assuming validity.
   */
  expiresOnTimestamp?: number;
}

/**
 * Auth adapter — token acquisition for a requested set of scopes.
 *
 * Node hosts back this with the MSAL device-code / silent flow; a service host
 * could use a managed identity. Scopes are provider-specific (e.g. a Fabric
 * resource scope). The parameter is an array because AAD issues tokens per
 * scope-set and `acquireToken*({ scopes })` takes an array.
 *
 * Acquisition mode is host-decided today (silent-then-interactive). When the
 * first non-interactive/CI path needs to say "fail instead of prompting", or
 * a caller needs to bypass a cached token, surface it as an additive,
 * non-breaking options arg — `getToken(scopes, { silent?, forceRefresh? })` —
 * shaped by the Phase 2 impl that first consumes it, rather than guessed now.
 */
export interface Auth {
  /** Acquire a token for `scopes`, prompting interactively if required. */
  getToken(scopes: readonly string[]): Promise<AuthToken>;
}
