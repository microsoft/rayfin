import { ApiClient } from '@microsoft/rayfin-lib';
import { AuthError, NetworkError, SdkError } from '@microsoft/rayfin-lib';

import { AuthApi } from './AuthApi';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
} from './pkce';
import type {
  SignUpCredentials,
  SignUpResponse,
  PasswordGrantCredentials,
  TokenResponse,
  Session,
  OpaqueSession,
  SignOutAllResponse,
  JwksResponse,
  JsonWebKey,
  AuthEvent,
  PasswordResetResponse,
  ResendVerificationEmailResponse,
  EmailVerificationResponse,
  MagicLinkOptions,
  MagicLinkResult,
  MagicLinkCallbackResult,
  PkceState,
  AuthSettingsConfig,
} from './types';

/**
 * Storage interface used by {@link Auth} to persist the session (and PKCE state)
 * across page loads. Defaults to `window.localStorage`; provide a custom
 * implementation (or `false` for memory-only) via the `Auth` constructor options.
 */
export interface AuthStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
  clear?(): void | Promise<void>;
  keys?(prefix: string): string[] | Promise<string[]>;
}

export interface AuthOptions {
  storage?: AuthStorage | boolean;
  storageKeyPrefix?: string;
  /** When false, all storage I/O is skipped — pure in-memory session. Default: true */
  persistSession?: boolean;
  /** When false, session expiration timers are not scheduled and automatic refresh on 401 is disabled. Default: true */
  autoRefreshToken?: boolean;
  /** When false, StorageEvent listener is not registered. Default: auto-detected (true in browser with localStorage). */
  multiTabSync?: boolean;
}

/**
 * The main Auth module class.
 * This provides the high-level API for authentication operations and manages the user session.
 */
export class Auth {
  private authApi: AuthApi;
  protected storage: AuthStorage | null = null;
  protected readonly AUTH_TOKEN_KEY: string;
  protected readonly AUTH_TOKEN_BASE = 'authSession';
  protected readonly PKCE_STATE_PREFIX_BASE = 'rayfin_pkce_'; // Base prefix for PKCE state storage keys
  protected readonly PKCE_STATE_PREFIX: string; // Full prefix including storage key prefix for multi-app isolation
  private static readonly PKCE_STATE_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes max age for PKCE state
  private static readonly PKCE_STALE_CLEANUP_AGE_MS = 60 * 60 * 1000; // 1 hour for stale cleanup
  private static readonly REFRESH_SKEW_MS = 60 * 1000; // Refresh proactively when AT expires within 60s
  private static readonly REFRESH_BACKOFF_BASE_MS = 5_000; // Initial backoff window after a transient refresh failure
  private static readonly REFRESH_BACKOFF_MAX_MS = 60_000; // Maximum backoff window (cap)
  private readonly refreshLockName: string; // Cross-tab lock name for navigator.locks
  private internalSession: Session | null = null; // Internal session with tokens
  private accessToken: string | null = null; // Concealed access token
  private refreshToken: string | null = null; // Concealed refresh token (stored for session persistence)
  private refreshInFlight: Promise<TokenResponse> | null = null; // Promise lock for concurrent refresh prevention
  private providerSignInInFlight: Promise<unknown> | null = null;
  private skipPersistenceOnChange = false;
  private lastRefreshFailure: {
    at: number;
    count: number;
    responseError?: AuthError;
  } | null = null;
  private storageEventListener: ((event: Event) => void) | null = null; // Storage event listener for multi-tab sync
  private storageEventSeq = 0; // Sequence counter — discards stale async validateAccessToken results
  private boundHandleVisibilityChange: (() => void) | null = null; // Bound handler for visibilitychange
  private boundHandleFocus: (() => void) | null = null; // Bound handler for window focus
  private boundHandleOnline: (() => void) | null = null; // Bound handler for online event
  protected authStateChangeListeners: ((
    session: OpaqueSession | null
  ) => void)[] = []; // Listeners for onSessionChange
  private eventListeners: Map<
    AuthEvent,
    Set<(session: OpaqueSession) => void>
  > = new Map();
  private sessionExpirationTimer: ReturnType<typeof setTimeout> | null = null; // Timer for expiration tracking
  private readonly persistSession: boolean;
  private readonly autoRefreshToken: boolean;
  private readonly multiTabSync: boolean;
  private pkceMemoryStore: Map<string, string> = new Map(); // In-memory fallback for PKCE state when storage is null
  private initPromise: Promise<void> | null = null; // Lazy initialization promise
  private syncRestoreDone = false; // Session was restored synchronously in the constructor
  private manualRefreshActive = false; // startAutoRefresh() is in effect (manual mode only)

  /**
   * @param apiClient - An instance of ApiClient to be used by the AuthApi.
   */
  constructor(apiClient: ApiClient, options?: AuthOptions) {
    this.authApi = new AuthApi(apiClient);

    // Read opt-out flags with backward-compatible defaults
    this.persistSession = options?.persistSession !== false;
    this.autoRefreshToken = options?.autoRefreshToken !== false;

    // Build a cross-tab lock name scoped to the storage key prefix so
    // multiple Rayfin apps on the same origin don't contend.
    const prefix = options?.storageKeyPrefix;
    this.refreshLockName = prefix
      ? `${prefix}_rayfin_refresh_lock`
      : 'rayfin_refresh_lock';

    if (options?.storageKeyPrefix) {
      this.AUTH_TOKEN_KEY = `${options.storageKeyPrefix}_${this.AUTH_TOKEN_BASE}`;
      this.PKCE_STATE_PREFIX = `${options.storageKeyPrefix}_${this.PKCE_STATE_PREFIX_BASE}`;
    } else {
      this.AUTH_TOKEN_KEY = this.AUTH_TOKEN_BASE;
      this.PKCE_STATE_PREFIX = this.PKCE_STATE_PREFIX_BASE;
    }

    // Resolve storage: guard window.localStorage access for Node.js safety
    if (!this.persistSession || options?.storage === false) {
      this.storage = null;
    } else if (options?.storage === undefined || options?.storage === true) {
      // Default to localStorage when in a browser, null otherwise
      this.storage =
        typeof window !== 'undefined' && window.localStorage
          ? window.localStorage
          : null;
    } else {
      this.storage = options.storage;
    }

    // Auto-detect multiTabSync: true only when in browser with localStorage as storage
    if (options?.multiTabSync !== undefined) {
      this.multiTabSync = options.multiTabSync;
    } else {
      this.multiTabSync =
        typeof window !== 'undefined' &&
        !!this.storage &&
        typeof window.localStorage !== 'undefined' &&
        this.storage === window.localStorage;
    }

    // Set up storage event listener for multi-tab synchronization (guarded)
    if (
      this.multiTabSync &&
      typeof window !== 'undefined' &&
      this.storage === window.localStorage
    ) {
      this.storageEventListener = this.handleStorageEvent.bind(this);
      window.addEventListener('storage', this.storageEventListener);
    }

    // Attach token provider (returns null until login)
    this.authApi.setAccessTokenProvider(() => this.accessToken);

    // Attach automatic refresh callback for 401 handling
    if (this.autoRefreshToken) {
      this.attachRefreshToClient(apiClient);
    }

    // Restore synchronously when storage is synchronous (browser localStorage)
    // so getSession() is authenticated right after construction. Async storage
    // restores later in ensureInitialized().
    this.tryRestoreSessionSync();
    void this.ensureInitialized();
  }

  /**
   * Restores the persisted session synchronously when `storage.getItem` returns
   * synchronously. No-op for async storage, which restores in `_initialize()`.
   * @internal
   */
  private tryRestoreSessionSync(): void {
    if (!this.storage || !this.persistSession) {
      return;
    }
    let raw: string | null | Promise<string | null>;
    try {
      raw = this.storage.getItem(this.AUTH_TOKEN_KEY);
    } catch {
      return;
    }
    // Async storage — defer to _initialize().
    if (
      raw !== null &&
      typeof (raw as Promise<string | null>).then === 'function'
    ) {
      return;
    }
    let stored: Session | null = null;
    if (typeof raw === 'string') {
      try {
        stored = JSON.parse(raw) as Session;
      } catch {
        stored = null;
      }
    }
    this.applyStoredSession(stored);
    this.syncRestoreDone = true;
  }

  /**
   * Applies a session loaded from storage to in-memory state. Shared by the
   * sync and async restore paths.
   * @internal
   */
  private applyStoredSession(stored: Session | null): void {
    if (!stored) {
      return;
    }
    if (!stored.user || !stored.accessToken) {
      console.warn(
        'Invalid session structure detected in storage. Clearing session.'
      );
      void this.clearSessionFromStorage();
      return;
    }
    // Re-extract user ID from token to ensure it's not 'unknown'
    stored.user.id = this.extractUserIdFromToken(stored.accessToken);

    const isExpired =
      stored.expiresAt && new Date(stored.expiresAt) < new Date();

    if (isExpired && !stored.refreshToken) {
      void this.clearSessionFromStorage();
      return;
    }

    this.internalSession = stored;
    this.refreshToken = stored.refreshToken ?? null;
    this.lastRefreshFailure = null;

    if (isExpired) {
      // Withhold the stale token; the eager refresh at the end of init replaces
      // it. Requests before then 401 and the retry handler joins the refresh.
      this.accessToken = null;
    } else {
      this.accessToken = stored.accessToken;
      this.scheduleSessionExpiration(new Date(stored.expiresAt!));
    }
  }

