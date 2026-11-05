import type { Auth, OpaqueSession } from '@microsoft/rayfin-auth';
import {
  ARTIFACT_BLOCKED_CODE,
  ARTIFACT_BLOCKED_MESSAGE,
  AuthError,
  NetworkError,
  SdkError,
} from '@microsoft/rayfin-lib';

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
import type { FabricAuthOptions } from './types';

/**
 * Outcome of initializing embedded authentication without opening a popup.
 * Narrow on `status` before reading the session or error.
 *
 * Error results preserve the SDK error category and machine-readable code,
 * but use a fixed message and omit raw responses, causes, and host diagnostics.
 * The embedded application decides how to present a failure.
 */
export type EmbeddedAuthResult =
  | {
      /** An authenticated session is available. */
      status: 'authenticated';
      /** Session metadata without access or refresh tokens. */
      session: OpaqueSession;
    }
  | {
      /** Neither Fabric embedding nor an external embed host was detected. */
      status: 'not-embedded';
    }
  | {
      /** Embedded authentication could not establish a session. */
      status: 'error';
      /** A credential-free SDK error; branch on its code, not its message. */
      error: SdkError;
    };

/**
 * Initializes embedded Fabric authentication if running inside an iframe
 * with `?fabricEmbedded=true`.
 *
 * Call this once at app startup (e.g., in a `useEffect` or initialization
 * routine). It is safe to call on page load — it never opens a popup or
 * new tab.
 *
 * **Behaviour:**
 * - Runs the one-shot externalEmbed classification handshake first. If a
 *   third-party parent acknowledges it, the externalEmbed flow proceeds even
 *   when the Fabric `fabricEmbedded` flag is absent.
 * - If neither the handshake is acknowledged **nor** `fabricEmbedded` is set
 *   (option or `?fabricEmbedded=true`), returns `null` (no-op). A standalone
 *   page with no parent frame reaches this immediately.
 * - When the host stamps a `?_fu=` hint, runs the standard resume waterfall
 *   (existing session → refresh token → handoff).
 * - When it does not (or in the externalEmbed scenario), skips resume on the
 *   first call per page load and goes straight to the handoff, preserving the
 *   protection against reusing a previously signed-in user's session.
 *
 * Apps that also support the popup flow should continue to call
 * {@link ensureSignedInWithFabric} from a user-gesture handler for the
 * non-embedded case.
 *
 * @param auth - The Auth instance.
 * @param options - Fabric authentication options.
 * @returns The authenticated session, or `null` if not embedded or the handoff
 * fails to establish a session. Errors before the handoff retain their existing
 * rejection behavior. Use {@link initEmbeddedAuthWithResult} to observe typed
 * failures from the complete startup flow.
 */
export async function initEmbeddedAuth(
  auth: Auth,
  options: FabricAuthOptions
): Promise<OpaqueSession | null> {
  return runEmbeddedAuth(auth, options, false);
}

/**
 * Initializes embedded authentication and returns a discriminated outcome.
 *
 * Uses the same detection, identity checks, session resume, and handoff flow as
 * {@link initEmbeddedAuth}, but reports startup failures instead of hiding a
 * failed handoff behind `null`. It never opens a popup or renders error UI.
 * Call and await it before using a stored session, including in an external
 * embed. A missing external-host acknowledgement still follows the normal
 * embedded-mode detection rules.
 *
 * The `error` outcome contains an `AuthError`, `NetworkError`, or `SdkError`
 * from `@microsoft/rayfin-lib`, preserving its category and valid machine code.
 * Messages are fixed: administrator blocks use the approved consumer message;
 * other failures use a generic embedded-authentication message.
 * Valid HTTP statuses and GUID request identifiers are retained when available.
 * Unknown exceptions use `EMBEDDED_AUTH_FAILED` without their message or cause.
 * The returned error is a sanitized copy, not the original thrown object.
 *
 * @param auth - The Auth instance used by the embedded application.
 * @param options - Fabric authentication options.
 * @returns The authenticated session, a non-embedded no-op, or a typed error.
 * @example
 * ```typescript
 * const result = await initEmbeddedAuthWithResult(client.auth, fabricOptions);
 * if (result.status === 'authenticated') {
 *   renderApp(result.session);
 * } else if (result.status === 'error') {
 *   renderSignInError(result.error.code);
 * }
 * ```
 */
