import { ApiClient } from '@microsoft/rayfin-lib';
import { AuthError } from '@microsoft/rayfin-lib';
import {
  AUTH_V1_ENDPOINT,
  BROKERED_AUTHORIZE_EXTERNAL_PATH,
  SIGNUP_PATH,
  TOKEN_PATH,
  SIGNOUT_PATH,
  SIGNOUT_ALL_PATH,
  JWKS_PATH,
  VERIFY_EMAIL_PATH,
  RESEND_VERIFICATION_EMAIL_PATH,
  REQUEST_PASSWORD_RESET_PATH,
  COMPLETE_PASSWORD_RESET_PATH,
  MAGIC_LINK_SEND_PATH,
  PROJECT_RUNTIME_SETTINGS_PATH,
} from '@microsoft/rayfin-lib';

import {
  SignUpCredentials,
  SignUpResponse,
  PasswordGrantCredentials,
  TokenResponse,
  SignOutAllResponse,
  JwksResponse,
  PasswordResetRequest,
  PasswordResetResponse,
  ResendVerificationEmailRequest,
  ResendVerificationEmailResponse,
  CompletePasswordResetRequest,
  EmailVerificationResponse,
  MagicLinkRequest,
  MagicLinkResponse,
  VerificationCodeExchangeRequest,
  AuthSettingsConfig,
  AuthMethod,
} from './types';

/**
 * Shared error mappings for common auth operations
 */
const AUTH_ERROR_MAPS = {
  signup: {
    409: ['Email already registered.', 'EMAIL_ALREADY_REGISTERED'],
    400: ['Invalid signup request.', 'INVALID_REQUEST'],
    500: ['Server error occurred during signup.', 'SERVER_ERROR'],
  },
  signin: {
    400: ['Email and password are required.', 'INVALID_REQUEST'],
    401: ['Invalid email or password.', 'INVALID_GRANT'],
    403: [
      'Email not verified. Check your inbox for verification link.',
      'EMAIL_NOT_VERIFIED',
    ],
    500: ['Server error occurred during signin.', 'SERVER_ERROR'],
  },
  signout: {
    401: ['Client authentication failed.', 'INVALID_CLIENT'],
    500: ['Server error occurred during signout.', 'SERVER_ERROR'],
  },
  token: {
    400: ['Invalid token request.', 'INVALID_REQUEST'],
    401: ['Invalid credentials or token.', 'INVALID_GRANT'],
    500: [
      'Server error occurred while processing token request.',
      'SERVER_ERROR',
    ],
  },
  refresh_token: {
    400: ['Invalid refresh token request.', 'INVALID_REQUEST'],
    401: ['Invalid or expired refresh token.', 'INVALID_GRANT'],
    500: ['Server error occurred during token refresh.', 'SERVER_ERROR'],
  },
  verifyEmail: {
    400: ['Invalid or expired verification token.', 'INVALID_TOKEN'],
    500: ['Server error occurred during email verification.', 'SERVER_ERROR'],
  },
  resendVerificationEmail: {
    400: ['Invalid request.', 'INVALID_REQUEST'],
    500: [
      'Server error occurred while resending verification email.',
      'SERVER_ERROR',
    ],
  },
  requestPasswordReset: {
    400: ['Invalid request.', 'INVALID_REQUEST'],
    500: [
      'Server error occurred during password reset request.',
      'SERVER_ERROR',
    ],
  },
  completePasswordReset: {
    400: ['Invalid or expired reset token.', 'INVALID_TOKEN'],
    500: ['Server error occurred completing password reset.', 'SERVER_ERROR'],
  },
  sendMagicLink: {
    400: ['Invalid magic link request.', 'INVALID_REQUEST'],
    403: ['Magic link authentication is not enabled.', 'MAGIC_LINK_DISABLED'],
    422: ['Invalid redirect URI.', 'INVALID_REDIRECT_URI'],
    429: [
      'Too many magic link requests. Please try again later.',
      'RATE_LIMITED',
    ],
    500: ['Server error occurred sending magic link.', 'SERVER_ERROR'],
  },
  exchangeVerificationCode: {
    400: ['Invalid verification code exchange request.', 'INVALID_REQUEST'],
    401: ['Invalid or expired verification code.', 'INVALID_CODE'],
    403: [
      'Code verification failed. PKCE mismatch or redirect URI mismatch.',
      'VERIFICATION_FAILED',
    ],
    404: ['Verification code not found or already used.', 'CODE_NOT_FOUND'],
    500: ['Server error occurred during code exchange.', 'SERVER_ERROR'],
  },
} as const;