  /**
   * Lazy initialization: restores session from storage and cleans up stale PKCE states.
   * Called automatically by the first public method that accesses session state.
   * @internal
   */
  private async _initialize(): Promise<void> {
    if (this.storage && this.persistSession) {
      // Skip if the constructor already restored synchronously.
      if (!this.syncRestoreDone) {
        this.applyStoredSession(await this.getInternalSessionFromStorage());
        // Notify subscribers that registered before async restore completed.
        if (this.internalSession) {
          this.emitAuthStateChange(this._getSessionSync());
        }
      }
      // Persist session changes to storage
      this.onSessionChange((session) => {
        if (session && this.internalSession && !this.skipPersistenceOnChange) {
          this.setInternalSessionToStorage(this.internalSession);
        }
      });
    }
    // Register visibility/focus/online listeners for proactive token refresh.
    // Browsers throttle or discard setTimeout in background tabs and OS sleep
    // suspends the JS event loop entirely, so these events are the only reliable
    // way to detect that the tab has returned and the AT may have expired.
    // Gated on autoRefreshToken — callers that opt out manage refresh manually.
    if (
      this.autoRefreshToken &&
      typeof document !== 'undefined' &&
      typeof document.addEventListener === 'function'
    ) {
      this.boundHandleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          this.checkAndRefreshIfNeeded();
        }
      };
      document.addEventListener(
        'visibilitychange',
        this.boundHandleVisibilityChange
      );
    }
    if (
      this.autoRefreshToken &&
      typeof window !== 'undefined' &&
      typeof window.addEventListener === 'function'
    ) {
      this.boundHandleFocus = () => this.checkAndRefreshIfNeeded();
      window.addEventListener('focus', this.boundHandleFocus);

      this.boundHandleOnline = () => this.checkAndRefreshIfNeeded();
      window.addEventListener('online', this.boundHandleOnline);
    }

    // Clean up stale PKCE states from previous sessions
    await this.cleanupStalePkceStates();

    // If we restored an expired session with a valid refresh token, eagerly
    // refresh the access token so attached data clients get a fresh AT instead
    // of having every initial request 401 with a stale token.
    if (
      this.autoRefreshToken &&
      this.internalSession &&
      !this.accessToken &&
      this.hasRefreshToken()
    ) {
      this.fireAndForgetRefresh('constructor-eager');
    }
  }

  /**
   * Ensures lazy initialization has completed. Idempotent — runs once, subsequent calls are no-ops.
   * @internal
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this._initialize();
    }
    return this.initPromise;
  }

  /**
   * Cleans up stale PKCE states from storage.
   * Called on initialization to remove orphaned states from previous sessions
   * where the user requested a magic link but never clicked it.
   * @internal
   */
  private async cleanupStalePkceStates(): Promise<void> {
    // Clean up in-memory store
    const now = Date.now();
    for (const [key, value] of this.pkceMemoryStore) {
      try {
        const state = JSON.parse(value) as PkceState;
        if (now - state.createdAt > Auth.PKCE_STALE_CLEANUP_AGE_MS) {
          this.pkceMemoryStore.delete(key);
        }
      } catch {
        this.pkceMemoryStore.delete(key);
      }
    }

    // Clean up persistent storage if keys() is available
    if (!this.storage?.keys) {
      return;
    }

    try {
      const keys = await this.storage.keys(this.PKCE_STATE_PREFIX);
      const keysToRemove: string[] = [];

      for (const key of keys) {
        try {
          const stateJson = await this.storage.getItem(key);
          if (stateJson) {
            const state = JSON.parse(stateJson) as PkceState;
            if (now - state.createdAt > Auth.PKCE_STALE_CLEANUP_AGE_MS) {
              keysToRemove.push(key);
            }
          }
        } catch {
          keysToRemove.push(key);
        }
      }

      for (const key of keysToRemove) {
        await this.storage.removeItem(key);
      }

      if (keysToRemove.length > 0) {
        console.debug(`Cleaned up ${keysToRemove.length} stale PKCE states`);
      }
    } catch {
      // Ignore errors during cleanup - non-critical operation
    }
  }

  /**
   * Gets a PKCE state value, routing through this.storage or falling back to pkceMemoryStore.
   * @internal
   */
  private async pkceGet(key: string): Promise<string | null> {
    if (this.storage && this.persistSession) {
      return (await this.storage.getItem(key)) ?? null;
    }
    return this.pkceMemoryStore.get(key) ?? null;
  }

  /**
   * Sets a PKCE state value, routing through this.storage or falling back to pkceMemoryStore.
   * @internal
   */
  private async pkceSet(key: string, value: string): Promise<void> {
    if (this.storage && this.persistSession) {
      await this.storage.setItem(key, value);
    } else {
      this.pkceMemoryStore.set(key, value);
    }
  }

  /**
   * Removes a PKCE state value, routing through this.storage or falling back to pkceMemoryStore.
   * @internal
   */
  private async pkceRemove(key: string): Promise<void> {
    if (this.storage && this.persistSession) {
      await this.storage.removeItem(key);
    } else {
      this.pkceMemoryStore.delete(key);
    }
  }

  /**
   * Handles storage events for multi-tab synchronization.
   * When another tab updates or clears the session, this tab syncs accordingly.
   * @internal
   */
  private async handleStorageEvent(event: Event): Promise<void> {
    // Only handle events for our auth token key
    const storageEvent = event as unknown as {
      key: string | null;
      newValue: string | null;
    };
    if (storageEvent.key !== this.AUTH_TOKEN_KEY) {
      return;
    }

    // Bump sequence so any in-flight async validation from a prior event
    // is discarded (prevents stale session restoration after logout).
    const seq = ++this.storageEventSeq;

    if (storageEvent.newValue) {
      // Session updated in another tab (e.g., after refresh or login)
      try {
        const session = JSON.parse(storageEvent.newValue) as Session;

        // Validate the access token before accepting it
        // This prevents poison pill attacks via localStorage manipulation
        const isValid = await this.validateAccessToken(session.accessToken);

        // A newer event arrived while we were validating — discard.
        if (seq !== this.storageEventSeq) {
          return;
        }

        if (!isValid) {
          console.warn(
            'Invalid access token detected in storage event, ignoring'
          );
          return;
        }

        // Update local session state
        this.internalSession = session;
        this.accessToken = session.accessToken;
        this.refreshToken = session.refreshToken ?? null;
        this.lastRefreshFailure = null;

        // Just emit refresh event to notify application of the token change
        this.emitAuthEvent('AUTH_REFRESH');
      } catch (error) {
        // Invalid session data, ignore
        console.warn('Failed to parse session from storage event:', error);
      }
    } else {
      // Session cleared in another tab (logout)
      await this.clearInternalSession();
    }
  }

  /**
   * Registers a new user with email and password.
   *
   * After successful signup, you must call signIn() to obtain an access token.
   * This design supports future email verification flows.
   *
   * Emits `AUTH_SIGNUP` event on success.
   *
   * @param credentials - The signup credentials (email, password).
   * @returns A promise that resolves with signup response (userId, email, role, createdAt).
   * @throws `AuthError` - If credentials are invalid or email already registered.
   * @throws `NetworkError` - For network-related issues.
   * @throws `SdkError` - For any other unexpected SDK errors.
   *
   * @example
   * ```typescript
   * // Listen for signup events
   * auth.on('AUTH_SIGNUP', (session) => {
   *   console.log('User signed up!');
   * });
   *
   * // Step 1: Sign up
   * const signupResponse = await auth.signUp({
   *   email: 'user@example.com',
   *   password: 'password123'
   * });
   * console.log('User created:', signupResponse.userId);
   *
   * // Step 2: Sign in to get access token
   * await auth.signIn({
   *   email: 'user@example.com',
   *   password: 'password123'
   * });
   * ```
   */
  public async signUp(credentials: SignUpCredentials): Promise<SignUpResponse> {
    await this.ensureInitialized();
    // Basic validation
    if (!credentials.email || !credentials.password) {
      throw new AuthError(
        'Email and password are required for signup.',
        'MISSING_CREDENTIALS'
      );
    }
    if (credentials.password.length < 6) {
      throw new AuthError(
        'Password must be at least 6 characters long.',
        'PASSWORD_TOO_SHORT'
      );
    }

    try {
      const response = await this.authApi.signUp(credentials);

      // No token is issued at signup
      // Emit signup event for tracking (useful for email verification flow)
      this.emitAuthEvent('AUTH_SIGNUP');

      // Return signup response without creating a session
      return response;
    } catch (error: any) {
      // Re-throw specific SDK errors for the consumer to handle
      if (
        error instanceof AuthError ||
        error instanceof NetworkError ||
        error instanceof SdkError
      ) {
        throw error;
      }
      // Catch any unexpected errors and wrap them in a generic SDK error
      throw new SdkError(
        `An unexpected error occurred during signup: ${error.message || error}`,
        'UNKNOWN_SIGNUP_ERROR'
      );
    }
  }

  /**
   * Signs in a user with email and password using OAuth 2.1 password grant (ROPC).
   *
   * After successful signin, the user session will be stored internally.
   * Returns an access token (JWT signed with asymmetric keys) and optionally a refresh token.
   *
   * @param credentials - The email and password for authentication.
   * @returns A promise that resolves with the OAuth 2.1 token response.
   * @throws `AuthError` - If signin fails due to invalid credentials.
   * @throws `NetworkError` - For network-related issues.
   * @throws `SdkError` - For any other unexpected SDK errors.
   *
   * @example
   * ```typescript
   * const tokenResponse = await auth.signIn({
   *   email: 'user@example.com',
   *   password: 'password123'
   * });
   * console.log('Signed in, access token expires in:', tokenResponse.expiresIn, 'seconds');
   * ```
   */
  public async signIn(
    credentials: PasswordGrantCredentials
  ): Promise<TokenResponse> {
    await this.ensureInitialized();
    // Basic validation
    if (!credentials.email || !credentials.password) {
      throw new AuthError(
        'Email and password are required for signin.',
        'MISSING_CREDENTIALS'
      );
    }

    let responseError: AuthError | undefined;
    try {
      const response = await this.authApi
        .signIn(credentials)
        .catch((error: unknown) => {
          responseError = this.authApi
            .getClientForProvider()
            .getResponseAuthError(error);
          throw responseError ?? error;
        });

      if (response.accessToken) {
        // Calculate expiresAt from expiresIn (seconds)
        const expiresAt = new Date(Date.now() + response.expiresIn * 1000);

        // Decode JWT to extract user ID from 'sub' claim
        const userId = this.extractUserIdFromToken(response.accessToken);

        this.internalSession = {
          user: { id: userId, email: credentials.email },
          accessToken: response.accessToken,
          refreshToken: response.refreshToken ?? null,
          expiresAt,
        };
        this.accessToken = response.accessToken;
        this.refreshToken = response.refreshToken ?? null;
        this.lastRefreshFailure = null;

        // Schedule session expiration timer
        this.scheduleSessionExpiration(expiresAt);

        this.emitAuthEvent('AUTH_LOGIN');
      } else {
        await this.clearInternalSession();
      }

      return response;
    } catch (error: any) {
      if (responseError && error === responseError) {
        throw responseError;
      }
      // Preserve a session on service access denial, not other signin failures.
      await this.clearInternalSession();

      if (
        error instanceof SdkError &&
        error.code === 'ArtifactBlockedByAdmin'
      ) {
        throw new SdkError(
          'An unexpected error occurred during signin.',
          'UNKNOWN_SIGNIN_ERROR'
        );
      }

      // Re-throw specific SDK errors
      if (
        error instanceof AuthError ||
        error instanceof NetworkError ||
        error instanceof SdkError
      ) {
        throw error;
      }
      throw new SdkError(
        `An unexpected error occurred during signin: ${error.message || error}`,
        'UNKNOWN_SIGNIN_ERROR'
      );
    }
  }

  /**
   * Signs out the current user by revoking their access token (OAuth 2.0 Token Revocation).
   *
   * Clears the internal session and revokes the token on the server.
   * Per RFC 7009, the server returns success regardless of token validity.
   *
   * @returns A promise that resolves when signout is complete.
   * @throws `AuthError` - If client authentication fails.
   * @throws `NetworkError` - For network-related issues.
   * @throws `SdkError` - For any other unexpected SDK errors.
   *
   * @example
   * ```typescript
   * // Listen for sign-out events to update UI
   * auth.on('AUTH_LOGOUT', () => {
   *   navigate('/login');
   * });
   *
   * try {
   *   await auth.signOut();
   *   // Internal session is cleared even if the server call fails.
   * } catch (error) {
   *   console.error('Sign-out had a problem:', error.message);
   * }
   * ```
   */
  public async signOut(): Promise<void> {
    await this.ensureInitialized();
    try {
      const hasSession = !!this.internalSession && !!this.accessToken;
      if (!hasSession) {
        console.warn('No active session to sign out from');
        return;
      }
      // Revoke token on server (ignore errors, handled below)
      await this.authApi.signOut(this.accessToken!);
      await this.clearInternalSession();
    } catch (error: any) {
      // Clear the session even if the backend request fails
      await this.clearInternalSession();
      // Re-throw specific SDK errors
      if (
        error instanceof AuthError ||
        error instanceof NetworkError ||
        error instanceof SdkError
      ) {
        throw error;
      }
      throw new SdkError(
        `An unexpected error occurred during signout: ${error.message || error}`,
        'UNKNOWN_SIGNOUT_ERROR'
      );
    }
  }

  /**
   * Revokes all active sessions for the authenticated user.
   *
   * This invalidates all tokens issued to the user, forcing re-authentication.
   * Useful for security incidents or password changes.
   *
   * @returns A promise that resolves with the count of sessions revoked.
   * @throws `AuthError` - If no active session or client authentication fails.
   *
   * @example
   * ```typescript
   * const result = await auth.signOutAll();
   * console.log(`Revoked ${result.count} sessions`);
   * ```
   */
  public async signOutAll(): Promise<SignOutAllResponse> {
    const token = this.accessToken;
    if (!token) {
      throw new AuthError('No active session.', 'NO_SESSION');
    }
    const response = await this.authApi.signOutAll(token);
    // Clear local session after signing out all sessions
    await this.clearInternalSession();
    // Event emitted by clearInternalSession()
    return response;
  }

  /**
   * Retrieves the JSON Web Key Set (JWKS) containing public keys for JWT verification.
   *
   * This endpoint provides public keys used to verify JWT access tokens and refresh
   * tokens issued by the authorization server. Follows RFC 7517 (JSON Web Key) and
   * OpenID Connect Discovery standards.
   *
   * The response may contain multiple keys to support key rotation:
   * - Active key: The current signing key used for new tokens
   * - Previous key: The previous signing key for validating tokens signed before rotation
   *
   * Use the `kid` (key ID) from the JWT header to find the matching verification key.
   *
   * @returns A promise that resolves with the JWKS containing public keys.
   * @throws `NetworkError` - For network-related issues.
   *
   * @example
   * ```typescript
   * const jwks = await auth.getJwks();
   * console.log('Public keys:', jwks.keys);
   * // Find key by kid
   * const key = jwks.keys.find(k => k.kid === 'desired-kid');
   * ```
   */
  public async getJwks(): Promise<JwksResponse> {
    return await this.authApi.getJwks();
  }

  /**
   * Gets the authentication settings from the backend.
   * This is a public endpoint that does not require authentication.
   *
   * @returns A promise that resolves with the authentication configuration.
   * @throws `NetworkError` - For network-related issues.
   *
   * @example
   * ```typescript
   * const settings = await auth.getAuthSettings();
   * if (settings.password.enabled) {
   *   // Show password login form
   * }
   * if (settings.passwordless.magicLink.enabled) {
   *   // Show magic link option
   * }
   * ```
   */
  public async getAuthSettings(): Promise<AuthSettingsConfig> {
    return await this.authApi.getAuthSettings();
  }

  /**
   * Returns the internal AuthApi instance.
   * Used by companion auth provider packages (e.g., fabric provider).
   * @returns The AuthApi instance used by this Auth instance.
   */
  public getAuthApi(): AuthApi {
    return this.authApi;
  }

  /**
   * Serializes explicit companion-provider sign-ins and excludes refresh while
   * an exchange and its session installation are in progress.
   * @internal
   */
  public runProviderSignIn<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.providerSignInInFlight;
    const pending = (async () => {
      await previous?.catch(() => {});
      await this.ensureInitialized();
      await this.refreshInFlight?.catch(() => {});
      const previousSession = this.internalSession;
      this.clearSessionExpirationTimer();
      try {
        return await operation();
      } finally {
        if (
          this.internalSession === previousSession &&
          previousSession?.expiresAt
        ) {
          this.scheduleSessionExpiration(new Date(previousSession.expiresAt));
        }
      }
    })();
    this.providerSignInInFlight = pending;
    const clear = () => {
      if (this.providerSignInInFlight === pending) {
        this.providerSignInInFlight = null;
      }
    };
    void pending.then(clear, clear);
    return pending;
  }

  /**
   * Creates an authenticated session from a raw TokenResponse.
   * Used by companion auth provider packages after exchanging external codes.
   *
   * Decodes the JWT, creates the internal session, schedules expiration,
   * and emits AUTH_LOGIN.
   *
   * **Persistence note:** Storage is updated indirectly — the constructor
   * registers an `onSessionChange` listener that calls
   * `setInternalSessionToStorage()` whenever `AUTH_LOGIN` is emitted.
   * This is the same pattern used by `signIn()` and
   * `handleMagicLinkCallback()`. No explicit `setInternalSessionToStorage()`
   * call is needed by default. Explicit provider replacement can opt into
   * awaiting persistence before committing the session and emitting the event.
   *
   * @internal This method is reserved for first-party companion auth provider
   * packages (e.g. `@microsoft/rayfin-auth-provider-fabric`). It is excluded
   * from the published type definitions and is not part of the supported
   * public API. Standard auth flows (`signIn`, `handleMagicLinkCallback`)
   * establish sessions internally and do not require this method.
   *
   * @param tokenResponse - The token response from a token exchange.
   * @returns The opaque session for the authenticated user.
   */
  public async createSessionFromTokenResponse(
    tokenResponse: TokenResponse,
    options?: { persistBeforeCommit?: boolean }
  ): Promise<OpaqueSession> {
    await this.ensureInitialized();
    const expiresAt = new Date(Date.now() + tokenResponse.expiresIn * 1000);
    const userId = this.extractUserIdFromToken(tokenResponse.accessToken);
    const email = this.extractEmailFromToken(tokenResponse.accessToken);

    const session: Session = {
      user: { id: userId, email },
      accessToken: tokenResponse.accessToken,
      refreshToken: tokenResponse.refreshToken ?? null,
      expiresAt,
    };
    if (options?.persistBeforeCommit) {
      // Explicit replacement must not report success before persistence, or
      // discard the prior in-memory session if storage rejects the new one.
      await this.setInternalSessionToStorage(session);
    }
    this.internalSession = session;
    this.accessToken = tokenResponse.accessToken;
    this.refreshToken = tokenResponse.refreshToken ?? null;
    this.lastRefreshFailure = null;

    this.scheduleSessionExpiration(expiresAt);
    // Do not enqueue a duplicate asynchronous write when this session has
    // already been persisted: it could race the next explicit sign-in.
    this.emitPersistedAuthEvent(
      'AUTH_LOGIN',
      options?.persistBeforeCommit === true
    );

    return this._getSessionSync();
  }

  /**
   * Returns the current authenticated session.
   * @returns The current session object or null if no user is authenticated.
   */
  public getSession(): OpaqueSession {
    return this._getSessionSync();
  }

  /**
   * Internal synchronous session accessor — use after initialization is guaranteed.
   * @internal
   */
  private _getSessionSync(): OpaqueSession {
    const s = this.internalSession;
    const role = s?.role ?? s?.user?.role;
    const isAnon = role?.toLowerCase() === 'anonymous';
    return {
      user: s?.user ?? null,
      role: role,
      expiresAt: s?.expiresAt,
      isAuthenticated: !!s && !!this.accessToken,
      isAnonymous: !!s && isAnon,
    };
  }

  /**
   * Returns true if the current session has a refresh token available.
   * @returns True if refresh token exists and session is active.
   */
  public hasRefreshToken(): boolean {
    return this._hasRefreshTokenSync();
  }

  /**
   * Internal synchronous refresh token check — use after initialization is guaranteed.
   * @internal
   */
  private _hasRefreshTokenSync(): boolean {
    return !!this.refreshToken && !!this.internalSession;
  }

  /**
   * Refreshes the current session using the stored refresh token.
   * Uses a promise lock to prevent concurrent refresh requests.
   *
   * @returns A promise that resolves with new token response.
   * @throws `AuthError` - If no refresh token is available or refresh fails.
   *
   * @example
   * ```typescript
   * try {
   *   const tokens = await auth.refreshSession();
   *   console.log('Session refreshed:', tokens);
   * } catch (error) {
   *   console.error('Refresh failed:', error);
   * }
   * ```
   */
  public async refreshSession(): Promise<TokenResponse> {
    await this.ensureInitialized();
    while (this.providerSignInInFlight) {
      await this.providerSignInInFlight.catch(() => {});
    }

    // Return in-flight promise if refresh already in progress (same-tab dedup)
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    // Backoff: if the last refresh failed with a transient error, short-circuit
    // to avoid hammering an unhealthy token endpoint.
    if (this.lastRefreshFailure) {
      const elapsed = Date.now() - this.lastRefreshFailure.at;
      const backoffMs = Math.min(
        Auth.REFRESH_BACKOFF_BASE_MS *
          Math.pow(2, this.lastRefreshFailure.count - 1),
        Auth.REFRESH_BACKOFF_MAX_MS
      );
      if (elapsed < backoffMs) {
        if (this.lastRefreshFailure.responseError) {
          throw this.lastRefreshFailure.responseError;
        }
        throw new AuthError(
          'Refresh temporarily unavailable, try again later.',
          'REFRESH_BACKOFF'
        );
      }
    }

    // Use navigator.locks for cross-tab mutual exclusion when available
    // (modern browsers). Falls back to per-instance promise lock in Node.js,
    // SSR, and older browsers — isomorphic-safe.
    if (
      typeof globalThis.navigator !== 'undefined' &&
      globalThis.navigator.locks &&
      typeof globalThis.navigator.locks.request === 'function'
    ) {
      return this.refreshWithCrossTabLock();
    }

    return this.refreshWithLocalLock();
  }

  /**
   * Acquires a cross-tab lock via navigator.locks before refreshing.
   * Only one tab at a time can hold the lock; others wait for it.
   * After acquiring the lock, checks if the session was already refreshed
   * by another tab (via the storage event listener) to avoid a redundant call.
   */
  private async refreshWithCrossTabLock(): Promise<TokenResponse> {
    return globalThis.navigator.locks.request(
      this.refreshLockName,
      async () => {
        return this.refreshWithLocalLock();
      }
    );
  }

  /**
   * Per-instance refresh with promise lock (same-tab dedup).
   */
  private async refreshWithLocalLock(): Promise<TokenResponse> {
    // A cross-tab lock may have been acquired after a provider sign-in started.
    while (this.providerSignInInFlight) {
      await this.providerSignInInFlight.catch(() => {});
    }
    // Re-check in-flight in case we entered via cross-tab lock path
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    // Start new refresh
    this.refreshInFlight = this._doRefresh();

    try {
      const result = await this.refreshInFlight;
      return result;
    } finally {
      this.refreshInFlight = null;
    }
  }

  /**
   * Internal method that performs the actual refresh token grant.
   * Should only be called through refreshSession() to ensure locking.
   */
  private async _doRefresh(): Promise<TokenResponse> {
    const currentRefreshToken = this.refreshToken;
    if (!currentRefreshToken) {
      throw new AuthError('No refresh token available.', 'NO_REFRESH_TOKEN');
    }

    // Refresh requires existing session
    if (!this.internalSession) {
      throw new AuthError('No active session to refresh.', 'NO_SESSION');
    }

    let responseError: AuthError | undefined;
    try {
      // Make refresh token grant request
      const response = await this.authApi
        .refreshToken(currentRefreshToken)
        .catch((error: unknown) => {
          responseError = this.authApi
            .getClientForProvider()
            .getResponseAuthError(error);
          throw responseError ?? error;
        });

      // Update session with new tokens
      if (response.accessToken) {
        const expiresAt = new Date(Date.now() + response.expiresIn * 1000);

        this.internalSession = {
          ...this.internalSession,
          accessToken: response.accessToken,
          refreshToken: response.refreshToken ?? currentRefreshToken,
          expiresAt,
        };

        this.accessToken = response.accessToken;
        this.refreshToken = response.refreshToken ?? currentRefreshToken;

        await this.setInternalSessionToStorage(this.internalSession);
        this.scheduleSessionExpiration(expiresAt);
        // Reset backoff state on successful refresh
        this.lastRefreshFailure = null;
        this.emitPersistedAuthEvent('AUTH_REFRESH', true);
      }

      return response;
    } catch (error) {
      // On invalid_grant from refresh endpoint: treat as session expired.
      // This handles: refresh token expired, revoked, user deleted, session invalidated
      // (e.g., server-side replay-attack revocation, signing-key rotation eviction).
      //
      // Note: AuthApi.refreshToken wraps a 401 NetworkError into AuthError('INVALID_GRANT')
      // via mapError(). The original NetworkError check is kept as a defense-in-depth fallback
      // in case AuthApi is bypassed or the mapping changes.
      const isInvalidRefresh =
        (error instanceof AuthError && error.code === 'INVALID_GRANT') ||
        (error instanceof NetworkError && error.status === 401);

      if (isInvalidRefresh) {
        this.lastRefreshFailure = null; // Clear backoff — session is gone
        // Tear down the in-memory session BEFORE emitting events or clearing
        // storage. setInternalSessionToStorage runs asynchronously via the
        // persist-on-change listener, so leaving internalSession set here would
        // let a stale write land after clearSessionFromStorage and resurrect
        // the dead session in storage.
        this.internalSession = null;
        this.accessToken = null;
        this.refreshToken = null;
        this.clearSessionExpirationTimer();
        await this.clearSessionFromStorage();
        this.emitAuthEvent('AUTH_SESSION_EXPIRED');
        this.emitAuthEvent('AUTH_LOGOUT');
        throw new AuthError(
          'Session expired. Please sign in again.',
          'SESSION_EXPIRED'
        );
      }
      // Back off without replacing a recognized service rejection's code.
      const prevCount = this.lastRefreshFailure?.count ?? 0;
      this.lastRefreshFailure = {
        at: Date.now(),
        count: prevCount + 1,
        responseError,
      };
      if (
        !responseError &&
        error instanceof SdkError &&
        error.code === 'ArtifactBlockedByAdmin'
      ) {
        throw new SdkError(
          'An unexpected error occurred during token refresh.'
        );
      }
      // Re-throw other errors (network issues, server errors, etc.)
      throw responseError ?? error;
    }
  }

  /**
   * Attaches authorization header injection and automatic token refresh to
   * another {@link ApiClient} instance, so requests made through it carry the
   * current access token and trigger a refresh on 401 responses.
   *
   * @param client - The API client to wire up with this `Auth` instance.
   */
  public attachToClient(client: ApiClient): void {
    client.setAccessTokenCallback(() => this.accessToken);
    this.attachRefreshToClient(client);
    // If the retry after refresh also returns 401, the fresh AT was rejected
    // by the server — sign out so the user can re-authenticate.
    client.setAuthExhaustedCallback(() => {
      this.clearInternalSession();
    });
  }

  private attachRefreshToClient(client: ApiClient): void {
    client.setAuthRefreshCallback(
      async () => {
        if (this.hasRefreshToken()) {
          await this.refreshSession();
        }
      },
      (error) => this.getRefreshResponseError(error)
    );
  }

  /** @internal Recognizes only this session's current refresh failure or backoff. */
  public getRefreshResponseError(error: unknown): AuthError | undefined {
    const current = this.lastRefreshFailure?.responseError;
    return current && error === current
      ? this.authApi.getClientForProvider().getResponseAuthError(current)
      : undefined;
  }

  /**
   * Cleans up resources used by the Auth instance.
   * Removes storage event listener and clears timers.
   * Should be called when the Auth instance is no longer needed.
   */
  public destroy(): void {
    // Remove storage event listener
    if (this.storageEventListener && typeof window !== 'undefined') {
      window.removeEventListener('storage', this.storageEventListener);
      this.storageEventListener = null;
    }

    // Remove visibility/focus/online listeners
    if (
      this.boundHandleVisibilityChange &&
      typeof document !== 'undefined' &&
      typeof document.removeEventListener === 'function'
    ) {
      document.removeEventListener(
        'visibilitychange',
        this.boundHandleVisibilityChange
      );
      this.boundHandleVisibilityChange = null;
    }
    if (
      typeof window !== 'undefined' &&
      typeof window.removeEventListener === 'function'
    ) {
      if (this.boundHandleFocus) {
        window.removeEventListener('focus', this.boundHandleFocus);
        this.boundHandleFocus = null;
      }
      if (this.boundHandleOnline) {
        window.removeEventListener('online', this.boundHandleOnline);
        this.boundHandleOnline = null;
      }
    }

    // Clear session expiration timer
    this.clearSessionExpirationTimer();

    // Clear all event listeners
    this.authStateChangeListeners = [];
    this.eventListeners.clear();
  }

  /**
   * Starts automatic token refresh scheduling.
   * Re-enables the session expiration timer and triggers an immediate refresh
   * if the current access token is expired or near-expiry.
   *
   * Only meaningful when `autoRefreshToken` is `false` — gives the consumer
   * manual control over the refresh cycle. When `autoRefreshToken` is `true`
   * (default), this is a no-op.
   *
   * @example React Native AppState integration
   * ```typescript
   * AppState.addEventListener('change', (state) => {
   *   state === 'active' ? auth.startAutoRefresh() : auth.stopAutoRefresh();
   * });
   * ```
   */
  public async startAutoRefresh(): Promise<void> {
    if (this.autoRefreshToken) return; // auto-refresh already managed
    await this.ensureInitialized();
    // Enable scheduling for the manual lifecycle.
    this.manualRefreshActive = true;

    if (this.internalSession?.expiresAt) {
      const expiresAt = new Date(this.internalSession.expiresAt);
      const isExpired = expiresAt < new Date();

      if (isExpired && this.refreshToken) {
        // Token expired while backgrounded — refresh immediately
        try {
          await this.refreshSession();
        } catch {
          // Refresh failed — consumer can handle via session change listener
        }
      } else if (!isExpired) {
        this.scheduleSessionExpiration(expiresAt);
      }
    }
  }

  /**
   * Stops automatic token refresh scheduling.
   * Cancels any pending session expiration timer so no automatic refresh occurs
   * until `startAutoRefresh()` is called again.
   *
   * Only meaningful when `autoRefreshToken` is `false`. When `autoRefreshToken`
   * is `true` (default), this is a no-op.
   */
  public stopAutoRefresh(): void {
    if (this.autoRefreshToken) return; // auto-refresh already managed
    this.manualRefreshActive = false;
    this.clearSessionExpirationTimer();
  }

  // ========================================
  // PRD-Aligned Event Listener: onSessionChange
  // ========================================

  /**
   * Primary event listener for session changes (PRD-aligned method name).
   * Fires on: SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED, USER_UPDATED, etc.
   * @param callback - Function called with session or null
   * @returns Cleanup function to unsubscribe
   */
  public onSessionChange(
    callback: (session: OpaqueSession | null) => void
  ): () => void {
    this.authStateChangeListeners.push(callback);
    callback(this.internalSession ? this._getSessionSync() : null);
    return () => {
      this.authStateChangeListeners = this.authStateChangeListeners.filter(
        (l) => l !== callback
      );
    };
  }

  /**
   * Internal method to notify all registered listeners about session changes.
   * @param session - The new session or null if the user is logged out.
   */
  protected emitAuthStateChange(session: OpaqueSession | null): void {
    this.authStateChangeListeners.forEach((listener) => listener(session));
  }

  private emitAuthEvent(event: AuthEvent): void {
    const session = this.internalSession
      ? this._getSessionSync()
      : { user: null, isAuthenticated: false, isAnonymous: false };
    // Events that change authentication state trigger onSessionChange callbacks
    if (
      event === 'AUTH_LOGIN' ||
      event === 'AUTH_LOGOUT' ||
      event === 'AUTH_SESSION_EXPIRED' ||
      event === 'AUTH_REFRESH'
    ) {
      this.emitAuthStateChange(session);
    }
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach((fn) => fn(session));
    }
  }

  private emitPersistedAuthEvent(event: AuthEvent, persisted: boolean): void {
    const previous = this.skipPersistenceOnChange;
    this.skipPersistenceOnChange = persisted;
    try {
      this.emitAuthEvent(event);
    } finally {
      this.skipPersistenceOnChange = previous;
    }
  }

  /**
   * Subscribes to a specific authentication event.
   *
   * @param event - The auth event to listen for (e.g. `AUTH_LOGIN`, `AUTH_LOGOUT`, `AUTH_REFRESH`).
   * @param handler - Callback invoked with the current session when the event fires.
   * @returns A cleanup function that unsubscribes the handler.
   */
  public on(
    event: AuthEvent,
    handler: (session: OpaqueSession) => void
  ): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(handler);
    if (event === 'AUTH_LOGIN' && this.internalSession) {
      handler(this._getSessionSync());
    }
    return () => {
      this.eventListeners.get(event)?.delete(handler);
    };
  }

  private async clearInternalSession(): Promise<void> {
    this.internalSession = null;
    this.accessToken = null;
    this.refreshToken = null;
    this.clearSessionExpirationTimer();
    await this.clearSessionFromStorage();
    this.emitAuthEvent('AUTH_LOGOUT');
  }

  /**
   * Schedules session expiration timer based on expiresAt in session.
   * When access token expires, automatically refreshes if refresh token exists.
   * Otherwise, emits AUTH_SESSION_EXPIRED event and clears session.
   */
  private scheduleSessionExpiration(expiresAt: Date): void {
    // Schedule only when auto-refresh is on, or manual scheduling was enabled
    // via startAutoRefresh(). Keeps `autoRefreshToken: false` an opt-out for the
    // automatic paths (signIn, restore, post-refresh).
    if (!this.autoRefreshToken && !this.manualRefreshActive) return;
    this.clearSessionExpirationTimer();
    const now = new Date();
    const expiresIn = expiresAt.getTime() - now.getTime();
    // setTimeout overflows beyond a signed 32-bit delay. Re-arm long-lived
    // sessions rather than expiring or refreshing them immediately.
    if (expiresIn > 2_147_483_647) {
      this.sessionExpirationTimer = setTimeout(
        () => this.scheduleSessionExpiration(expiresAt),
        2_147_483_647
      );
      return;
    }
    if (expiresIn > 0) {
      this.sessionExpirationTimer = setTimeout(async () => {
        // If we have a refresh token, attempt automatic refresh
        if (this._hasRefreshTokenSync()) {
          try {
            await this.refreshSession();
            // Refresh successful, new timer scheduled automatically
          } catch {
            // _doRefresh() already handles fatal errors (401) by emitting
            // AUTH_SESSION_EXPIRED + AUTH_LOGOUT and clearing the session.
            // Transient errors (network, 5xx) are left alone for retry.
          }
        } else {
          // No refresh token, clear session
          this.emitAuthEvent('AUTH_SESSION_EXPIRED');
          await this.clearInternalSession();
        }
      }, expiresIn);
    } else {
      // Already expired - emit event but don't clear if we have refresh token
      // The 401 interceptor will handle refresh on next API call
      this.emitAuthEvent('AUTH_SESSION_EXPIRED');
      if (!this._hasRefreshTokenSync()) {
        void this.clearInternalSession();
      }
    }
  }

  /**
   * Checks whether the access token is expired or about to expire and
   * proactively refreshes the session if a refresh token is available.
   *
   * Called by visibilitychange, focus, and online event handlers so that
   * a tab returning from the background gets a fresh AT before any API
   * call is attempted. The existing `refreshInFlight` promise lock in
   * `refreshSession()` prevents concurrent refresh requests.
   */
  private checkAndRefreshIfNeeded(): void {
    if (!this.internalSession?.expiresAt || !this.hasRefreshToken()) {
      return;
    }

    const expiresAt = new Date(this.internalSession.expiresAt).getTime();
    const now = Date.now();

    if (expiresAt - now < Auth.REFRESH_SKEW_MS) {
      this.fireAndForgetRefresh('tab-wake');
    }
  }

  /**
   * Kicks off a refresh without awaiting. Expected failures (AuthError) are
   * logged at debug level; unexpected errors at warn level for diagnostics.
   * Only error codes and type names are logged — no tokens or PII.
   */
  private fireAndForgetRefresh(reason: string): void {
    this.refreshSession().catch((error) => {
      if (error instanceof AuthError) {
        console.debug(`Proactive refresh (${reason}): ${error.code}`);
      } else {
        console.warn(
          `Unexpected proactive refresh error (${reason}):`,
          error instanceof Error ? error.name : 'unknown'
        );
      }
    });
  }

  /**
   * Clears any active session expiration timer.
   */
  private clearSessionExpirationTimer(): void {
    if (this.sessionExpirationTimer) {
      clearTimeout(this.sessionExpirationTimer);
      this.sessionExpirationTimer = null;
    }
  }

  /**
   * Validates an access token by verifying its signature, expiry, sub, and aud claims.
   * Uses the JWKS endpoint to fetch public keys for signature verification.
   *
   * @param token - The JWT access token to validate
   * @returns True if the token is valid, false otherwise
   */
  private async validateAccessToken(token: string): Promise<boolean> {
    try {
      // Parse JWT structure
      const parts = token.split('.');
      if (parts.length !== 3) {
        console.warn('Invalid JWT structure: expected 3 parts');
        return false;
      }

      const [headerB64, payloadB64, signatureB64] = parts;

      // Decode header and payload
      const header = this.base64UrlDecode(headerB64);
      const payload = this.base64UrlDecode(payloadB64);

      const headerObj = JSON.parse(header) as {
        alg?: string;
        kid?: string;
        typ?: string;
      };
      const payloadObj = JSON.parse(payload) as {
        sub?: string;
        exp?: number;
        aud?: string | string[];
        iss?: string;
      };

      // Validate expiry
      if (!payloadObj.exp) {
        console.warn('Token missing exp claim');
        return false;
      }
      const now = Math.floor(Date.now() / 1000);
      if (payloadObj.exp < now) {
        console.warn('Token expired');
        return false;
      }

      // Validate sub (subject) claim exists
      if (!payloadObj.sub) {
        console.warn('Token missing sub claim');
        return false;
      }

      // Validate aud (audience) claim exists
      if (!payloadObj.aud) {
        console.warn('Token missing aud claim');
        return false;
      }

      // Verify signature using JWKS
      const jwks = await this.getJwks();
      const kid = headerObj.kid;
      const alg = headerObj.alg;

      if (!alg || !kid) {
        console.warn('Token missing alg or kid in header');
        return false;
      }

      // Find the matching public key.
      // Fall back to kid-only match when key omits alg (Entra JWKS, RFC 7517 §4.4).
      const key = jwks.keys.find(
        (k) => k.kid === kid && (k.alg === alg || !k.alg)
      );
      if (!key) {
        console.warn(
          `No matching key found for kid=${kid}, alg=${alg} in JWKS`
        );
        return false;
      }

      // Verify signature using Web Crypto API
      const isSignatureValid = await this.verifyJwtSignature(
        `${headerB64}.${payloadB64}`,
        signatureB64,
        key,
        alg
      );

      if (!isSignatureValid) {
        console.warn('JWT signature verification failed');
        return false;
      }

      // All validations passed
      return true;
    } catch (error) {
      console.error('Error validating access token:', error);
      return false;
    }
  }

  /**
   * Verifies JWT signature using Web Crypto API.
   * Supports ES256 (ECDSA with P-256 and SHA-256).
   */
  private async verifyJwtSignature(
    data: string,
    signatureB64: string,
    key: JsonWebKey,
    alg: string
  ): Promise<boolean> {
    try {
      // Support ES256 (ECDSA) and RS256/RS384/RS512 (RSA)
      if (alg.startsWith('ES')) {
        return this.verifyEcdsaSignature(data, signatureB64, key, alg);
      } else if (alg.startsWith('RS')) {
        return this.verifyRsaSignature(data, signatureB64, key, alg);
      } else {
        console.warn(`Unsupported algorithm: ${alg}`);
        return false;
      }
    } catch (error) {
      console.error('Error verifying JWT signature:', error);
      return false;
    }
  }

  /**
   * Verifies ECDSA signature (ES256/ES384/ES512).
   */
  private async verifyEcdsaSignature(
    data: string,
    signatureB64: string,
    key: JsonWebKey,
    alg: string
  ): Promise<boolean> {
    if (!key.x || !key.y || !key.crv) {
      console.warn('EC key missing x, y, or crv parameters');
      return false;
    }

    // Map algorithm to curve and hash
    const algConfig: Record<string, { curve: string; hash: string }> = {
      ES256: { curve: 'P-256', hash: 'SHA-256' },
      ES384: { curve: 'P-384', hash: 'SHA-384' },
      ES512: { curve: 'P-521', hash: 'SHA-512' },
    };

    const config = algConfig[alg];
    if (!config) {
      console.warn(`Unsupported ECDSA algorithm: ${alg}`);
      return false;
    }

    if (key.crv !== config.curve) {
      console.warn(`Curve mismatch: expected ${config.curve}, got ${key.crv}`);
      return false;
    }

    // Import the EC public key
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      {
        kty: 'EC',
        crv: config.curve,
        x: key.x,
        y: key.y,
        ext: true,
      },
      {
        name: 'ECDSA',
        namedCurve: config.curve,
      },
      false,
      ['verify']
    );

    // Decode signature from base64url
    const signature = this.base64UrlDecodeToArrayBuffer(signatureB64);
    const dataBuffer = new TextEncoder().encode(data);

    // Verify signature
    const isValid = await crypto.subtle.verify(
      {
        name: 'ECDSA',
        hash: config.hash,
      },
      publicKey,
      signature,
      dataBuffer
    );

    return isValid;
  }

  /**
   * Verifies RSA signature (RS256/RS384/RS512).
   */
  private async verifyRsaSignature(
    data: string,
    signatureB64: string,
    key: JsonWebKey,
    alg: string
  ): Promise<boolean> {
    if (!key.n || !key.e) {
      console.warn('RSA key missing n or e parameters');
      return false;
    }

    // Map algorithm to hash
    const hashMap: Record<string, string> = {
      RS256: 'SHA-256',
      RS384: 'SHA-384',
      RS512: 'SHA-512',
    };

    const hash = hashMap[alg];
    if (!hash) {
      console.warn(`Unsupported RSA algorithm: ${alg}`);
      return false;
    }

    // Import the RSA public key
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      {
        kty: 'RSA',
        n: key.n,
        e: key.e,
        ext: true,
      },
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: hash,
      },
      false,
      ['verify']
    );

    // Decode signature from base64url
    const signature = this.base64UrlDecodeToArrayBuffer(signatureB64);
    const dataBuffer = new TextEncoder().encode(data);

    // Verify signature
    const isValid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      signature,
      dataBuffer
    );

    return isValid;
  }

  /**
   * Decodes a base64url-encoded string to a UTF-8 string.
   */
  private base64UrlDecode(base64Url: string): string {
    // Convert base64url to base64
    let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    // Pad with '=' to make length a multiple of 4
    while (base64.length % 4 !== 0) {
      base64 += '=';
    }

    // Decode base64
    if (typeof globalThis.atob === 'function') {
      return globalThis.atob(base64);
    } else if (
      typeof (globalThis as any).Buffer !== 'undefined' &&
      typeof (globalThis as any).Buffer.from === 'function'
    ) {
      return (globalThis as any).Buffer.from(base64, 'base64').toString(
        'utf-8'
      );
    } else {
      throw new Error('No base64 decode method available');
    }
  }

  /**
   * Decodes a base64url-encoded string to an ArrayBuffer.
   */
  private base64UrlDecodeToArrayBuffer(base64Url: string): ArrayBuffer {
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const binaryString = globalThis.atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Decodes a JWT access token payload and returns the parsed claims object.
   *
   * @param token - The JWT access token in format: header.payload.signature
   * @returns The parsed payload object, or null if decoding fails
   * @internal
   */
  private decodeTokenPayload(token: string): Record<string, any> | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        return null;
      }

      const payload = parts[1];
      const decodedString = this.base64UrlDecode(payload);
      return JSON.parse(decodedString);
    } catch {
      return null;
    }
  }

  /**
   * Extracts the user ID from a JWT access token by decoding the payload.
   *
   * Handles two token formats:
   * - Standard: `sub` contains the user ID directly.
   * - Managed hosting: `sub` contains a hierarchical path ending with `/users/{userId}`;
   *   the last segment is extracted as the user ID.
   *
   * @param token - The JWT access token in format: header.payload.signature
   * @returns The user ID, or 'unknown' if extraction fails
   * @internal
   */
  private extractUserIdFromToken(token: string): string {
    const payload = this.decodeTokenPayload(token);
    if (!payload) return 'unknown';

    const sub = payload.sub as string | undefined;
    if (!sub) return 'unknown';

    // Managed hosting token: sub is a hierarchical path, userId is the last segment
    if (payload.idtyp === 'fmi' || sub.includes('/users/')) {
      const segments = sub.split('/').filter(Boolean);
      return segments.length > 0 ? segments[segments.length - 1] : 'unknown';
    }

    // Standard token: sub is the userId directly
    return sub;
  }

  protected async getInternalSessionFromStorage(): Promise<Session | null> {
    if (this.storage && this.persistSession) {
      const sessionData = await this.storage.getItem(this.AUTH_TOKEN_KEY);
      if (sessionData) {
        return JSON.parse(sessionData);
      }
    }
    return null;
  }

  protected async setInternalSessionToStorage(session: Session): Promise<void> {
    if (this.storage && this.persistSession && session) {
      const serialized = JSON.stringify(session);
      // Skip unchanged writes to prevent cross-tab storage event loops.
      if ((await this.storage.getItem(this.AUTH_TOKEN_KEY)) !== serialized) {
        await this.storage.setItem(this.AUTH_TOKEN_KEY, serialized);
      }
    }
  }

  protected async clearSessionFromStorage(): Promise<void> {
    if (this.storage && this.persistSession) {
      await this.storage.removeItem(this.AUTH_TOKEN_KEY);
    }
  }

  /**
   * Verifies a user's email address with a verification token.
   *
   * This method is called after a user clicks the verification link in their email.
   * Upon success, the user's email is marked as verified. The user must then sign in
   * to obtain an access token.
   *
   * Emits `AUTH_EMAIL_VERIFIED` event on success.
   *
   * @param token - The verification token from the email link.
   * @returns A promise that resolves with the verification response.
   * @throws `AuthError` - If the token is invalid, expired, or already used.
   * @throws `NetworkError` - For network-related issues.
   * @throws `SdkError` - For any other unexpected SDK errors.
   *
   * @example
   * ```typescript
   * // Listen for email verification events
   * auth.on('AUTH_EMAIL_VERIFIED', () => {
   *   console.log('Email verified! You can now sign in.');
   * });
   *
   * // Extract token from URL query parameter
   * const urlParams = new URLSearchParams(window.location.search);
   * const token = urlParams.get('token');
   *
   * if (token) {
   *   try {
   *     const result = await auth.verifyEmail(token);
   *     console.log(result.message); // "Email verified successfully!"
   *   } catch (error) {
   *     console.error('Verification failed:', error.message);
   *   }
   * }
   * ```
   */
  public async verifyEmail(token: string): Promise<EmailVerificationResponse> {
    await this.ensureInitialized();
    if (!token) {
      throw new AuthError('Verification token is required.', 'MISSING_TOKEN');
    }

    try {
      const response = await this.authApi.verifyEmail(token);

      // Emit verification event for tracking
      this.emitAuthEvent('AUTH_EMAIL_VERIFIED');

      return response;
    } catch (error: any) {
      // Re-throw specific SDK errors
      if (
        error instanceof AuthError ||
        error instanceof NetworkError ||
        error instanceof SdkError
      ) {
        throw error;
      }
      throw new SdkError(
        `An unexpected error occurred during email verification: ${error.message || error}`,
        'UNKNOWN_VERIFICATION_ERROR'
      );
    }
  }

  /**
   * Resends the email verification link to the specified email address.
   *
   * This allows users to request a new verification email if they didn't receive
   * the original or if it expired. Previous unused verification tokens are automatically
   * invalidated when a new one is generated. For security, always returns success
   * to prevent email enumeration attacks.
   *
   * Emits `AUTH_VERIFICATION_EMAIL_RESENT` event on success.
   *
   * @param email - The email address to resend the verification link to.
   * @returns A promise that resolves with a success message.
   * @throws `AuthError` - If the email is invalid.
   * @throws `NetworkError` - For network-related issues.
   * @throws `SdkError` - For any other unexpected SDK errors.
   *
   * @example
   * ```typescript
   * // Listen for resend events
   * auth.on('AUTH_VERIFICATION_EMAIL_RESENT', () => {
   *   console.log('Verification email resent!');
   * });
   *
   * try {
   *   const result = await auth.resendVerificationEmail('user@example.com');
   *   console.log(result.message);
   * } catch (error) {
   *   console.error('Resend failed:', error.message);
   * }
   * ```
   */
  public async resendVerificationEmail(
    email: string
  ): Promise<ResendVerificationEmailResponse> {
    await this.ensureInitialized();
    if (!email) {
      throw new AuthError(
        'Email is required to resend verification.',
        'MISSING_EMAIL'
      );
    }

    try {
      const response = await this.authApi.resendVerificationEmail({ email });

      // Emit event for tracking
      this.emitAuthEvent('AUTH_VERIFICATION_EMAIL_RESENT');

      return response;
    } catch (error: any) {
      // Re-throw specific SDK errors
      if (error instanceof AuthError || error instanceof NetworkError) {
        throw error;
      }

      // Wrap unknown errors
      throw new SdkError(
        `An unexpected error occurred while resending verification email: ${error.message || error}`,
        'UNKNOWN_RESEND_ERROR'
      );
    }
  }

  /**
   * Requests a password reset email for the specified email address.
   *
   * This initiates the password reset flow. If an account exists with the provided
   * email, a reset link will be sent to that address. For security, always returns
   * success to prevent email enumeration attacks.
   *
   * Emits `AUTH_PASSWORD_RESET_REQUESTED` event on success.
   *
   * @param email - The email address to send the reset link to.
   * @returns A promise that resolves with a success message.
   * @throws `AuthError` - If the email is invalid.
   * @throws `NetworkError` - For network-related issues.
   * @throws `SdkError` - For any other unexpected SDK errors.
   *
   * @example
   * ```typescript
   * // Listen for password reset events
   * auth.on('AUTH_PASSWORD_RESET_REQUESTED', () => {
   *   console.log('Password reset email sent!');
   * });
   *
   * try {
   *   const result = await auth.requestPasswordReset('user@example.com');
   *   console.log(result.message);
   * } catch (error) {
   *   console.error('Reset request failed:', error.message);
   * }
   * ```
   */
  public async requestPasswordReset(
    email: string
  ): Promise<PasswordResetResponse> {
    await this.ensureInitialized();
    if (!email) {
      throw new AuthError(
        'Email is required for password reset.',
        'MISSING_EMAIL'
      );
    }

    try {
      const response = await this.authApi.requestPasswordReset({ email });

      // Emit event for tracking
      this.emitAuthEvent('AUTH_PASSWORD_RESET_REQUESTED');

      return response;
    } catch (error: any) {
      // Re-throw specific SDK errors
      if (
        error instanceof AuthError ||
        error instanceof NetworkError ||
        error instanceof SdkError
      ) {
        throw error;
      }
      throw new SdkError(
        `An unexpected error occurred during password reset request: ${error.message || error}`,
        'UNKNOWN_PASSWORD_RESET_ERROR'
      );
    }
  }

  /**
   * Completes the password reset process with a reset token and new password.
   *
   * This method is called after a user clicks the reset link in their email and
   * submits a new password. Upon success, all existing sessions are invalidated
   * for security and the user must sign in with the new password.
   *
   * Emits `AUTH_PASSWORD_RESET_COMPLETED` event on success.
   *
   * @param token - The reset token from the email link.
   * @param newPassword - The new password to set.
   * @returns A promise that resolves with a success message.
   * @throws `AuthError` - If the token is invalid, expired, already used, or password is too short.
   * @throws `NetworkError` - For network-related issues.
   * @throws `SdkError` - For any other unexpected SDK errors.
   *
   * @example
   * ```typescript
   * // Listen for password reset completion events
   * auth.on('AUTH_PASSWORD_RESET_COMPLETED', () => {
   *   console.log('Password reset complete! Please sign in with new password.');
   * });
   *
   * // Extract token from URL query parameter
   * const urlParams = new URLSearchParams(window.location.search);
   * const token = urlParams.get('token');
   *
   * if (token) {
   *   try {
   *     const result = await auth.completePasswordReset(token, 'newSecurePassword123');
   *     console.log(result.message); // "Password updated successfully."
   *   } catch (error) {
   *     console.error('Password reset failed:', error.message);
   *   }
   * }
   * ```
   */
  public async completePasswordReset(
    token: string,
    newPassword: string
  ): Promise<PasswordResetResponse> {
    await this.ensureInitialized();
    if (!token) {
      throw new AuthError('Reset token is required.', 'MISSING_TOKEN');
    }
    if (!newPassword) {
      throw new AuthError('New password is required.', 'MISSING_PASSWORD');
    }
    if (newPassword.length < 6) {
      throw new AuthError(
        'Password must be at least 6 characters long.',
        'PASSWORD_TOO_SHORT'
      );
    }

    try {
      const response = await this.authApi.completePasswordReset({
        token,
        newPassword,
      });

      // Emit event for tracking
      this.emitAuthEvent('AUTH_PASSWORD_RESET_COMPLETED');

      return response;
    } catch (error: any) {
      // Re-throw specific SDK errors
      if (
        error instanceof AuthError ||
        error instanceof NetworkError ||
        error instanceof SdkError
      ) {
        throw error;
      }
      throw new SdkError(
        `An unexpected error occurred completing password reset: ${error.message || error}`,
        'UNKNOWN_PASSWORD_RESET_COMPLETION_ERROR'
      );
    }
  }

  // ========================================
  // Magic Link / Passwordless Authentication
  // ========================================

  /**
   * Initiates a magic link authentication flow.
   *
   * This method generates PKCE parameters, stores the code verifier in localStorage,
   * and sends a magic link email to the specified address. When the user clicks the link,
   * they will be redirected to your application with a verification code and state parameter.
   *
   * Use `handleMagicLinkCallback()` to complete the authentication when the user returns.
   *
   * Emits `AUTH_MAGIC_LINK_SENT` event on success, `AUTH_MAGIC_LINK_ERROR` on failure.
   *
   * @param options - The magic link options (email and redirectUri).
   * @returns A promise that resolves with the result containing the state parameter.
   * @throws `AuthError` - If email or redirectUri is missing, or if localStorage is unavailable.
   * @throws `NetworkError` - For network-related issues.
   *
   * @example
   * ```typescript
   * // Listen for magic link events
   * auth.on('AUTH_MAGIC_LINK_SENT', () => {
   *   console.log('Magic link sent! Check your email.');
   * });
   *
   * try {
   *   const result = await auth.sendMagicLink({
   *     email: 'user@example.com',
   *     redirectUri: 'https://myapp.com/auth/callback'
   *   });
   *   console.log('State:', result.state); // Stored for callback correlation
   * } catch (error) {
   *   console.error('Failed to send magic link:', error.message);
   * }
   * ```
   */
  public async sendMagicLink(
    options: MagicLinkOptions
  ): Promise<MagicLinkResult> {
    await this.ensureInitialized();
    // Validate required parameters
    if (!options.email) {
      throw new AuthError('Email is required for magic link.', 'MISSING_EMAIL');
    }
    if (!options.redirectUri) {
      throw new AuthError(
        'Redirect URI is required for magic link.',
        'MISSING_REDIRECT_URI'
      );
    }

    try {
      // Generate PKCE parameters
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = await generateCodeChallenge(codeVerifier);
      const state = generateState();

      // Store PKCE state via configured storage (or in-memory fallback)
      const pkceState: PkceState = {
        codeVerifier,
        redirectUri: options.redirectUri,
        createdAt: Date.now(),
      };
      await this.pkceSet(
        `${this.PKCE_STATE_PREFIX}${state}`,
        JSON.stringify(pkceState)
      );

      // Send magic link request
      const response = await this.authApi.sendMagicLink({
        email: options.email,
        codeChallenge,
        state,
        redirectUri: options.redirectUri,
      });

      // Emit success event
      this.emitAuthEvent('AUTH_MAGIC_LINK_SENT');

      return {
        success: response.success,
        state,
        message: response.message,
      };
    } catch (error: any) {
      // Emit error event
      this.emitAuthEvent('AUTH_MAGIC_LINK_ERROR');

      // Re-throw specific SDK errors
      if (
        error instanceof AuthError ||
        error instanceof NetworkError ||
        error instanceof SdkError
      ) {
        throw error;
      }
      throw new SdkError(
        `An unexpected error occurred sending magic link: ${error.message || error}`,
        'UNKNOWN_MAGIC_LINK_ERROR'
      );
    }
  }

  /**
   * Handles the callback from a magic link authentication flow.
   *
   * This method extracts the verification code and state from the URL,
   * retrieves the stored PKCE verifier, and exchanges the code for tokens.
   * On success, a session is created and the user is authenticated.
   *
   * Emits `AUTH_LOGIN` on success.
   *
   * @param url - Optional URL to parse. Defaults to window.location.href.
   * @returns A promise that resolves with the callback result.
   *
   * @example
   * ```typescript
   * // In your callback page/route
   * const result = await auth.handleMagicLinkCallback();
   * if (result.success) {
   *   console.log('Authenticated!', result.session);
   *   // Redirect to app
   * } else {
   *   console.error('Authentication failed:', result.error);
   *   // Show error message
   * }
   * ```
   */
  public async handleMagicLinkCallback(
    url?: string
  ): Promise<MagicLinkCallbackResult> {
    await this.ensureInitialized();
    // Use provided URL or current window location
    const callbackUrl =
      url || (typeof window !== 'undefined' ? window.location.href : '');

    if (!callbackUrl) {
      return {
        success: false,
        error: 'No URL available to parse.',
        errorCode: 'NO_URL',
      };
    }

    try {
      // Parse URL parameters
      const urlObj = new URL(callbackUrl);
      const verificationCode = urlObj.searchParams.get('verification_code');
      const state = urlObj.searchParams.get('state');
      const errorParam = urlObj.searchParams.get('error');

      // Check for error response from server
      if (errorParam) {
        const errorDescription =
          urlObj.searchParams.get('error_description') || 'Unknown error';
        return {
          success: false,
          error: errorDescription,
          errorCode: errorParam,
        };
      }

      // Validate required parameters
      if (!verificationCode) {
        return {
          success: false,
          error: 'Missing verification code in callback URL.',
          errorCode: 'MISSING_VERIFICATION_CODE',
        };
      }

      if (!state) {
        return {
          success: false,
          error: 'Missing state parameter in callback URL.',
          errorCode: 'MISSING_STATE',
        };
      }

      // Retrieve PKCE state from configured storage (or in-memory fallback)
      const pkceKey = `${this.PKCE_STATE_PREFIX}${state}`;
      const storedStateJson = await this.pkceGet(pkceKey);

      if (!storedStateJson) {
        return {
          success: false,
          error:
            'Magic link state not found. This may happen if you opened the link in a different browser or device, or if the browser data was cleared.',
          errorCode: 'STATE_NOT_FOUND',
        };
      }

      // Parse stored PKCE state
      let pkceState: PkceState;
      try {
        pkceState = JSON.parse(storedStateJson);
      } catch {
        // Clean up invalid data
        await this.pkceRemove(pkceKey);
        return {
          success: false,
          error: 'Invalid PKCE state data.',
          errorCode: 'INVALID_PKCE_STATE',
        };
      }

      // Check if PKCE state has expired (max 30 minutes)
      if (Date.now() - pkceState.createdAt > Auth.PKCE_STATE_MAX_AGE_MS) {
        await this.pkceRemove(pkceKey);
        return {
          success: false,
          error:
            'Magic link session has expired. Please request a new magic link.',
          errorCode: 'PKCE_STATE_EXPIRED',
        };
      }

      // Clean up PKCE state from storage (regardless of exchange outcome)
      await this.pkceRemove(pkceKey);

      // Exchange verification code for tokens
      const response = await this.authApi.exchangeVerificationCode({
        verificationCode,
        codeVerifier: pkceState.codeVerifier,
        redirectUri: pkceState.redirectUri,
      });

      if (response.accessToken) {
        // Calculate expiresAt from expiresIn (seconds)
        const expiresAt = new Date(Date.now() + response.expiresIn * 1000);

        // Decode JWT to extract user ID and email from claims
        const userId = this.extractUserIdFromToken(response.accessToken);
        const email = this.extractEmailFromToken(response.accessToken);

        this.internalSession = {
          user: { id: userId, email },
          accessToken: response.accessToken,
          refreshToken: response.refreshToken ?? null,
          expiresAt,
        };
        this.accessToken = response.accessToken;
        this.refreshToken = response.refreshToken ?? null;
        this.lastRefreshFailure = null;

        // Schedule session expiration timer
        this.scheduleSessionExpiration(expiresAt);

        this.emitAuthEvent('AUTH_LOGIN');

        return {
          success: true,
          session: this._getSessionSync(),
        };
      }

      return {
        success: false,
        error: 'No access token received from server.',
        errorCode: 'NO_ACCESS_TOKEN',
      };
    } catch (error: any) {
      // Handle specific error types
      if (error instanceof AuthError) {
        return {
          success: false,
          error: error.message,
          errorCode: error.code,
        };
      }
      if (error instanceof NetworkError) {
        return {
          success: false,
          error: `Network error: ${error.message}`,
          errorCode: 'NETWORK_ERROR',
        };
      }

      return {
        success: false,
        error: error.message || 'An unexpected error occurred.',
        errorCode: 'UNKNOWN_ERROR',
      };
    }
  }

  /**
   * Checks if the current URL appears to be a magic link callback.
   *
   * This is a quick check to determine if the current page load is from
   * a magic link click. Use `handleMagicLinkCallback()` to actually process it.
   *
   * @param url - Optional URL to check. Defaults to window.location.href.
   * @returns True if the URL contains magic link callback parameters.
   *
   * @example
   * ```typescript
   * // On app initialization
   * if (auth.isMagicLinkCallback()) {
   *   const result = await auth.handleMagicLinkCallback();
   *   // Handle result...
   * }
   * ```
   */
  public isMagicLinkCallback(url?: string): boolean {
    try {
      const checkUrl =
        url || (typeof window !== 'undefined' ? window.location.href : '');
      if (!checkUrl) return false;

      const urlObj = new URL(checkUrl);
      const hasVerificationCode = urlObj.searchParams.has('verification_code');
      const hasState = urlObj.searchParams.has('state');

      return hasVerificationCode && hasState;
    } catch {
      return false;
    }
  }

  /**
   * Extracts the verification code from a magic link callback URL.
   *
   * @param url - Optional URL to parse. Defaults to window.location.href.
   * @returns The verification code or null if not present.
   */
  public getMagicLinkVerificationCode(url?: string): string | null {
    try {
      const parseUrl =
        url || (typeof window !== 'undefined' ? window.location.href : '');
      if (!parseUrl) return null;

      const urlObj = new URL(parseUrl);
      return urlObj.searchParams.get('verification_code');
    } catch {
      return null;
    }
  }

  /**
   * Extracts the email from a JWT access token by decoding the payload.
   *
   * Handles two token formats:
   * - Standard: reads top-level `email` claim.
   * - Managed hosting: `email` is nested in `xms_attr.{appId}.rfn_email`.
   *
   * @param token - The JWT access token
   * @returns The email from the token, or 'unknown' if extraction fails
   * @internal
   */
  private extractEmailFromToken(token: string): string {
    const payload = this.decodeTokenPayload(token);
    if (!payload) return 'unknown';

    // Standard token: top-level email claim
    if (payload.email) return payload.email as string;

    // Managed hosting token: email in xms_attr.{appId}.rfn_email
    if (payload.xms_attr && typeof payload.xms_attr === 'object') {
      const appKeys = Object.keys(
        payload.xms_attr as Record<string, Record<string, string>>
      );
      if (appKeys.length > 0) {
        const attrs = (
          payload.xms_attr as Record<string, Record<string, string>>
        )[appKeys[0]];
        if (attrs?.rfn_email) return attrs.rfn_email;
      }
    }

    return 'unknown';
  }
}
