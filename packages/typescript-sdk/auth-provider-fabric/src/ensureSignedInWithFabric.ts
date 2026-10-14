import type { Auth, OpaqueSession } from '@microsoft/rayfin-auth';
import { AuthError, assertBrowser } from '@microsoft/rayfin-lib';

import { embeddedFabricLogin } from './embeddedFabricLogin';
import {
  classifyExternalEmbed,
  isExternalEmbedScenario,
} from './externalEmbedClassification';
import {
  hasEmbeddedHandoffCompleted,
  isEmbeddedMode,
  tryResumeSession,
} from './fabricAuthHelpers';
import { hasFabricUserHint } from './fabricUserHint';
import { initiateFabricLogin } from './initiateFabricLogin';
import type { FabricAuthOptions } from './types';

/**
 * Ensures the user is signed in via Fabric brokered authentication.
 *
 * Implements a multi-step waterfall — the first step that succeeds short-circuits the rest:
 *
 * 1. **Already authenticated** — if `auth.getSession().isAuthenticated` is true,
 *    return the existing session immediately.  On a legacy embedded host (one that
 *    stamps no `?_fu=` hint) this is skipped on the first call per page load, so a
 *    session belonging to a previously signed-in Fabric user cannot be reused.
 * 2. **Refresh token** — if a refresh token is available, attempt `auth.refreshSession()`.
 *    Return the refreshed session on success; continue on failure unless the
 *    service explicitly reports an administrator block.
 *    Subject to the same skip.
 * 3. **Embedded mode** — if running inside a Fabric iframe (`fabricEmbedded=true`)
 *    or a third-party portal that acknowledges the externalEmbed classification
 *    handshake, use `embeddedFabricLogin()` to acquire a session via `postMessage`
 *    handoff. The externalEmbed scenario is detected from the handshake alone and
 *    does not require the Fabric `fabricEmbedded` flag.
 * 4. **Open Fabric broker** — no existing auth path available. Open the Fabric Portal
 *    in a new tab via `initiateFabricLogin()` and wait for the Fabric extension to post
 *    the handoff code via `postMessage`. The function exchanges the code internally
 *    and creates the session. Once the promise resolves, return the new session.
 *
 * **Step 4 calls `window.open()`** — to avoid popup/tab blockers, call this function
 * from inside a synchronous user-gesture handler (e.g., a button click).
 * Steps 1–3 do not open windows and are safe to call on page load.
 *
 * @param auth - The Auth instance.
 * @param options - Fabric authentication options (workspaceId, projectId, fabricPortalUrl, returnOrigin).
 * @returns A promise that resolves with the authenticated session.
 * @throws `AuthError` - If all steps fail, the service reports an administrator
 * block, or the broker tab is blocked.
 *
 * @example
 * ```typescript
 * import { Auth } from '@microsoft/rayfin-auth';
 * import { ApiClient } from '@microsoft/rayfin-lib';
 * import {
 *   ensureSignedInWithFabric,
 *   type FabricAuthOptions,
 * } from '@microsoft/rayfin-auth-provider-fabric';
 *
 * const apiClient = new ApiClient({
 *   baseUrl: import.meta.env.VITE_RAYFIN_API_URL,
 *   publishableKey: import.meta.env.VITE_RAYFIN_PUBLISHABLE_KEY,
 * });
 * const auth = new Auth(apiClient);
 * const fabricOptions: FabricAuthOptions = {
 *   workspaceId: import.meta.env.VITE_FABRIC_WORKSPACE_ID,
 *   projectId: import.meta.env.VITE_FABRIC_ITEM_ID,
 *   fabricPortalUrl: import.meta.env.VITE_FABRIC_PORTAL_URL,
 *   returnOrigin: window.location.origin,
 * };
 *
 * // Wire to a button click so step 4 (window.open) is in a user-gesture context.
 * signInButton.addEventListener('click', async () => {
 *   try {
 *     const session = await ensureSignedInWithFabric(auth, fabricOptions);
 *     console.log('Signed in as', session.user?.email);
 *   } catch (error) {
 *     console.error('Fabric sign-in failed:', error.message);
 *   }
 * });
 * ```
 */
