import type {
  Auth,
  OpaqueSession,
  TokenResponse,
} from '@microsoft/rayfin-auth';
import {
  createSessionFromTokenResponse,
  getAuthProviderClient,
  runProviderSignIn,
} from '@microsoft/rayfin-auth/_internal';
import { AuthError } from '@microsoft/rayfin-lib';

/** Options for signing in to a Fabric AppBackend with an existing Entra token. */
export interface EntraTokenSignInOptions {
  /** Already-acquired delegated Entra access token, without a Bearer prefix. */
  entraToken: string;
}

const TOKEN_PATH = '/api/auth/v1/brokered/token';

function invalidResponse(): AuthError {
  return new AuthError(
    'The token exchange returned an invalid token response.',
    'INVALID_TOKEN_RESPONSE'
  );
}

async function readTokenResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}

function validateTokenResponse(value: unknown): TokenResponse {
  if (!value || typeof value !== 'object') {
    throw invalidResponse();
  }
  if (
    !('accessToken' in value) ||
    typeof value.accessToken !== 'string' ||
    !value.accessToken.trim() ||
    /\s/.test(value.accessToken) ||
    !('tokenType' in value) ||
    typeof value.tokenType !== 'string' ||
    value.tokenType.toLowerCase() !== 'bearer' ||
    !('expiresIn' in value) ||
    typeof value.expiresIn !== 'number' ||
    !Number.isFinite(value.expiresIn) ||
    value.expiresIn <= 0
  ) {
    throw invalidResponse();
  }
  const now = Date.now();
  const expiry = new Date(now + value.expiresIn * 1000).getTime();
  if (!Number.isFinite(expiry) || expiry <= now) {
    throw invalidResponse();
  }
  const refreshToken = 'refreshToken' in value ? value.refreshToken : undefined;
  const scope = 'scope' in value ? value.scope : undefined;
  if (
    (refreshToken != null && typeof refreshToken !== 'string') ||
    (scope != null && typeof scope !== 'string')
  ) {
    throw invalidResponse();
  }
  return {
    accessToken: value.accessToken,
    tokenType: value.tokenType,
    expiresIn: value.expiresIn,
    refreshToken,
    scope,
  };
}

function exchangeError(status?: number): AuthError {
  switch (status) {
    case 400:
      return new AuthError(
        'External Entra exchange is not enabled.',
        'EXCHANGE_NOT_ENABLED'
      );
    case 401:
      return new AuthError('Entra authentication failed.', 'AUTH_FAILED');
    case 403:
      return new AuthError(
        'Item Execute permission is required.',
        'INSUFFICIENT_PERMISSIONS'
      );
    case 404:
      return new AuthError(
        'External Entra exchange is not available.',
        'NOT_AVAILABLE'
      );
    default:
      return new AuthError(
        'Entra token exchange failed.',
        'TOKEN_EXCHANGE_FAILED'
      );
  }
}

function sanitizeSignInFailure(error: unknown): never {
  if (error instanceof AuthError) {
    switch (error.code) {
      case 'INVALID_TOKEN_RESPONSE':
        throw invalidResponse();
      case 'EXCHANGE_NOT_ENABLED':
        throw exchangeError(400);
      case 'AUTH_FAILED':
        throw exchangeError(401);
      case 'INSUFFICIENT_PERMISSIONS':
        throw exchangeError(403);
      case 'NOT_AVAILABLE':
        throw exchangeError(404);
    }
  }
  // Initialization and custom storage can also fail, outside the HTTP path.
  throw exchangeError();
}

/**
 * Signs in to the AppBackend configured on `auth` using a delegated Entra token.
 * Works in browsers and Node.js; no popup or iframe is required.
 *
 * The configured backend must be an absolute HTTPS workload URL, including its
 * capacity/workspace/artifact path, not a static-hosting URL. The token is used
 * only for this request; subsequent refresh uses the Rayfin refresh token.
 * Success replaces the session on this Auth instance. Failures reject without
 * returning a prior session. Concurrent calls on the same instance run in call
 * order, after any active refresh; refresh waits until these calls settle.
 *
 * @param auth - The Auth instance used by your SDK clients.
 * @param options - The already-acquired Entra credential.
 * @returns The installed session metadata, without access or refresh tokens.
 * @throws `AuthError` with a stable code and a credential-free message.
 * @example
 * ```typescript
 * const session = await signInWithEntraToken(client.auth, { entraToken });
 * ```
 */

