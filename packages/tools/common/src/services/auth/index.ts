/**
 * Auth product-service contract (Layer 3).
 *
 * Higher-level than the `Auth` adapter (raw token acquisition): an
 * `AuthService` ensures the user has an active Rayfin session for the
 * requested scopes — triggering an interactive login when none exists — and
 * returns the resulting token. Workflows declare this in their `Deps` and
 * never touch MSAL, secret stores, or login prompts directly.
 *
 * Phase 2 backs this with the CLI's existing `ensureAuthenticated`; the
 * interface lives here so the `up` workflow depends only on the universal
 * contract. The shape mirrors the CLI's `TokenResult` so the first
 * implementation is a thin delegation.
 */
export interface AuthSession {
  /** Bearer token for the requested scopes. */
  token: string;
  /** Expiry as epoch milliseconds, when known. */
  expiresOnTimestamp?: number;
  /** Tenant that issued the authenticated session, when known. */
  tenantId?: string;
  /** Authentication path that produced the session. */
  identityType: 'user' | 'service_principal' | 'external';
}

export interface AuthService {
  /**
   * Ensure an authenticated session for `scopes`, prompting interactively if
   * no cached session exists, and return the acquired token.
   */
  ensureAuthenticated(scopes?: readonly string[]): Promise<AuthSession>;
}
