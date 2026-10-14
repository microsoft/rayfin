import { deprecate } from './deprecation.js';
import {
  AuthError,
  NetworkError,
  SdkError,
  type WorkloadFailure,
} from './errors.js';
import {
  ARTIFACT_BLOCKED_CODE,
  ARTIFACT_BLOCKED_MESSAGE,
  artifactBlockDetails,
  readForbiddenResponse,
  type ArtifactBlockDetails,
} from './forbiddenResponse';

const responseAuthErrors = new WeakMap<SdkError, ArtifactBlockDetails>();

/**
 * Interface for API Client configuration.
 * Includes an optional function to retrieve the access token dynamically.
 */
export interface ApiClientConfig {
  /**
   * Base URL of the Rayfin backend the client targets. Use an absolute URL
   * (for example, the deployed Fabric item URL) to call a backend directly, or
   * an empty string (`''`) to keep requests same-origin so a dev-server proxy
   * can forward them.
   */
  baseUrl: string;
  /** Publishable key used for service-level authentication. Required. */
  publishableKey: string;
  /**
   * Optional override for the functions invocation host. When set, function
   * invocations (`client.functions.<name>.invoke(...)`) are routed to
   * `${functionsBaseUrl}/api/<name>` (Azure Functions Core Tools convention)
   * instead of the default `${baseUrl}/functions/<name>/invoke` path that
   * goes through the Fabric `InvokeController`. Set this in local-debug
   * scenarios (e.g. from `import.meta.env.VITE_RAYFIN_FUNCTIONS_URL`) to
   * point the frontend at a locally-running `func start` process while
   * data calls continue to hit the deployed Fabric item via `baseUrl`.
   */
  functionsBaseUrl?: string;
  /** Default headers merged into every request. */
  headers?: Record<string, string>;
  /**
   * Explicit `x-ms-workload-resource-moniker` value (typically a resolved
   * Fabric item ID). Takes precedence over the GUID heuristically extracted
   * from `baseUrl`, so callers with an authoritative resolved item ID (e.g.
   * `RayfinClient.fromConfig()`'s resolved `runtimeConfig.itemId`) aren't at
   * the mercy of URL-shape guessing.
   */
  moniker?: string;
  /** Default request timeout in milliseconds (defaults to 30000). */
  timeout?: number;
  /** Fetch implementation to use, for example one configured with a network proxy. */
  fetch?: typeof globalThis.fetch;
  /** Returns the current access token to attach as a bearer token, or `null`. */
  getAccessToken?: () => string | null;
  /**
   * @deprecated This option no longer has any effect and will be removed in a
   * future major release. The client no longer inspects the runtime environment
   * to rewrite URLs. To route requests through a development proxy, set
   * `baseUrl` to an empty string (`''`) so requests stay same-origin, and
   * configure your dev server proxy accordingly. To call a backend directly,
   * pass its absolute URL as `baseUrl`.
   */
  useProxy?: boolean;
  /** Callback when retry after refresh also returns 401. */
  onAuthExhausted?: () => void;
  /** Invoked when a `401` response indicates the access token must be refreshed. */
  onRefreshNeeded?: () => Promise<void>;
}

/** Stable deprecation code for the `useProxy` option. */
const USE_PROXY_DEPRECATION_CODE = 'RAYFIN_DEP_USE_PROXY';

/** Human-readable explanation emitted when a consumer still passes `useProxy`. */
const USE_PROXY_DEPRECATION_MESSAGE =
  'The `useProxy` option is deprecated and no longer has any effect. ' +
  'Routing is now determined solely by `baseUrl`: use an empty string ' +
  "('') to keep requests same-origin so a dev-server proxy can forward " +
  'them, or an absolute URL to call a backend directly. Remove `useProxy` ' +
  'from your configuration; it will be removed in a future major release.';

/**
 * Request options for fetch API.
 */
export interface RequestOptions {
  /** HTTP method (defaults to the method implied by the calling helper). */
  method?: string;
  /** Per-request headers, merged over the client's default headers. */
  headers?: Record<string, string> | Headers;
  /** Raw request body. */
  body?: string | null;
  /** Per-request timeout in milliseconds, overriding the client default. */
  timeout?: number;
  /**
   * Skip automatic token refresh and retry on 401 Unauthorized.
   * Used for auth endpoints like signOut and refreshToken where 401 is an expected error.
   */
  skipRetryOn401?: boolean;
  /**
   * Controls how the response body is read.
   *
   * - `'json'` / `'text'` / omitted — the default behaviour: the body is read
   *   as text and parsed as JSON when the response `Content-Type` indicates
   *   JSON (or when an untyped body looks like JSON).
   * - `'arraybuffer'` — the caller is willing to receive raw bytes. Combined
   *   with a binary response `Content-Type` (for example an Apache Arrow IPC
   *   stream), the body is returned as an `ArrayBuffer` instead of being read
   *   as text. A JSON response is still parsed as JSON, so callers can safely
   *   request `'arraybuffer'` for endpoints that may return either format.
   */
  responseType?: 'json' | 'text' | 'arraybuffer';
  [key: string]: any;
}