/**
 * Manages all authentication-related API interactions.
 */
export class AuthApi {
  private apiClient: ApiClient;

  /**
   * @param apiClient - An instance of ApiClient configured for your service.
   */
  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  /** @internal Configured transport for first-party companion providers. */
  public getClientForProvider(): ApiClient {
    return this.apiClient;
  }

  /**
   * Returns this app's brokered external-Entra authorize endpoint URL, resolved
   * against the client's configured base URL. For an app embedded in Fabric,
   * this is the app's own capacity-scoped endpoint.
   *
   * A parent page that embeds this app and brokers external-Entra sign-in reads
   * this value from the embedded auth handshake so it knows which endpoint to
   * call; Builders using `ensureSignedInWithFabric` do not call it directly.
   *
   * @returns The fully-qualified `brokered/authorize/external` URL.
   */
  public getBrokeredAuthorizeExternalUrl(): string {
    return this.apiClient.resolveUrl(
      `${AUTH_V1_ENDPOINT}${BROKERED_AUTHORIZE_EXTERNAL_PATH}`
    );
  }

  /**
   * Helper to map error responses to AuthError
   */
  private mapError(operation: keyof typeof AUTH_ERROR_MAPS, error: any): never {
    const responseError = this.apiClient.getResponseAuthError(error);
    if (responseError) {
      throw responseError;
    }
    const errorMap = AUTH_ERROR_MAPS[operation];
    if (error.status && errorMap[error.status as keyof typeof errorMap]) {
      const [message, code] = errorMap[error.status as keyof typeof errorMap];
      throw new AuthError(error.message || message, code);
    }
    throw error;
  }

  /**
   * Attaches a dynamic access token provider used to populate the
   * `Authorization` header on outgoing requests. Used by {@link Auth} to keep
   * the access token concealed.
   *
   * @param provider - Function returning the current access token, or `null` when signed out.
   */
  public setAccessTokenProvider(provider: () => string | null): void {
    this.apiClient.setAccessTokenCallback(provider);
  }

  /**
   * Attaches an automatic token refresh callback invoked on `401` responses
   * before the request is retried. Used by {@link Auth} for transparent
   * session refresh.
   *
   * @param callback - Async function that refreshes the session.
   */
  public setRefreshCallback(callback: () => Promise<void>): void {
    this.apiClient.setRefreshCallback(callback);
  }

  /**
   * Registers a new user with email and password.
   *
   * After successful signup, clients must call signIn() to obtain an access token.
   * This design supports future email verification flows where token issuance
   * occurs only after email verification is complete.
   *
   * @param credentials - The email and password for the new user.
   * @returns A promise that resolves with the signup response (userId, email, role, createdAt).
   * @throws `AuthError` - If signup fails (e.g., email already registered, invalid request).
   * @throws `NetworkError` - For network-related issues.
   *
   * @example
   * ```typescript
   * // Step 1: Sign up
   * const signupResponse = await authApi.signUp({ email: 'user@example.com', password: 'password123' });
   * console.log('User created:', signupResponse.userId);
   *
   * // Step 2: Sign in to get access token
   * const tokenResponse = await authApi.signIn({ email: 'user@example.com', password: 'password123' });
   * console.log('Access token:', tokenResponse.accessToken);
   * ```
   */
  public async signUp(credentials: SignUpCredentials): Promise<SignUpResponse> {
    try {
      const response = await this.apiClient.post<SignUpResponse>(
        `${AUTH_V1_ENDPOINT}${SIGNUP_PATH}`,
        {
          email: credentials.email,
          password: credentials.password,
        }
      );
      return response;
    } catch (error: any) {
      this.mapError('signup', error);
    }
  }

