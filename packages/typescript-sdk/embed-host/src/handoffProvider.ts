import {
  ARTIFACT_BLOCKED_CODE,
  ARTIFACT_BLOCKED_MESSAGE,
  isArtifactBlockedResponse,
} from '@microsoft/rayfin-lib';

import { EmbedHostError, type EmbedHostErrorCode } from './errors';
import type { HandoffProvider, HandoffRequest, HandoffResult } from './types';

/**
 * Maps a non-success HTTP status from the brokered-authorize endpoint to a
 * stable {@link EmbedHostErrorCode}.
 */
function statusToCode(status: number): EmbedHostErrorCode {
  switch (status) {
    case 400:
      return 'EXCHANGE_NOT_ENABLED';
    case 401:
      return 'AUTH_FAILED';
    case 403:
      return 'INSUFFICIENT_PERMISSIONS';
    case 404:
      return 'NOT_AVAILABLE';
    default:
      return 'AUTHORIZE_FAILED';
  }
}

/**
 * The default {@link HandoffProvider}: `POST`s the validated request to the
 * iframe-supplied brokered-authorize endpoint with the parent's delegated
 * Entra token and returns the handoff code.
 *
 * The token is attached only to the outbound `Authorization` header and is
 * never included in a thrown {@link EmbedHostError}.
 *
 * @internal Default implementation of the acquisition seam.
 */
export function createExternalEntraHandoffProvider(): HandoffProvider {
  return {
    async acquire(request: HandoffRequest): Promise<HandoffResult> {
      let token: string;
      try {
        token = await request.getAccessToken();
      } catch (error) {
        if (
          error instanceof EmbedHostError &&
          error.code === ARTIFACT_BLOCKED_CODE
        ) {
          throw new EmbedHostError(
            'Failed to acquire the delegated Entra token.',
            'AUTHORIZE_FAILED'
          );
        }
        throw error;
      }

      const body: Record<string, string> = {
        returnOrigin: request.returnOrigin,
        codeChallenge: request.codeChallenge,
        codeChallengeMethod: request.codeChallengeMethod,
      };
      if (request.state !== undefined) {
        body.state = request.state;
      }

      let response: Response;
      try {
        response = await fetch(request.brokeredAuthorizeUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
            'x-ms-workload-resource-moniker': request.artifactId,
          },
          body: JSON.stringify(body),
        });
      } catch {
        // Network/transport failure — never surface the underlying cause, which
        // could echo the request (and its Authorization header) in some hosts.
        throw new EmbedHostError(
          'Failed to reach the brokered-authorize endpoint.',
          'AUTHORIZE_FAILED'
        );
      }

      if (!response.ok) {
        if (await isArtifactBlockedResponse(response)) {
          throw new EmbedHostError(
            ARTIFACT_BLOCKED_MESSAGE,
            ARTIFACT_BLOCKED_CODE
          );
        }
        throw new EmbedHostError(
          `Brokered-authorize endpoint responded with status ${response.status}.`,
          statusToCode(response.status)
        );
      }

      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        throw new EmbedHostError(
          'Brokered-authorize endpoint returned a malformed response.',
          'AUTHORIZE_FAILED'
        );
      }

      const result = parsed as { handoffCode?: unknown; state?: unknown };
      if (typeof result.handoffCode !== 'string') {
        throw new EmbedHostError(
          'Brokered-authorize endpoint returned no handoff code.',
          'AUTHORIZE_FAILED'
        );
      }

      return {
        handoffCode: result.handoffCode,
        ...(typeof result.state === 'string' ? { state: result.state } : {}),
      };
    },
  };
}