export async function initEmbeddedAuthWithResult(
  auth: Auth,
  options: FabricAuthOptions
): Promise<EmbeddedAuthResult> {
  try {
    const session = await runEmbeddedAuth(auth, options, true);
    return session
      ? { status: 'authenticated', session }
      : { status: 'not-embedded' };
  } catch (error) {
    return { status: 'error', error: sanitizeStartupError(error) };
  }
}

function sanitizeStartupError(error: unknown): SdkError {
  const candidate = error instanceof SdkError ? error.code : undefined;
  const code =
    typeof candidate === 'string' &&
    candidate.trim() === candidate &&
    /^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(candidate)
      ? candidate
      : 'EMBEDDED_AUTH_FAILED';
  const message =
    code === ARTIFACT_BLOCKED_CODE
      ? ARTIFACT_BLOCKED_MESSAGE
      : 'Embedded Fabric authentication failed.';
  const httpError =
    error instanceof AuthError || error instanceof NetworkError
      ? error
      : undefined;
  const status =
    typeof httpError?.status === 'number' &&
    Number.isInteger(httpError.status) &&
    httpError.status >= 100 &&
    httpError.status <= 599
      ? httpError.status
      : undefined;
  const requestId =
    typeof httpError?.requestId === 'string' &&
    httpError.requestId.length === 36 &&
    /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(httpError.requestId)
      ? httpError.requestId
      : undefined;
  if (error instanceof AuthError) {
    return new AuthError(message, code, status, requestId);
  }
  if (error instanceof NetworkError) {
    return new NetworkError(message, status, code, requestId);
  }
  return new SdkError(message, code);
}

async function runEmbeddedAuth(
  auth: Auth,
  options: FabricAuthOptions,
  throwOnFailure: boolean
): Promise<OpaqueSession | null> {
  const inEmbeddedMode = isEmbeddedMode(options);

  // One-shot externalEmbed classification handshake before any resume or
  // early-return decision. A successful acknowledgement means a third-party
  // parent is brokering external Entra — detected from the handshake alone,
  // independently of Fabric's `fabricEmbedded` flag. The handshake self-gates on
  // a parent frame, so a standalone page is an instant no-op and still returns
  // `null` below without opening anything.
  await classifyExternalEmbed();
  const externalEmbed = isExternalEmbedScenario();

  // Not embedded by either signal → nothing to do on page load.
  if (!externalEmbed && !inEmbeddedMode) {
    return null;
  }

  // Steps 1-2: existing session or refresh. Skipped on a legacy host (no `?_fu=` hint) until a
  // handoff has run this page load, because nothing server-side compared the session's identity
  // against the current Fabric user. The externalEmbed scenario always skips resume — the parent
  // brokers a fresh delegated handoff. See ensureSignedInWithFabric for the full reasoning.
  if (
    !externalEmbed &&
    (hasFabricUserHint() || hasEmbeddedHandoffCompleted())
  ) {
    const resumed = await tryResumeSession(auth);
    if (resumed) {
      return resumed;
    }
  } else {
    console.debug(
      '[FabricAuth:initEmbedded] Skipping session resume (externalEmbed scenario or no user hint) to avoid a stale cross-user session'
    );
  }

  // Step 3: postMessage handoff (no popup, no window.open)
  console.debug('[FabricAuth:initEmbedded] Starting postMessage handoff flow');
  try {
    await embeddedFabricLogin(auth, options);
  } catch (err) {
    if (throwOnFailure) {
      throw err;
    }
    console.warn('[FabricAuth:initEmbedded] Embedded login failed', err);
    return null;
  }

  const newSession = auth.getSession();
  if (newSession.isAuthenticated) {
    console.debug('[FabricAuth:initEmbedded] Session established');
    return newSession;
  }

  if (throwOnFailure) {
    throw new AuthError(
      'Embedded authentication completed but no session was established.',
      'SESSION_NOT_ESTABLISHED'
    );
  }
  console.warn(
    '[FabricAuth:initEmbedded] Handoff completed but no session was established'
  );
  return null;
}