  /**
   * Authenticates a user with email and password using OAuth 2.1 password grant (ROPC).
   *
   * Returns an access token (JWT signed with asymmetric keys) and optionally a refresh token.
   *
   * @param credentials - The email and password for authentication.
   * @returns A promise that resolves with the OAuth 2.1 token response.
   * @throws `AuthError` - If signin fails due to invalid credentials.
   * @throws `NetworkError` - For network-related issues.
   *
   * @example
   * ```typescript
   * const tokenResponse = await authApi.signIn({
   *   email: 'user@example.com',
   *   password: 'password123'
   * });
   *
   * console.log('Access token:', tokenResponse.accessToken);
   * console.log('Expires in:', tokenResponse.expiresIn, 'seconds');
   * ```
   */
  public async signIn(
    credentials: PasswordGrantCredentials
  ): Promise<TokenResponse> {
    try {
      const response = await this.apiClient.post<TokenResponse>(
        `${AUTH_V1_ENDPOINT}${TOKEN_PATH}`,
        {
          grantType: 'password',
          email: credentials.email,
          password: credentials.password,
        },
        {
          // Skip 401 retry: a 401 on a password grant means invalid
          // credentials, an expected error, not an expired access token.
          // Retrying via refresh would re-issue the request without the JSON
          // Content-Type and mask the real 401 as a confusing 415.
          skipRetryOn401: true,
        }
      );
      return response;
    } catch (error: any) {
      this.mapError('signin', error);
    }
  }

  /**
   * Refreshes an access token using a refresh token (OAuth 2.0 Refresh Token Grant per RFC 6749 Section 6).
   *
   * @param refreshToken - The refresh token to use for obtaining a new access token.
   * @returns A promise that resolves with the new token response.
   * @throws `AuthError` - If the refresh token is invalid or expired.
   * @throws `NetworkError` - For network-related issues.
   *
   * @example
   * ```typescript
   * const tokenResponse = await authApi.refreshToken(storedRefreshToken);
   * console.log('New access token:', tokenResponse.accessToken);
   * ```
   */
  public async refreshToken(refreshToken: string): Promise<TokenResponse> {
    try {
      const response = await this.apiClient.post<TokenResponse>(
        `${AUTH_V1_ENDPOINT}${TOKEN_PATH}`,
        {
          grantType: 'refresh_token',
          refreshToken: refreshToken,
        },
        {
          // Skip 401 retry: refreshToken is the retry mechanism itself.
          // A 401 here means the refresh token is invalid/expired.
          skipRetryOn401: true,
        }
      );
      return response;
    } catch (error: any) {
      this.mapError('refresh_token', error);
    }
  }

