import { isEmbeddedMode as sharedIsEmbeddedMode } from '@microsoft/fabric-embedded-host';
import type { Auth, OpaqueSession } from '@microsoft/rayfin-auth';
import { getRefreshResponseError } from '@microsoft/rayfin-auth/_internal';
import { AuthError } from '@microsoft/rayfin-lib';

import type { FabricAuthOptions } from './types';

/**
 * Detects embedded mode from the `fabricEmbedded` option, the
 * `?fabricEmbedded=true` URL query parameter, or a previously stored
 * `sessionStorage` flag.
 *
 * Delegates to `@microsoft/fabric-embedded-host` for the actual
 * detection logic.  `FabricAuthOptions` satisfies the shared
 * `EmbeddedModeOptions` interface.
 */
export function isEmbeddedMode(options: FabricAuthOptions): boolean {
  return sharedIsEmbeddedMode(options);
}

/**
 * Tracks whether an embedded postMessage handoff has completed during the current page load.
 *
 * Only consulted on the **legacy** embedded path — a host that stamps no `?_fu=` hint, and therefore
 * gives the workload gate nothing to compare. There, a persisted session cannot be trusted to belong
 * to the current Fabric user, so the first auth call per page load skips resume and forces a full
 * handoff. Once that handoff has run, the stored session is known to be the current user's and later
 * calls in the same load may resume it without thrashing the postMessage channel.
 *
 * Hosts that do stamp a hint never reach this flag: the gate rejects a cross-user cookie before the
 * app boots, so resume is safe from the first call.
 */
let embeddedHandoffCompletedThisLoad = false;

/**
 * Returns whether an embedded postMessage handoff has already completed during this page load.
 */
export function hasEmbeddedHandoffCompleted(): boolean {
  return embeddedHandoffCompletedThisLoad;
}

/**
 * Marks that an embedded postMessage handoff has completed for this page load.
 */
export function markEmbeddedHandoffCompleted(): void {
  embeddedHandoffCompletedThisLoad = true;
}

/**
 * Clears the embedded-handoff completion flag.
 *
 * @internal Test helper. Not exported from the package barrel.
 */
export function resetEmbeddedHandoffStateForTests(): void {
  embeddedHandoffCompletedThisLoad = false;
}

/**
 * Attempts to resume an existing session without any user interaction.
 *
 * 1. Returns the current session if already authenticated.
 * 2. If a refresh token is available, tries `auth.refreshSession()` and
 *    returns the refreshed session on success.
 * 3. Returns `null` when neither path produces an authenticated session.
 *    A recognized administrator-block rejection is rethrown instead.
 *
 * This helper never opens windows, popups, or postMessage channels —
 * it is always safe to call on page load.
 */
export async function tryResumeSession(
  auth: Auth
): Promise<OpaqueSession | null> {
  // Step 1: Already authenticated
  const currentSession = auth.getSession();
  if (currentSession.isAuthenticated) {
    console.debug('[FabricAuth] Existing session found');
    return currentSession;
  }

  // Step 2: Try refresh token
  if (auth.hasRefreshToken()) {
    try {
      await auth.refreshSession();
      const refreshedSession = auth.getSession();
      if (refreshedSession.isAuthenticated) {
        console.debug('[FabricAuth] Session refreshed successfully');
        return refreshedSession;
      }
    } catch (error) {
      if (
        error instanceof AuthError &&
        error.code === 'ArtifactBlockedByAdmin'
      ) {
        const responseError = getRefreshResponseError(auth, error);
        if (responseError) {
          throw responseError;
        }
      }
      console.warn('[FabricAuth] Session refresh failed, continuing');
    }
  }

  return null;
}
