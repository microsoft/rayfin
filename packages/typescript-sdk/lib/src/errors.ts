/**
 * Base custom error for the SDK. All other custom errors should extend this.
 */
export class SdkError extends Error {
  public override name = 'SdkError';
  /** Optional stable, machine-readable error code. */
  public code?: string | undefined;

  /**
   * @param message - Human-readable error description.
   * @param code - Optional stable, machine-readable error code.
   */
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
    // Set the prototype explicitly to ensure proper inheritance in transpiled JS
    Object.setPrototypeOf(this, SdkError.prototype);
  }
}

/**
 * Error specifically for issues related to authentication.
 */
export class AuthError extends SdkError {
  public override name = 'AuthError';
  /** HTTP status associated with a recognized service rejection, when available. */
  declare readonly status?: number;
  /** Validated service request identifier, when provided for a recognized rejection. */
  declare readonly requestId?: string;

  /**
   * @param message - Human-readable error description.
   * @param code - Optional stable, machine-readable error code.
   * @param status - Optional HTTP status associated with the rejection.
   * @param requestId - Optional service request identifier for troubleshooting.
   */
  constructor(
    message: string,
    code?: string,
    status?: number,
    requestId?: string
  ) {
    super(message, code);
    if (status !== undefined) {
      this.status = status;
    }
    if (requestId !== undefined) {
      this.requestId = requestId;
    }
    Object.setPrototypeOf(this, AuthError.prototype);
  }
}

/**
 * Structured detail from a Fabric workload failure envelope.
 *
 * Carried as fields rather than folded into `message` so callers can branch on
 * the failure *shape* instead of matching substrings. Every field is optional,
 * because the envelope is the service's shape and a missing field must not turn
 * into a wrong claim.
 */
export interface WorkloadFailure {
  /** e.g. `WorkloadException`. */
  readonly errorCode?: string | undefined;
  /** e.g. `Unauthorized`. */
  readonly subErrorCode?: string | undefined;
  /** The user data function the call targeted. */
  readonly functionName?: string | undefined;
  /**
   * The invocation id.
   *
   * **All zeros is the default of a synthesized failure envelope**, not a
   * signal about the call: it carries no guarantee about whether the request
   * was dispatched, whether the function ran, what caused the failure, or
   * whether it is transient. Do not use it as a retry or idempotency
   * discriminator.
   */
  readonly invocationId?: string | undefined;
  /** Envelope status, e.g. `Failed`. */
  readonly status?: string | undefined;
}

/**
 * Error for network-related issues (e.g., API unreachable, bad response).
 */
export class NetworkError extends SdkError {
  public override name = 'NetworkError';
  /** HTTP status code associated with the failed response, when available. */
  public status?: number | undefined;
  /** Validated service request identifier, when provided for a recognized rejection. */
  declare readonly requestId?: string;
  /**
   * Structured detail from a Fabric workload failure envelope, when the
   * response carried one.
   *
   * Kept as fields rather than only folded into `message` so callers can branch
   * on the failure *shape* instead of matching message substrings.
   */
  public workload?: WorkloadFailure | undefined;

  /**
   * @param message - Human-readable error description.
   * @param status - HTTP status code associated with the failed response.
   * @param code - Optional stable, machine-readable error code.
   * @param requestId - Optional service request identifier for troubleshooting.
   */
  constructor(
    message: string,
    status?: number,
    code?: string,
    requestId?: string
  ) {
    super(message, code);
    this.status = status;
    if (requestId !== undefined) {
      this.requestId = requestId;
    }
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

/**
 * Asserts that the current environment is a browser.
 * Throws `SdkError` with code `BROWSER_ONLY` when `window` is undefined.
 *
 * @param api - Name of the API that requires a browser (used in the error message).
 */
export function assertBrowser(api: string): void {
  if (typeof window === 'undefined') {
    throw new SdkError(
      `${api} is only available in browser environments.`,
      'BROWSER_ONLY'
    );
  }
}
