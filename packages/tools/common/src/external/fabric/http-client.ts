import type { Diagnostics, Http } from '../../adapters/index.js';
import { silentDiagnostics } from '../../adapters/index.js';
import { parseRetryAfterHeader } from '../../utils/retry/index.js';

import { throwFabricError } from './errors.js';
import type {
  FabricHttpClientOptions,
  FabricAcceptedResponse,
  FabricHttpMethod,
  FabricPollableOperation,
  FabricRequestOptions,
} from './types.js';

const DIAGNOSTIC_AREA = 'fabric';

/**
 * Universal HTTP transport for the Microsoft Fabric REST API.
 *
 * Transport-agnostic: requests go through an injected {@link Http} adapter
 * whose host implementation owns authentication (the bearer token is attached
 * by the adapter, never here). Verbose detail is emitted through the optional
 * {@link Diagnostics} sink rather than written to the console, so the client
 * is safe to run in any host.
 *
 * This is the low-level transport (paths, verbs, status handling), not a
 * Fabric operation vocabulary. Steps and product services SHOULD depend on a
 * higher-level operations interface (e.g. `FabricClient` with
 * `getWorkspace()` / `resolveOrCreateItem()`), which can be backed by this
 * transport today and by the generated Fabric TypeScript SDK later without
 * changing its consumers. See the external-services notes in
 * docs/rfc/rayfin-tools-architecture.md.
 */
export class FabricHttpClient {
  private readonly http: Http;

  private readonly baseUrl: string;

  private readonly diagnostics: Diagnostics;

  private readonly signal?: AbortSignal;

  constructor(options: FabricHttpClientOptions) {
    this.http = options.http;
    this.baseUrl = options.baseUrl;
    this.diagnostics = options.diagnostics ?? silentDiagnostics;
    this.signal = options.signal;
  }

  /**
   * Issue a request to the Fabric REST API and return the parsed body.
   *
   * Handles the success shapes Fabric uses for a synchronous call: a 200/201
   * payload and an empty success (`204 No Content`, or an empty `200`/`201`
   * from a write such as `DELETE`/`PUT`). An empty success resolves to an
   * empty object so a no-content response is not mistaken for a failure.
   *
   * A `202 Accepted` is an error here. An endpoint this method treats as
   * synchronous answering asynchronously is a Fabric contract change worth
   * surfacing loudly, rather than returning operation metadata mistyped as the
   * resource the caller asked for. Endpoints that legitimately answer 202 have
   * their own methods: {@link startOperation} when the operation is polled,
   * {@link requestAccepted} when completion is observed on the resource.
   *
   * Pass `options.signal` to cancel: an already-aborted signal throws before
   * any request is issued, and an abort mid-flight rejects with the signal's
   * abort reason.
   */
  async request<T>(
    path: string,
    method: FabricHttpMethod = 'GET',
    body?: unknown,
    options: FabricRequestOptions = {}
  ): Promise<T> {
    const response = await this.send(path, method, body, options);

    if (response.status === 202) {
      throw new Error(
        `Fabric answered ${path} asynchronously (202 Accepted), but this ` +
          'endpoint is called as a synchronous request'
      );
    }

    const data = await readJsonOrUndefined(response);
    return (data ?? {}) as T;
  }

  /**
   * Issue a `GET` and return the parsed body together with the response's
   * `Retry-After` pacing hint.
   *
   * {@link request} deliberately hides response metadata; a caller that owns
   * its own long-running-operation poll loop still needs the service's pacing
   * hint on *every* poll, not just the initial `202 Accepted`. Failure
   * handling matches {@link request}: a non-OK response throws a structured
   * {@link FabricError}, and an empty body resolves to an empty object.
   */
  async requestWithRetryAfter<T>(
    path: string,
    options: FabricRequestOptions = {}
  ): Promise<{ data: T; retryAfterMs?: number }> {
    const response = await this.send(path, 'GET', undefined, options);

    const retryAfterMs = parseRetryAfterHeader(response);
    const data = await readJsonOrUndefined(response);

    return {
      data: (data ?? {}) as T,
      retryAfterMs,
    };
  }

  /**
   * Start a Fabric long-running operation and return the handle needed to wait
   * for it.
   *
   * Calling this method *is* the caller's declaration that the endpoint starts
   * a pollable operation, so the required headers are enforced here rather
   * than by a separate narrowing step downstream. The result's ids are
   * therefore guaranteed present, and a poll loop can dereference them without
   * re-checking.
   *
   * The transport deliberately does not poll. Start Trial resolves through
   * `GET /operations/{id}` followed by a separate `/result` fetch, a sequence
   * only the caller can drive.
   */
  async startOperation(
    path: string,
    method: FabricHttpMethod = 'POST',
    body?: unknown,
    options: FabricRequestOptions = {}
  ): Promise<FabricPollableOperation> {
    const response = await this.send(path, method, body, options);

    if (response.status !== 202) {
      throw new Error(
        `Fabric did not start an operation for ${path}: expected ` +
          `202 Accepted, got ${response.status}`
      );
    }

    const operationId = response.headers.get('x-ms-operation-id');
    const operationLocation = response.headers.get('Location');
    if (!operationId || !operationLocation) {
      throw new Error(
        `Fabric started an operation for ${path} that cannot be polled: the ` +
          'response is missing Location or x-ms-operation-id'
      );
    }

    return {
      operationId,
      operationLocation,
      retryAfterMs: parseRetryAfterHeader(response),
    };
  }

  /**
   * Issue a request whose asynchronous completion is observed on the affected
   * resource rather than by polling an operation.
   *
   * Assign To Capacity answers `202 Accepted` with no operation to poll; the
   * caller confirms it by re-reading the workspace until the assignment
   * reports `Completed`. The response body carries no operation handle, but
   * its `Retry-After` still paces the first resource read.
   */
  async requestAccepted(
    path: string,
    method: FabricHttpMethod = 'POST',
    body?: unknown,
    options: FabricRequestOptions = {}
  ): Promise<FabricAcceptedResponse> {
    const response = await this.send(path, method, body, options);
    const retryAfterMs = parseRetryAfterHeader(response);
    return retryAfterMs === undefined ? {} : { retryAfterMs };
  }

  /**
   * Issue the request and surface a non-OK response as a structured
   * {@link FabricError}. Status interpretation belongs to the caller.
   */
  private async send(
    path: string,
    method: FabricHttpMethod,
    body: unknown,
    options: FabricRequestOptions
  ): Promise<Response> {
    const signal = options.signal ?? this.signal;
    signal?.throwIfAborted();

    this.debug(
      `${method} ${path.split('?', 1)[0]}`,
      body === undefined ? undefined : { hasBody: true }
    );

    const init: RequestInit = { method, signal };
    if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }

    const response = await this.http.fetch(`${this.baseUrl}${path}`, init);
    this.debug(`Response ${response.status} ${response.statusText}`);

    if (!response.ok) {
      await throwFabricError(response, 'Fabric API error');
    }

    return response;
  }

  private debug(message: string, data?: Record<string, unknown>): void {
    this.diagnostics.debug({ area: DIAGNOSTIC_AREA, message, data });
  }
}

async function readJsonOrUndefined(
  response: Response
): Promise<Record<string, unknown> | undefined> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
