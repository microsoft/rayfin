import {
  sendBridgeRequest,
  BridgeError,
} from '@microsoft/fabric-embedded-host';
import { AuthError } from '@microsoft/rayfin-lib';

/**
 * Handoff result returned by the host extension's `AuthPlugin`.
 *
 * @internal Low-level transport detail consumed by `embeddedFabricLogin`.
 */
export interface PostMessageHandoffResult {
  /** Single-use handoff code to exchange for tokens. */
  handoffCode: string;
  /** Opaque nonce echoed back for correlation. */
  state: string;
}

/**
 * Auth-specific payload sent on the `fabric-auth` channel.
 *
 * In the externalEmbed scenario the payload additionally carries
 * `brokeredAuthorizeUrl` and `artifactId` so the parent host — which has no
 * per-app configuration — can locate and call the correct endpoint.
 */
interface AuthHandoffPayload {
  callbackUrl: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string;
  brokeredAuthorizeUrl?: string;
  artifactId?: string;
}

/**
 * PostMessage transport for embedded (iframe) auth.
 *
 * Sends a `fabric-auth` / `auth.requestHandoff` message to the parent
 * window and waits for a correlated response carrying the handoff code.
 *
 * Delegates the low-level postMessage send/receive/correlate to
 * `sendBridgeRequest` from `@microsoft/fabric-embedded-host`.
 *
 * @param params - Handoff request parameters:
 *   - `callbackUrl`: The callback origin where the SPA is hosted.
 *   - `codeChallenge`: PKCE S256 code challenge.
 *   - `codeChallengeMethod`: Always `"S256"`.
 *   - `state`: Opaque nonce for CSRF/correlation.
 *   - `timeoutMs`: Response timeout in milliseconds (default 30 000).
 * @returns Promise resolving with the handoff code and state.
 * @throws `AuthError` - On timeout, error response, or missing parent.
 * @internal Low-level transport helper used by `embeddedFabricLogin`; not a
 * supported public API.
 */
export function requestHandoff(params: {
  callbackUrl: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string;
  timeoutMs?: number;
  /** externalEmbed only: the app's brokered-authorize endpoint URL. */
  brokeredAuthorizeUrl?: string;
  /** externalEmbed only: the app's Fabric artifact identifier. */
  artifactId?: string;
  /**
   * externalEmbed only: the pinned parent origin. When set, the request is
   * delivered to (and the response accepted only from) this origin.
   */
  targetOrigin?: string;
}): Promise<PostMessageHandoffResult> {
  const {
    callbackUrl,
    codeChallenge,
    codeChallengeMethod,
    state,
    timeoutMs,
    brokeredAuthorizeUrl,
    artifactId,
    targetOrigin,
  } = params;

  if (!window.parent || window.parent === window) {
    return Promise.reject(
      new AuthError(
        'No parent window — embedded auth requires an iframe host.',
        'NO_PARENT_WINDOW'
      )
    );
  }

  // Normal Fabric payload is left byte-for-byte unchanged; the externalEmbed
  // fields are added only when supplied.
  const payload: AuthHandoffPayload = {
    callbackUrl,
    codeChallenge,
    codeChallengeMethod,
    state,
  };
  if (brokeredAuthorizeUrl !== undefined) {
    payload.brokeredAuthorizeUrl = brokeredAuthorizeUrl;
  }
  if (artifactId !== undefined) {
    payload.artifactId = artifactId;
  }

  return sendBridgeRequest<AuthHandoffPayload, PostMessageHandoffResult>({
    target: window.parent,
    channel: 'fabric-auth',
    kind: 'auth.requestHandoff',
    payload,
    timeoutMs,
    ...(targetOrigin !== undefined ? { targetOrigin } : {}),
  }).catch((err) => {
    // Re-wrap BridgeError as AuthError for backward compatibility
    if (err instanceof BridgeError) {
      throw new AuthError(err.message, err.code);
    }
    throw err;
  });
}