/**
 * Establishes an authenticated session on `auth` from a token response that
 * was already obtained from this backend's brokered-token exchange
 * (`POST /api/auth/v1/brokered/token`) by a trusted caller other than the
 * browser -- for example a local development host that performed the
 * exchange itself so it can reach an HTTP-only local backend, which
 * {@link signInWithEntraToken}'s HTTPS requirement would otherwise reject.
 * No network request is made here; the response is validated and installed
 * directly.
 *
 * Prefer {@link signInWithEntraToken} when the raw Entra token is available
 * in-browser and the configured backend is HTTPS-reachable -- it performs
 * this exchange for you.
 *
 * @param auth - The Auth instance used by your SDK clients.
 * @param tokenResponse - The token response returned by the brokered exchange.
 * @returns The installed session metadata, without access or refresh tokens.
 * @throws `AuthError` when the token response is malformed.
 * @example
 * ```typescript
 * const session = await signInWithBrokeredToken(client.auth, tokenResponse);
 * ```
 */
export async function signInWithBrokeredToken(
  auth: Auth,
  tokenResponse: TokenResponse
): Promise<OpaqueSession> {
  const validated = validateTokenResponse(tokenResponse);
  return runProviderSignIn(auth, () =>
    createSessionFromTokenResponse(auth, validated, {
      persistBeforeCommit: true,
    })
  ).catch(sanitizeSignInFailure);
}

export async function signInWithEntraToken(
  auth: Auth,
  options: EntraTokenSignInOptions
): Promise<OpaqueSession> {
  const token = options?.entraToken;
  if (
    typeof token !== 'string' ||
    !token ||
    /\s/.test(token) ||
    /^bearer$/i.test(token)
  ) {
    throw new AuthError(
      'A raw Entra access token is required.',
      'INVALID_REQUEST'
    );
  }
  const client = getAuthProviderClient(auth);
  const endpoint = client.resolveUrl(TOKEN_PATH);
  try {
    const url = new URL(endpoint);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      /[\s\\]/.test(endpoint) ||
      !url.pathname.endsWith(TOKEN_PATH)
    ) {
      throw new Error();
    }
  } catch {
    throw new AuthError(
      'An absolute HTTPS backend URL is required.',
      'INVALID_REQUEST'
    );
  }

  let responseError: AuthError | undefined;
  return runProviderSignIn(auth, async () => {
    let result: {
      status: number;
      ok: boolean;
      redirected: boolean;
      value: unknown;
    };
    try {
      result = await client.requestIsolated(
        TOKEN_PATH,
        { Authorization: `Bearer ${token}` },
        async (response) => {
          const rejected = !response.ok || response.redirected;
          if (rejected && (response.status !== 403 || response.redirected)) {
            // The transport already consumed or cancelled non-redirected 403s.
            // Other rejected responses remain unread.
            await response.body?.cancel();
          }
          return {
            status: response.status,
            ok: response.ok,
            redirected: response.redirected,
            value: rejected ? undefined : await readTokenResponse(response),
          };
        }
      );
    } catch (error) {
      responseError = client.getResponseAuthError(error);
      if (responseError) {
        throw responseError;
      }
      throw exchangeError();
    }
    if (result.redirected) {
      throw exchangeError();
    }
    if (!result.ok) {
      throw exchangeError(result.status);
    }
    const response = validateTokenResponse(result.value);
    return createSessionFromTokenResponse(auth, response, {
      persistBeforeCommit: true,
    });
  }).catch((error: unknown) => {
    if (responseError && error === responseError) {
      throw responseError;
    }
    return sanitizeSignInFailure(error);
  });
}
