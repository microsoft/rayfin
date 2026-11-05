// Internal entry point for first-party companion auth provider packages
// (e.g. `@microsoft/rayfin-auth-provider-fabric`). Symbols exported here are
// NOT part of the public API surface and are intentionally excluded from the
// package's main entry point (`index.ts`). Consume via the `_internal` subpath:
//
//   import { createSessionFromTokenResponse } from '@microsoft/rayfin-auth/_internal';
//
// These exports may change without a major version bump.

import type { ApiClient, AuthError } from '@microsoft/rayfin-lib';

import type { Auth } from './Auth';
import type { OpaqueSession, TokenResponse } from './types';

/** Returns the configured transport for first-party companion providers. */
export function getAuthProviderClient(auth: Auth): ApiClient {
  return auth.getAuthApi().getClientForProvider();
}

/** Recognizes the current session's refresh rejection for companion providers. */
export function getRefreshResponseError(
  auth: Auth,
  error: unknown
): AuthError | undefined {
  return auth.getRefreshResponseError(error);
}

/**
 * Serializes explicit provider sign-ins on one Auth instance, waiting for any
 * active refresh and deferring subsequent refreshes until sign-in settles.
 */
export function runProviderSignIn<T>(
  auth: Auth,
  operation: () => Promise<T>
): Promise<T> {
  return auth.runProviderSignIn(operation);
}

/**
 * Establishes an authenticated session on the given `Auth` instance from a raw
 * `TokenResponse` obtained via an external code exchange (e.g. Fabric brokered
 * auth). This is the supported way for first-party companion provider packages
 * to hand a token response back to `Auth`.
 *
 * Standard auth flows (`signIn`, `handleMagicLinkCallback`) establish sessions
 * internally and do not require this function.
 *
 * @param auth - The `Auth` instance to establish the session on.
 * @param tokenResponse - The token response from an external token exchange.
 * @param options - Opt into awaiting persistence before replacing an existing session.
 * @returns The opaque session for the authenticated user.
 */
export function createSessionFromTokenResponse(
  auth: Auth,
  tokenResponse: TokenResponse,
  options?: { persistBeforeCommit?: boolean }
): Promise<OpaqueSession> {
  return options
    ? auth.createSessionFromTokenResponse(tokenResponse, options)
    : auth.createSessionFromTokenResponse(tokenResponse);
}