export async function ensureSignedInWithFabric(
  auth: Auth,
  options: FabricAuthOptions
): Promise<OpaqueSession> {
  assertBrowser('ensureSignedInWithFabric');
  const inEmbeddedMode = isEmbeddedMode(options);

  // Run the one-shot externalEmbed classification handshake before any resume
  // decision — and independently of Fabric's `fabricEmbedded` flag. The
  // handshake self-gates on the presence of a parent frame (no parent → instant
  // no-op), so a standalone tab pays nothing. A third-party parent that brokers
  // external Entra acknowledges here; a normal Fabric host does not (the short
  // timeout then classifies as normal). A successful acknowledgement — not the
  // Fabric-UX `fabricEmbedded` hint — is what defines the externalEmbed
  // scenario, so a portal embedding the app need stamp no Fabric-specific flag.
  await classifyExternalEmbed();
  const externalEmbed = isExternalEmbedScenario();

  // The postMessage handoff path applies whenever the app is embedded — either
  // Fabric embedded mode (`fabricEmbedded`) or a classified externalEmbed parent.
  const embedded = inEmbeddedMode || externalEmbed;

  // Steps 1-2: existing session or refresh.
  //
  // A host that stamps `?_fu=` has already had its cookie identity-checked by the workload gate
  // before this code ran — a cross-user cookie is cleared and a fresh sign-in bootstrap is served,
  // overwriting this origin's persisted session — so resuming is safe from the first call.
  //
  // A host that stamps no hint is indistinguishable from the pre-feature world: nothing compared the
  // identities, so the persisted session may belong to a previously signed-in Fabric user. There we
  // keep the original behaviour and skip resume until a handoff has run this page load.
  //
  // The externalEmbed scenario always skips resume: there is no serve-cookie identity gate and the
  // parent brokers a fresh delegated handoff, so any persisted session must be discarded.
  const skipResume =
    externalEmbed ||
    (inEmbeddedMode && !hasFabricUserHint() && !hasEmbeddedHandoffCompleted());

  if (skipResume) {
    console.debug(
      '[FabricAuth] Skipping session resume (externalEmbed scenario or embedded host stamped no user hint) to avoid reusing a stale session'
    );
  } else {
    const resumed = await tryResumeSession(auth);
    if (resumed) {
      return resumed;
    }
  }

  // Step 3: Embedded mode — postMessage auth via parent iframe host
  if (embedded) {
    console.debug(
      '[FabricAuth] Embedded mode detected, using postMessage auth'
    );
    try {
      await embeddedFabricLogin(auth, options);

      const embeddedSession = auth.getSession();
      if (embeddedSession.isAuthenticated) {
        console.debug('[FabricAuth] Embedded auth succeeded');
        return embeddedSession;
      }

      throw new AuthError(
        'Fabric embedded authentication completed but no session was established.',
        'SESSION_NOT_ESTABLISHED'
      );
    } catch (err) {
      // If there's no parent window the embedded flag is stale (e.g.
      // leftover sessionStorage or URL param without an actual iframe).
      // Fall through to the popup path instead of failing outright.
      if (err instanceof AuthError && err.code === 'NO_PARENT_WINDOW') {
        console.debug(
          '[FabricAuth] No parent window — falling back to popup auth'
        );
      } else {
        throw err;
      }
    }
  }

  // Step 4: Open Fabric broker in a new tab (popup flow)
  // WARNING: This calls window.open() — must be in a user-gesture context
  console.debug('[FabricAuth] Initiating Fabric broker login');
  await initiateFabricLogin(auth, options);

  const newSession = auth.getSession();
  if (newSession.isAuthenticated) {
    console.debug('[FabricAuth] Fabric broker login succeeded');
    return newSession;
  }

  throw new AuthError(
    'Fabric authentication completed but no session was established.',
    'SESSION_NOT_ESTABLISHED'
  );
}