/**
 * Determines if code is running in a browser environment
 */
function isBrowser(): boolean {
  return (
    typeof window !== 'undefined' && typeof window.document !== 'undefined'
  );
}

/**
 * Strips trailing '/' characters from a string without using a regex as regex is getting tagged by CodeQL.
 */
function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') {
    end--;
  }
  return value.slice(0, end);
}

/**
 * Cap on a single serialized `errors[]` entry folded into an Error message.
 * A response body has no size contract, and this text reaches logs and UI.
 */
const MAX_SERIALIZED_ERROR_ENTRY = 200;

/**
 * Structured detail from a Fabric workload failure envelope, when present.
 *
 * Extracted alongside {@link workloadErrorMessage} rather than instead of it:
 * the message is what a human reads, these fields are what code branches on.
 * Returns undefined when the body is not a workload envelope, so a caller can
 * tell "no envelope" from "envelope with empty fields".
 */
function workloadFailureDetail(body: unknown): WorkloadFailure | undefined {
  if (!body || typeof body !== 'object') return undefined;

  const envelope = body as {
    errors?: unknown;
    functionName?: unknown;
    invocationId?: unknown;
    status?: unknown;
  };
  const errors = Array.isArray(envelope.errors) ? envelope.errors : [];
  const first = errors.find(
    (entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === 'object'
  );

  const text = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined;

  const detail: WorkloadFailure = {
    errorCode: text(first?.errorCode),
    subErrorCode: text(first?.subErrorCode),
    functionName: text(envelope.functionName),
    invocationId: text(envelope.invocationId),
    status: text(envelope.status),
  };

  // Nothing recognisable: report absence rather than an object of undefineds.
  return Object.values(detail).some((value) => value !== undefined)
    ? detail
    : undefined;
}

/**
 * Pulls the readable part out of a Fabric workload failure envelope.
 *
 * A failed user-data-function invocation puts its detail in `errors[]` with no
 * top-level `message`, so without this the caller sees only `HTTP Error 500`.
 *
 * Entries are `string | Record<string, any>` on the wire, so a bare string is
 * kept verbatim and an object with none of the preferred fields is serialized
 * rather than dropped.
 *
 * @param body - Parsed error response body, of unknown shape.
 * @returns A readable summary, or `undefined` when there is nothing usable so
 *   the existing fallbacks still apply.
 */
function workloadErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const errors = (body as { errors?: unknown }).errors;
  if (!Array.isArray(errors) || errors.length === 0) return undefined;

  const parts: string[] = [];
  for (const entry of errors) {
    if (typeof entry === 'string') {
      if (entry) parts.push(entry);
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;

    const { errorCode, subErrorCode, message } = entry as Record<
      string,
      unknown
    >;
    const code = [errorCode, subErrorCode]
      .filter((value): value is string => typeof value === 'string' && !!value)
      .join('/');
    const text = typeof message === 'string' && message ? message : undefined;
    const part = [code || undefined, text].filter(Boolean).join(': ');
    if (part) {
      parts.push(part);
      continue;
    }

    // Unfamiliar shape. Serialize it rather than lose it, bounded because a
    // response body has no size contract and this ends up in an Error message.
    // Only when it carries a key outside the recognized three: an entry like
    // `{ errorCode: '' }` is recognized-but-empty and has nothing to say, so
    // serializing it would trade a clear status code for noise.
    const RECOGNIZED = ['errorCode', 'subErrorCode', 'message'];
    const keys = Object.keys(entry);
    if (!keys.some((key) => !RECOGNIZED.includes(key))) continue;
    try {
      const serialized = JSON.stringify(entry);
      if (serialized && serialized !== '{}') {
        parts.push(
          serialized.length > MAX_SERIALIZED_ERROR_ENTRY
            ? `${serialized.slice(0, MAX_SERIALIZED_ERROR_ENTRY)}…`
            : serialized
        );
      }
    } catch {
      // Serialization failed — a body deep enough to parse can still exceed the
      // stack on stringify. Nothing useful to report, and the HTTP failure must
      // not be replaced by a serialization failure.
    }
  }

  return parts.length > 0 ? parts.join('; ') : undefined;
}

/**
 * Get the appropriate fetch implementation
 * Will use native fetch if available (browser or Node.js 18+)
 * Falls back to attempting to load node-fetch in Node.js environments
 */
async function getFetch(): Promise<typeof globalThis.fetch> {
  // Browser environment or Node.js with native fetch
  if (isBrowser() || typeof globalThis.fetch === 'function') {
    return globalThis.fetch;
  }

  // Node.js without native fetch - need node-fetch
  try {
    // Try to access node-fetch through dynamic loading (works if installed)
    // This approach avoids import errors at build time
    const nodeFetchModule = await Function('return import("node-fetch")')();
    return nodeFetchModule.default;
  } catch (error) {
    throw new Error(
      'Fetch implementation not available. In Node.js < v18, install node-fetch'
    );
  }
}

/**
 * A generic HTTP client to interact with the service API.
 * Uses isomorphic fetch approach that works in both browser and Node.js environments
 * without external dependencies when native fetch is available.
 */
export class ApiClient {
  private baseUrl: string;
  private functionsBaseUrl: string | undefined;
  private publishableKey: string;
  private defaultHeaders: Record<string, string>;
  private moniker: string | undefined;
  private defaultTimeout: number;
  private getAccessTokenCallback: (() => string | null) | undefined;
  private onRefreshNeededCallback: (() => Promise<void>) | undefined;
  private refreshResponseError:
    | ((error: unknown) => AuthError | undefined)
    | undefined;
  private onAuthExhaustedCallback: (() => void) | undefined;
  private fetchImplementation: Promise<typeof globalThis.fetch>;

  /**
   * Creates a new HTTP client.
   *
   * @param config - Client configuration. A non-empty `publishableKey` is required.
   * @throws An {@link SdkError} if `publishableKey` is missing or blank.
   */
  constructor(config: ApiClientConfig) {
    // Validate required publishable key
    if (!config.publishableKey || config.publishableKey.trim() === '') {
      throw new SdkError(
        'publishableKey is required. Please provide a valid publishable key in the ApiClient configuration.'
      );
    }

    // The `useProxy` option is deprecated and no longer affects URL handling.
    // Routing is determined solely by `baseUrl`. Warn consumers still passing it.
    if (config.useProxy !== undefined) {
      deprecate(USE_PROXY_DEPRECATION_CODE, USE_PROXY_DEPRECATION_MESSAGE);
    }

    this.baseUrl = config.baseUrl;
    this.functionsBaseUrl = config.functionsBaseUrl
      ? trimTrailingSlashes(config.functionsBaseUrl)
      : undefined;
    this.publishableKey = config.publishableKey;
    this.defaultHeaders = config.headers || {};
    this.moniker = config.moniker;
    this.defaultTimeout = config.timeout || 30000; // Default to 30 seconds
    this.getAccessTokenCallback = config.getAccessToken;
    this.onRefreshNeededCallback = config.onRefreshNeeded;
    this.onAuthExhaustedCallback = config.onAuthExhausted;
    this.fetchImplementation = config.fetch
      ? Promise.resolve(config.fetch)
      : getFetch();
  }

  /**
   * Resolves a service-relative path against the configured base URL,
   * preserving the base URL's full path (unlike `new URL(path, base)`).
   * Absolute URLs are returned unchanged.
   *
   * @param path - Service-relative path (for example `/api/auth/v1/token`).
   * @returns The fully-qualified URL.
   * @internal Cross-package wiring; not part of the Builder-facing API.
   */
  public resolveUrl(path: string): string {
    return this.buildUrl(path);
  }

  /**
   * Returns the configured functions invocation host, or `undefined` when
   * functions should be invoked against the default `baseUrl`. Consumed by
   * `FunctionClient.invoke()` to switch between the local
   * `func start`-style path and the Fabric `InvokeController` path.
   *
   * @returns The functions base URL, or `undefined` to use `baseUrl`.
   * @internal
   */
  public getFunctionsBaseUrl(): string | undefined {
    return this.functionsBaseUrl;
  }

  /**
   * Sets or updates the access token callback function.
   * This allows attaching a token provider after the ApiClient has been initialized.
   * @param callback - Function that returns the current access token or null
   */
  public setAccessTokenCallback(callback: () => string | null): void {
    this.getAccessTokenCallback = callback;
  }

  /**
   * Sets or updates the refresh callback function.
   * This allows attaching a refresh handler after the ApiClient has been initialized.
   * @param callback - Function that performs token refresh
   */
  public setRefreshCallback(callback: () => Promise<void>): void {
    this.onRefreshNeededCallback = callback;
    this.refreshResponseError = undefined;
  }

  /** @internal Grants response-error mapping only to an Auth-owned refresh operation. */
  public setAuthRefreshCallback(
    callback: () => Promise<void>,
    responseError: (error: unknown) => AuthError | undefined
  ): void {
    this.setRefreshCallback(callback);
    this.refreshResponseError = responseError;
  }

  /**
   * Sets the callback invoked when a retry after refresh also returns 401.
   * @param callback - Function called when auth is exhausted
   */
  public setAuthExhaustedCallback(callback: () => void): void {
    this.onAuthExhaustedCallback = callback;
  }

  /** @internal Maps only rejections produced by SDK response parsing. */
  public getResponseAuthError(error: unknown): AuthError | undefined {
    const details =
      error instanceof SdkError ? responseAuthErrors.get(error) : undefined;
    if (!details) {
      return undefined;
    }
    const mapped = new AuthError(
      ARTIFACT_BLOCKED_MESSAGE,
      ARTIFACT_BLOCKED_CODE,
      403,
      details.requestId
    );
    responseAuthErrors.set(mapped, details);
    return mapped;
  }

  private artifactBlockedError(value: unknown): NetworkError | undefined {
    const details = artifactBlockDetails(value);
    if (!details) {
      return undefined;
    }
    const error = new NetworkError(
      ARTIFACT_BLOCKED_MESSAGE,
      403,
      ARTIFACT_BLOCKED_CODE,
      details.requestId
    );
    responseAuthErrors.set(error, details);
    return error;
  }

  private async fetchResponse(
    url: string,
    options: RequestInit
  ): Promise<Response> {
    try {
      const fetchImpl = await this.fetchImplementation;
      return await fetchImpl(url, options);
    } catch (error) {
      if (
        error instanceof SdkError &&
        (responseAuthErrors.has(error) || error.code === ARTIFACT_BLOCKED_CODE)
      ) {
        throw new NetworkError('Network request failed.');
      }
      throw error;
    }
  }

  /**
   * Prepares the request headers, including authorization if available.
   * @param additionalHeaders - Additional headers to include with the request
   * @returns Combined headers with authorization if available
   */
  /**
   * Normalizes request headers into a plain record. A Headers instance cannot
   * be spread into a plain object (its values are stored internally), so its
   * entries must be copied explicitly to avoid silently dropping headers.
   * @param headers - The headers to normalize.
   * @returns A plain record of header name/value pairs.
   */
  private headersToRecord(
    headers?: Record<string, string> | Headers
  ): Record<string, string> {
    if (!headers) {
      return {};
    }
    if (headers instanceof Headers) {
      const record: Record<string, string> = {};
      headers.forEach((value, key) => {
        record[key] = value;
      });
      return record;
    }
    return { ...headers };
  }

  private prepareHeaders(
    additionalHeaders?: Record<string, string>,
    skipSessionAuth = false
  ): Headers {
    const headers = new Headers({
      ...this.defaultHeaders,
      ...(additionalHeaders || {}),
    });

    // Always add X-Publishable-Key header for service-level authentication
    headers.set('X-Publishable-Key', this.publishableKey);

    // Prefer an explicitly resolved moniker (e.g. fromConfig()'s resolved
    // runtimeConfig.itemId) over guessing from the baseURL's trailing GUID.
    // This header is required for Fabric hosting.
    const moniker = this.moniker ?? this.extractLastGuid(this.baseUrl);
    if (moniker) {
      headers.set('x-ms-workload-resource-moniker', moniker);
    }

    // Add authorization header if token is available AND not already provided
    // This allows explicit Authorization headers to take precedence (e.g., for signout)
    if (
      !skipSessionAuth &&
      this.getAccessTokenCallback &&
      !headers.has('Authorization')
    ) {
      const token = this.getAccessTokenCallback();
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
    }

    return headers;
  }

  /**
   * Extracts the last GUID from a URL path. This would be projectId.
   * @param url - The URL to extract from
   * @returns The last GUID found in the path, or undefined if none found
   */
  private extractLastGuid(url: string): string | undefined {
    const guidPattern =
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    const matches = url.match(guidPattern);
    return matches ? matches[matches.length - 1] : undefined;
  }

  /**
   * Builds a full URL by properly combining base URL and path.
   * Unlike new URL(path, base), this preserves the base URL's path component.
   *
   * Examples:
   * - buildUrl('/api/auth') with baseUrl 'http://localhost:5168'
   *   → 'http://localhost:5168/api/auth'
   *
   * - buildUrl('/api/auth') with baseUrl 'https://host:443/webapi/capacities/123/appbackends/456'
   *   → 'https://host/webapi/capacities/123/appbackends/456/api/auth'
   *   (Preserves the full path, unlike new URL() which would produce 'https://host:443/api/auth')
   *
   * - buildUrl('https://example.com/full/url')
   *   → 'https://example.com/full/url' (absolute URLs returned as-is)
   *
   * @param path - The relative path to append
   * @returns The full URL string
   */
  private buildUrl(path: string): string {
    if (!this.baseUrl) {
      return path;
    }

    // If path is already absolute, return as-is
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }

    // Concatenates strings instead of using URL constructor, which preserves the base URL's full path
    // Remove trailing slash from baseUrl and leading slash from path for clean join
    const base = this.baseUrl.endsWith('/')
      ? this.baseUrl.slice(0, -1)
      : this.baseUrl;
    const relativePath = path.startsWith('/') ? path : `/${path}`;

    return `${base}${relativePath}`;
  }

  /**
   * Handles response errors in a consistent way.
   * On 401 Unauthorized, attempts automatic token refresh if callback is configured.
   * @param response - The fetch Response object
   * @returns The Response if it's ok, otherwise throws an appropriate error
   */
  private async handleResponseErrors(
    response: Response,
    signal: AbortSignal
  ): Promise<Response> {
    if (!response.ok) {
      let errorMessage: string;
      let errorData: any;

      if (response.status === 403) {
        errorData = await readForbiddenResponse(response, signal);
        const blocked = !response.redirected
          ? this.artifactBlockedError(errorData)
          : undefined;
        if (blocked) {
          throw blocked;
        }
      }

      try {
        // Try to parse error response as JSON
        if (response.status !== 403) {
          errorData = await response.json();
        }
        // Support standard 'message', OAuth 'error_description', and the
        // Fabric workload envelope, which carries its detail in `errors[]`.
        errorMessage =
          errorData?.error_description ||
          errorData?.message ||
          workloadErrorMessage(errorData) ||
          `HTTP Error ${response.status}`;
      } catch {
        // If not JSON, use text or status
        errorMessage = `HTTP Error ${response.status}: ${response.statusText}`;
      }

      // On 401, trigger refresh callback if available (handled by caller to retry)
      if (response.status === 401 && this.onRefreshNeededCallback) {
        // Don't throw yet - let the caller decide if they want to trigger refresh
        // The caller will catch NetworkError with status 401 and call refresh
      }

      throw Object.assign(new NetworkError(errorMessage, response.status), {
        // Attached rather than passed to the constructor so this stays additive
        // for every existing NetworkError caller. Undefined when the body was
        // not a workload envelope.
        workload: workloadFailureDetail(errorData),
      });
    }
    return response;
  }

  /**
   * Handles 401 errors by attempting token refresh and retrying the request.
   * @param url - The original request URL
   * @param options - The original request options
   * @returns Promise that resolves with the parsed response after retry
   */
  private async handleUnauthorizedWithRetry<T>(
    url: string,
    options: RequestOptions
  ): Promise<T> {
    const refresh = this.onRefreshNeededCallback;
    const currentResponseError = this.refreshResponseError;
    if (refresh) {
      // Trigger refresh (includes promise lock for concurrent prevention).
      // Errors propagate directly so callers can distinguish fatal auth
      // failures (SESSION_EXPIRED, INVALID_GRANT) from transient issues
      // (SERVER_ERROR, network blip, REFRESH_BACKOFF).
      try {
        await refresh();
      } catch (error) {
        const responseError = currentResponseError?.(error);
        if (responseError) {
          throw responseError;
        }
        if (
          error instanceof SdkError &&
          (responseAuthErrors.has(error) ||
            error.code === ARTIFACT_BLOCKED_CODE)
        ) {
          throw new NetworkError('Token refresh failed.');
        }
        throw error;
      }

      // Retry the original request with the refreshed token.
      // Preserve the original request headers (e.g. Content-Type) but drop any
      // stale Authorization so prepareHeaders injects the freshly refreshed
      // token. Note: options.headers may be a Headers instance, which cannot be
      // spread into a plain object, so it must be normalized to a record first.
      const { headers: originalHeaders, ...restOptions } = options;
      const carriedHeaders = this.headersToRecord(originalHeaders);
      for (const key of Object.keys(carriedHeaders)) {
        if (key.toLowerCase() === 'authorization') {
          delete carriedHeaders[key];
        }
      }
      const newHeaders = this.prepareHeaders(carriedHeaders);

      return await this.fetchWithTimeout<T>(
        url,
        { ...restOptions, headers: newHeaders },
        true // Mark as retry to prevent infinite loop
      );
    }

    // No refresh callback available, throw original error
    throw new NetworkError('Authentication required', 401);
  }

  /**
   * Handles a 401 on the retry-after-refresh path.
   * Notifies the auth layer that the fresh token was also rejected.
   */
  private handleRetryUnauthorized(error: NetworkError): never {
    if (this.onAuthExhaustedCallback) {
      this.onAuthExhaustedCallback();
    }

    throw error;
  }

  /**
   * Executes a fetch request with proper error handling and timeout.
   * Automatically retries on 401 if refresh callback is available.
   * @param url - The URL to request
   * @param options - Request options
   * @returns Promise that resolves with the parsed response
   */
  private async fetchWithTimeout<T>(
    url: string,
    options: RequestOptions = {},
    isRetry = false
  ): Promise<T> {
    // `responseType` is an ApiClient-level directive, not a fetch option, so it
    // is destructured out before the remaining options are forwarded to fetch.
    const {
      timeout = this.defaultTimeout,
      responseType,
      ...fetchOptions
    } = options;

    // Drive the timeout with an AbortController rather than a bare
    // `Promise.race` against `setTimeout`. This buys two things the old code
    // lacked: (1) the timer is always cleared once the fetch settles
    // (2) when the timeout wins we abort the request instead of leaving it running in the background.
    const controller = new AbortController();
    const callerSignal = fetchOptions.signal as AbortSignal | undefined;
    // Keep a reference to the abort forwarder so `finally` can detach it.
    let onCallerAbort: (() => void) | undefined;
    if (callerSignal) {
      if (callerSignal.aborted) {
        controller.abort(callerSignal.reason);
      } else {
        onCallerAbort = () => controller.abort(callerSignal.reason);
        callerSignal.addEventListener('abort', onCallerAbort, { once: true });
      }
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        const timeoutError = new SdkError(
          `Request timed out after ${timeout}ms`
        );
        // Release the socket/stream instead of letting the request run to
        // completion once we've already given up on it.
        controller.abort(timeoutError);
        reject(timeoutError);
      }, timeout);
    });

    try {
      // Race between the fetch and the timeout. The fetch is wired to our
      // controller so a timeout (or caller abort) tears down the request.
      const response = (await Promise.race([
        this.fetchResponse(url, {
          ...fetchOptions,
          signal: controller.signal,
        }),
        timeoutPromise,
      ])) as Response;

      // Handle response based on status code
      await this.handleResponseErrors(response, controller.signal);

      // If no content (204 No Content) or Content-Length is 0, return empty object
      if (
        response.status === 204 ||
        response.headers.get('Content-Length') === '0'
      ) {
        return {} as T;
      }

      // Inspect the Content-Type before reading the body. The body can only be
      // consumed once, so the decision between `arrayBuffer()` and `text()`
      // must be made up front (CWE-aside: reading text first would corrupt a
      // binary stream).
      const contentType = (
        response.headers.get('Content-Type') || ''
      ).toLowerCase();

      // Binary responses (e.g. an Apache Arrow IPC stream) must be returned as
      // raw bytes rather than parsed as text/JSON. Branch on the response
      // Content-Type, never on assumption. The caller's `responseType` acts as
      // an explicit override for ambiguous content types, but an
      // `application/json` response is always parsed as JSON so the JSON path
      // keeps working when a caller opts into `'arraybuffer'` defensively.
      const isBinaryContentType =
        contentType.includes('application/vnd.apache.arrow.stream') ||
        contentType.includes('application/octet-stream');
      if (
        isBinaryContentType ||
        (responseType === 'arraybuffer' &&
          !contentType.includes('application/json'))
      ) {
        return (await response.arrayBuffer()) as T;
      }

      // Read response body as text (can only read once)
      const text = await response.text();

      // If empty, return empty object
      if (!text) {
        return {} as T;
      }

      // If Content-Type indicates JSON, parse as JSON
      if (contentType.includes('application/json')) {
        return JSON.parse(text);
      }

      // If no Content-Type header or text/plain (common in tests/mocks), try to parse as JSON
      // based on content structure
      if (
        (!contentType || contentType.includes('text/plain')) &&
        (text.trim().startsWith('{') || text.trim().startsWith('['))
      ) {
        try {
          return JSON.parse(text);
        } catch {
          // Not valid JSON, return as text
          return text as T;
        }
      }

      // For non-JSON Content-Types (form-urlencoded, etc.), return as text
      return text as T;
    } catch (error) {
      // Handle 401 with retry if not already retrying, refresh callback exists,
      // and skipRetryOn401 is not set (used by auth endpoints like signOut/refreshToken)
      if (
        error instanceof NetworkError &&
        error.status === 401 &&
        !isRetry &&
        !options.skipRetryOn401 &&
        this.onRefreshNeededCallback
      ) {
        return await this.handleUnauthorizedWithRetry<T>(url, options);
      }

      // Retry after refresh also returned 401 — auth is exhausted.
      if (error instanceof NetworkError && error.status === 401 && isRetry) {
        this.handleRetryUnauthorized(error);
      }

      if (error instanceof NetworkError || error instanceof SdkError) {
        throw error;
      } else if (error instanceof TypeError) {
        // Network errors like CORS or connectivity issues
        throw new NetworkError(`Network error: ${error.message}`);
      } else {
        // Any other unexpected errors
        throw new SdkError(`Unexpected error: ${(error as Error).message}`);
      }
    } finally {
      // Always release the timer, whether the fetch resolved, rejected, or the
      // timeout fired.
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      // Detach the caller-signal forwarder so a reused signal doesn't
      // accumulate one listener (and retain one controller) per request.
      if (callerSignal && onCallerAbort) {
        callerSignal.removeEventListener('abort', onCallerAbort);
      }
    }
  }

  /**
   * Makes a GET request.
   * @param path - The API endpoint path.
   * @param options - Optional fetch request options.
   * @returns A promise that resolves with the response data.
   */
  public async get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    // Handle URL construction for proxy vs direct scenarios
    const url = this.buildUrl(path);
    const headers = this.prepareHeaders(
      options.headers as Record<string, string>
    );

    // Exclude headers from options spread to prevent overwriting merged headers
    const { headers: _, ...restOptions } = options;
    return this.fetchWithTimeout<T>(url, {
      method: 'GET',
      headers,
      ...restOptions,
    });
  }

  /**
   * Makes a POST request.
   * @param path - The API endpoint path.
   * @param data - The request body.
   * @param options - Optional fetch request options.
   * @returns A promise that resolves with the response data.
   */
  public async post<T>(
    path: string,
    data?: any,
    options: RequestOptions = {}
  ): Promise<T> {
    // Handle URL construction for proxy vs direct scenarios
    const url = this.buildUrl(path);
    const headers = this.prepareHeaders({
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    });

    // Determine body format based on Content-Type
    let body: string | undefined;
    if (data) {
      const contentType = headers.get('Content-Type');
      // If data is already a string and Content-Type is form-urlencoded, use as-is
      if (
        typeof data === 'string' &&
        contentType === 'application/x-www-form-urlencoded'
      ) {
        body = data;
      } else {
        body = JSON.stringify(data);
      }
    }

    // Exclude headers from options spread to prevent overwriting merged headers
    const { headers: _, ...restOptions } = options;
    const result = this.fetchWithTimeout<T>(url, {
      method: 'POST',
      headers,
      body,
      ...restOptions,
    });

    // Log the request outcome WITHOUT the response body. The success payload can
    // contain sensitive data (e.g. the `/auth/v1/token` response includes the
    // access and refresh tokens), so it must never be written to the console
    // (CWE-532). The URL and the error object do not carry tokens and are safe.
    result.then(
      () => console.log(`✅ POST Success: ${url}`),
      (error) => console.log(`❌ POST Error: ${url}`, error)
    );

    return result;
  }

  /**
   * Makes a PUT request.
   * @param path - The API endpoint path.
   * @param data - The request body.
   * @param options - Optional fetch request options.
   * @returns A promise that resolves with the response data.
   */
  public async put<T>(
    path: string,
    data?: any,
    options: RequestOptions = {}
  ): Promise<T> {
    // Handle URL construction for proxy vs direct scenarios
    const url = this.buildUrl(path);
    const headers = this.prepareHeaders({
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    });

    // Exclude headers from options spread to prevent overwriting merged headers
    const { headers: _, ...restOptions } = options;
    return this.fetchWithTimeout<T>(url, {
      method: 'PUT',
      headers,
      body: data ? JSON.stringify(data) : undefined,
      ...restOptions,
    });
  }

  /**
   * Makes a DELETE request.
   * @param path - The API endpoint path.
   * @param options - Optional fetch request options.
   * @returns A promise that resolves with the response data.
   */
  public async delete<T>(
    path: string,
    options: RequestOptions = {}
  ): Promise<T> {
    // Handle URL construction for proxy vs direct scenarios
    const url = this.buildUrl(path);
    const headers = this.prepareHeaders(
      options.headers as Record<string, string>
    );

    // Exclude headers from options spread to prevent overwriting merged headers
    const { headers: _, ...restOptions } = options;
    return this.fetchWithTimeout<T>(url, {
      method: 'DELETE',
      headers,
      ...restOptions,
    });
  }

  /**
   * Makes a raw HTTP request with streaming support and returns the Response object.
   * Does not parse the response body - allows caller to handle streaming responses.
   * @param path - The API endpoint path.
   * @param options - Request options including streaming body support.
   * @returns A promise that resolves with the raw Response object.
   */
  public async requestRaw(
    path: string,
    options: {
      method?: string;
      headers?: Record<string, string>;
      body?: BodyInit | null;
      signal?: AbortSignal;
      timeout?: number;
      allowProxyPath?: boolean;
      skipAuth?: boolean;
    } = {}
  ): Promise<Response> {
    return this.fetchRaw(path, options, (response) =>
      Promise.resolve(response)
    );
  }

  /**
   * Sends a credential-bearing provider request without session authentication,
   * retries, cookies, or redirects. Retains client routing headers and fetch.
   * The timeout covers response consumption as well as response headers.
   * @internal
   */
  public async requestIsolated<T>(
    path: string,
    headers: Record<string, string>,
    readResponse: (response: Response) => Promise<T>
  ): Promise<T> {
    return this.fetchRaw(
      path,
      {
        method: 'POST',
        headers,
        skipSessionAuth: true,
        redirect: 'error',
        credentials: 'omit',
      },
      async (response, signal) => {
        if (response.status === 403 && !response.redirected) {
          const value = await readForbiddenResponse(response, signal);
          const blocked = this.artifactBlockedError(value);
          if (blocked) {
            throw blocked;
          }
        }
        return readResponse(response);
      }
    );
  }

  private async fetchRaw<T>(
    path: string,
    options: {
      method?: string;
      headers?: Record<string, string>;
      body?: BodyInit | null;
      signal?: AbortSignal;
      timeout?: number;
      allowProxyPath?: boolean;
      skipAuth?: boolean;
      skipSessionAuth?: boolean;
      redirect?: RequestInit['redirect'];
      credentials?: RequestInit['credentials'];
    },
    readResponse: (response: Response, signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    const {
      method = 'GET',
      headers: additionalHeaders = {},
      body,
      signal,
      timeout = this.defaultTimeout,
      allowProxyPath = true,
      skipAuth = false,
      skipSessionAuth = false,
      redirect,
      credentials,
    } = options;

    // Handle URL construction. Use the same path-preserving join as
    // get/post/put/delete (buildUrl) so a Fabric baseUrl that carries a path
    // (e.g. `.../appbackends/{id}`) is preserved. `new URL(path, baseUrl)`
    // silently drops that path for a leading-slash path, or replaces the last
    // segment for a relative one, breaking every non-same-origin call.
    // When allowProxyPath is false (e.g. an absolute OneLake SAS URL) the path
    // is already fully-qualified and is used verbatim.
    const url = allowProxyPath ? this.buildUrl(path) : path;

    // Prepare headers with optional auth
    const headers = skipAuth
      ? new Headers({ ...this.defaultHeaders, ...additionalHeaders })
      : this.prepareHeaders(additionalHeaders, skipSessionAuth);

    if (skipSessionAuth) {
      // A differently-cased default Authorization must not combine with the
      // provider credential supplied for this request.
      headers.delete('Authorization');
      for (const [name, value] of Object.entries(additionalHeaders)) {
        headers.set(name, value);
      }
    }

    try {
      // Create combined abort controller for timeout + caller signal
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () =>
          controller.abort(
            new SdkError(`Request timed out after ${timeout}ms`)
          ),
        timeout
      );

      // Keep a reference to the caller-signal forwarder so it can be detached
      // in `finally`.
      let onCallerAbort: (() => void) | undefined;
      if (signal) {
        // Early abort check
        if (signal.aborted) {
          clearTimeout(timeoutId);
          throw new SdkError('Request aborted before sending');
        }
        // Link caller's signal to our controller
        onCallerAbort = () => {
          clearTimeout(timeoutId);
          controller.abort(signal.reason);
        };
        signal.addEventListener('abort', onCallerAbort, { once: true });
      }

      try {
        const requestOptions: RequestInit = {
          method,
          headers,
          body,
          signal: controller.signal,
          ...(redirect ? { redirect } : {}),
          ...(credentials ? { credentials } : {}),
        };

        // Add duplex option for Node.js when sending a body stream
        if (body && !isBrowser()) {
          (requestOptions as any).duplex = 'half';
        }

        return await readResponse(
          await this.fetchResponse(url, requestOptions),
          controller.signal
        );
      } finally {
        clearTimeout(timeoutId);
        if (signal && onCallerAbort) {
          signal.removeEventListener('abort', onCallerAbort);
        }
      }
    } catch (error) {
      if (error instanceof TypeError) {
        // Network errors like CORS or connectivity issues
        throw new NetworkError(`Network error: ${error.message}`);
      } else if (error instanceof SdkError) {
        throw error;
      } else {
        // Any other unexpected errors
        throw new SdkError(`Unexpected error: ${(error as Error).message}`);
      }
    }
  }
}

// Export the ApiClient and types
export default ApiClient;