  /**
   * Revokes an access token (OAuth 2.0 Token Revocation per RFC 7009).
   *
   * The client must be authenticated using the Authorization header.
   * Returns success regardless of token validity (per RFC 7009).
   *
   * @param token - The access token to revoke. If not provided, uses the current authenticated token.
   * @returns A promise that resolves when signout is complete.
   * @throws `AuthError` - If client authentication fails.
   * @throws `NetworkError` - For network-related issues.
   *
   * @example
   * ```typescript
   * await authApi.signOut(accessToken);
   * console.log('Token revoked successfully');
   * ```
   */
  public async signOut(token: string): Promise<void> {
    try {
      // The controller expects application/x-www-form-urlencoded per OAuth 2.0 RFC 7009
      // But also accepts JSON for convenience. We'll use form-encoded as per spec.
      const formData = new URLSearchParams();
      formData.append('token', token);

      await this.apiClient.post(
        `${AUTH_V1_ENDPOINT}${SIGNOUT_PATH}`,
        formData.toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Bearer ${token}`,
          },
          // Skip 401 retry: signout should not trigger token refresh.
          // Per RFC 7009, signout returns success regardless of token validity.
          skipRetryOn401: true,
        }
      );
    } catch (error: any) {
      this.mapError('signout', error);
    }
  }

  /**
   * Revokes all active sessions for the authenticated user.
   *
   * This invalidates all tokens issued to the user, forcing re-authentication.
   * Useful for security incidents or password changes.
   *
   * @param bearerToken - The current access token for authentication.
   * @returns A promise that resolves with the count of sessions revoked.
   * @throws `AuthError` - If client authentication fails.
   * @throws `NetworkError` - For network-related issues.
   *
   * @example
   * ```typescript
   * const result = await authApi.signOutAll(accessToken);
   * console.log(`Revoked ${result.count} sessions`);
   * ```
   */
  public async signOutAll(bearerToken: string): Promise<SignOutAllResponse> {
    try {
      const response = await this.apiClient.post<SignOutAllResponse>(
        `${AUTH_V1_ENDPOINT}${SIGNOUT_ALL_PATH}`,
        {}, // Controller reads userId from authenticated token's claims
        {
          headers: {
            Authorization: `Bearer ${bearerToken}`,
          },
        }
      );
      return response;
    } catch (error: any) {
      this.mapError('signout', error);
    }
  }

  /**
   * Retrieves the JSON Web Key Set (JWKS) containing public keys for JWT verification.
   *
   * This endpoint provides public keys used to verify JWT access tokens issued by
   * the authorization server. Follows RFC 7517 (JSON Web Key) and OpenID Connect
   * Discovery standards.
   *
   * @returns A promise that resolves with the JWKS containing public keys.
   * @throws `NetworkError` - For network-related issues.
   *
   * @example
   * ```typescript
   * const jwks = await authApi.getJwks();
   * console.log('Public keys:', jwks.keys);
   *
   * // Example key structure for ES256:
   * // {
   * //   kty: "EC",
   * //   use: "sig",
   * //   kid: "rayfin-key-2024",
   * //   alg: "ES256",
   * //   crv: "P-256",
   * //   x: "...",
   * //   y: "..."
   * // }
   * ```
   */
  public async getJwks(): Promise<JwksResponse> {
    return await this.apiClient.get<JwksResponse>(JWKS_PATH, {
      headers: {
        'Cache-Control': 'no-cache', // Request fresh keys, but server may still cache
      },
    });
  }

  /**
   * Verifies a user's email address with a verification token.
   *
   * This method is called after a user clicks the verification link in their email.
   * Upon success, the user's email is marked as verified and they can sign in.
   *
   * @param token - The verification token from the email link.
   * @returns A promise that resolves with the verification response.
   * @throws `AuthError` - If the token is invalid, expired, or already used.
   * @throws `NetworkError` - For network-related issues.
   *
   * @example
   * ```typescript
   * // Extract token from URL query parameter
   * const urlParams = new URLSearchParams(window.location.search);
   * const token = urlParams.get('token');
   *
   * if (token) {
   *   const result = await authApi.verifyEmail(token);
   *   console.log(result.message); // "Email verified successfully!"
   * }
   * ```
   */
  public async verifyEmail(token: string): Promise<EmailVerificationResponse> {
    try {
      // Construct URL with query parameter
      const url = `${AUTH_V1_ENDPOINT}${VERIFY_EMAIL_PATH}?token=${encodeURIComponent(token)}`;
      const response = await this.apiClient.get<EmailVerificationResponse>(url);
      return response;
    } catch (error: any) {
      this.mapError('verifyEmail', error);
    }
  }

  /**
   * Resends the email verification link to the specified email address.
   *
   * This allows users to request a new verification email if they didn't receive
   * the original or if it expired. Previous unused verification tokens are automatically
   * invalidated. For security, always returns success to prevent email enumeration.
   *
   * @param request - The resend request with email address.
   * @returns A promise that resolves with a success message.
   * @throws `AuthError` - If the request is invalid.
   * @throws `NetworkError` - For network-related issues.
   *
   * @example
   * ```typescript
   * const result = await authApi.resendVerificationEmail({ email: 'user@example.com' });
   * console.log(result.message); // "If an account exists with this email and is unverified, a verification link has been sent."
   * ```
   */
  public async resendVerificationEmail(
    request: ResendVerificationEmailRequest
  ): Promise<ResendVerificationEmailResponse> {
    try {
      const response =
        await this.apiClient.post<ResendVerificationEmailResponse>(
          `${AUTH_V1_ENDPOINT}${RESEND_VERIFICATION_EMAIL_PATH}`,
          { email: request.email }
        );
      return response;
    } catch (error: any) {
      this.mapError('resendVerificationEmail', error);
    }
  }

  /**
   * Requests a password reset email for the specified email address.
   *
   * This initiates the password reset flow. If an account exists with the provided
   * email, a reset link will be sent. For security, always returns success to
   * prevent email enumeration attacks.
   *
   * @param request - The password reset request with email address.
   * @returns A promise that resolves with a success message.
   * @throws `AuthError` - If the request is invalid.
   * @throws `NetworkError` - For network-related issues.
   *
   * @example
   * ```typescript
   * const result = await authApi.requestPasswordReset({ email: 'user@example.com' });
   * console.log(result.message); // "If an account exists with this email, a reset link has been sent."
   * ```
   */
  public async requestPasswordReset(
    request: PasswordResetRequest
  ): Promise<PasswordResetResponse> {
    try {
      const response = await this.apiClient.post<PasswordResetResponse>(
        `${AUTH_V1_ENDPOINT}${REQUEST_PASSWORD_RESET_PATH}`,
        { email: request.email }
      );
      return response;
    } catch (error: any) {
      this.mapError('requestPasswordReset', error);
    }
  }

  /**
   * Completes the password reset process with a reset token and new password.
   *
   * This method is called after a user clicks the reset link in their email and
   * submits a new password. Upon success, all existing sessions are invalidated
   * for security and the user must sign in with the new password.
   *
   * @param request - The reset completion request with token and new password.
   * @returns A promise that resolves with a success message.
   * @throws `AuthError` - If the token is invalid, expired, or already used.
   * @throws `NetworkError` - For network-related issues.
   *
   * @example
   * ```typescript
   * // Extract token from URL query parameter
   * const urlParams = new URLSearchParams(window.location.search);
   * const token = urlParams.get('token');
   *
   * if (token) {
   *   const result = await authApi.completePasswordReset({
   *     token,
   *     newPassword: 'newSecurePassword123'
   *   });
   *   console.log(result.message); // "Password updated successfully."
   * }
   * ```
   */
  public async completePasswordReset(
    request: CompletePasswordResetRequest
  ): Promise<PasswordResetResponse> {
    try {
      const response = await this.apiClient.post<PasswordResetResponse>(
        `${AUTH_V1_ENDPOINT}${COMPLETE_PASSWORD_RESET_PATH}`,
        {
          token: request.token,
          newPassword: request.newPassword,
        }
      );
      return response;
    } catch (error: any) {
      this.mapError('completePasswordReset', error);
    }
  }

  /**
   * Sends a magic link email for passwordless authentication.
   *
   * This initiates the magic link authentication flow. The user will receive
   * an email with a link containing a verification code and state parameter.
   * When clicked, the link redirects to the specified redirect URI with the
   * code and state as query parameters.
   *
   * PKCE is used to protect the flow: the codeChallenge is sent with this request,
   * and the corresponding codeVerifier must be provided when exchanging the code
   * for tokens.
   *
   * @param request - The magic link request with email, codeChallenge, state, and redirectUri.
   * @returns A promise that resolves with success status.
   * @throws `AuthError` - If magic link is disabled or request is invalid.
   * @throws `NetworkError` - For network-related issues.
   *
   * @example
   * ```typescript
   * const response = await authApi.sendMagicLink({
   *   email: 'user@example.com',
   *   codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
   *   state: 'xyzzy123',
   *   redirectUri: 'https://myapp.com/auth/callback'
   * });
   * console.log(response.success); // true
   * ```
   */
  public async sendMagicLink(
    request: MagicLinkRequest
  ): Promise<MagicLinkResponse> {
    try {
      const response = await this.apiClient.post<MagicLinkResponse>(
        `${AUTH_V1_ENDPOINT}${MAGIC_LINK_SEND_PATH}`,
        {
          email: request.email,
          codeChallenge: request.codeChallenge,
          state: request.state,
          redirectUri: request.redirectUri,
        }
      );
      return response;
    } catch (error: any) {
      this.mapError('sendMagicLink', error);
    }
  }

  /**
   * Exchanges a verification code for access and refresh tokens.
   *
   * This is the second step of the magic link authentication flow.
   * Called after the user clicks the magic link and is redirected back
   * to your application with a verification code.
   *
   * Uses PKCE: the codeVerifier must match the codeChallenge sent during sendMagicLink.
   * The redirectUri must also match the one sent during sendMagicLink.
   *
   * @param request - The exchange request with verificationCode, codeVerifier, and redirectUri.
   * @returns A promise that resolves with the OAuth 2.1 token response.
   * @throws `AuthError` - If the code is invalid, expired, or PKCE validation fails.
   * @throws `NetworkError` - For network-related issues.
   *
   * @example
   * ```typescript
   * const tokenResponse = await authApi.exchangeVerificationCode({
   *   verificationCode: 'abc123...',
   *   codeVerifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
   *   redirectUri: 'https://myapp.com/auth/callback'
   * });
   * console.log('Access token:', tokenResponse.accessToken);
   * ```
   */
  public async exchangeVerificationCode(
    request: VerificationCodeExchangeRequest
  ): Promise<TokenResponse> {
    try {
      const response = await this.apiClient.post<TokenResponse>(
        `${AUTH_V1_ENDPOINT}${TOKEN_PATH}`,
        {
          grantType: 'authorization_code',
          verificationCode: request.verificationCode,
          codeVerifier: request.codeVerifier,
          redirectUri: request.redirectUri,
          ...(request.codeType ? { codeType: request.codeType } : {}),
        }
      );
      return response;
    } catch (error: any) {
      this.mapError('exchangeVerificationCode', error);
    }
  }

  /**
   * Fetches auth settings from the backend project configuration.
   * Use this to dynamically configure UI based on enabled auth methods.
   *
   * This endpoint is public and does not require authentication.
   *
   * @returns A promise that resolves with the auth settings configuration.
   * @throws `NetworkError` - For network-related issues.
   *
   * @example
   * ```typescript
   * const settings = await authApi.getAuthSettings();
   *
   * // Check available methods
   * if (settings.password.enabled) {
   *   // Show password login form
   * }
   * if (settings.passwordless.magicLink.enabled) {
   *   // Show magic link option
   * }
   *
   * // Or use the convenience array
   * settings.availableMethods.forEach(method => {
   *   console.log(`${method} is available`);
   * });
   * ```
   */
  public async getAuthSettings(): Promise<AuthSettingsConfig> {
    // Fetch project runtime settings from the backend
    // This endpoint returns the full ServiceSettings, we parse out the auth portion
    const response = await this.apiClient.get<ProjectRuntimeSettingsResponse>(
      PROJECT_RUNTIME_SETTINGS_PATH
    );

    return this.parseAuthSettings(response.serviceSettings);
  }

  /**
   * Parses the service settings into a clean AuthSettingsConfig.
   * @internal
   */
  private parseAuthSettings(
    settings: ProjectRuntimeSettingsResponse['serviceSettings']
  ): AuthSettingsConfig {
    const authEnabled = settings?.auth?.enabled ?? true;
    const passwordEnabled = settings?.auth?.password?.enabled ?? true;
    const magicLinkEnabled =
      settings?.auth?.passwordless?.magicLink?.enabled ?? false;
    const fabricEnabled = settings?.auth?.fabric?.enabled ?? false;

    const availableMethods: AuthMethod[] = [];
    if (passwordEnabled) availableMethods.push('password');
    if (magicLinkEnabled) availableMethods.push('magiclink');
    if (fabricEnabled) availableMethods.push('fabric');

    return {
      enabled: authEnabled,
      password: { enabled: passwordEnabled },
      passwordless: {
        magicLink: { enabled: magicLinkEnabled },
      },
      fabric: { enabled: fabricEnabled },
      availableMethods,
    };
  }
}

/**
 * Internal type representing the project runtime settings response.
 * Matches the backend ProjectSettings model structure.
 * @internal
 */
interface ProjectRuntimeSettingsResponse {
  tenantId?: string;
  projectId?: string;
  publishableKey?: string;
  serviceSettings: {
    auth?: {
      enabled?: boolean;
      password?: {
        enabled?: boolean;
      };
      passwordless?: {
        magicLink?: {
          enabled?: boolean;
        };
      };
      fabric?: {
        enabled?: boolean;
      };
    };
    data?: {
      enabled?: boolean;
    };
    storage?: {
      enabled?: boolean;
    };
  };
}
