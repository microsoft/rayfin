import { SdkError } from '@microsoft/rayfin-lib';

/**
 * Machine-readable error codes surfaced by `@microsoft/rayfin-embed-host`.
 *
 * The first group maps non-success responses from the brokered-authorize
 * endpoint; `AUTHORIZE_FAILED` also covers network/transport failures. The
 * remaining codes cover request-validation failures raised before any network
 * call.
 * `ArtifactBlockedByAdmin` identifies an explicit administrator-block response,
 * not a generic permission denial.
 */
export type EmbedHostErrorCode =
  | 'ArtifactBlockedByAdmin'
  | 'EXCHANGE_NOT_ENABLED'
  | 'AUTH_FAILED'
  | 'INSUFFICIENT_PERMISSIONS'
  | 'NOT_AVAILABLE'
  | 'AUTHORIZE_FAILED'
  | 'VALIDATION_FAILED';

/**
 * Error raised by the embed host when a handoff cannot be brokered.
 *
 * The `code` is a stable {@link EmbedHostErrorCode} that a consumer can branch
 * on; the message is human-readable and never contains the delegated Entra
 * token or a raw server response body.
 */
export class EmbedHostError extends SdkError {
  public override name = 'EmbedHostError';

  /**
   * Stable machine-readable code narrowing the inherited `SdkError.code`.
   *
   * Declared (not redefined) so the value set by `super()` survives under
   * modern class-field semantics.
   */
  declare public readonly code: EmbedHostErrorCode;

  /**
   * @param message - Human-readable description, safe to log.
   * @param code - Stable machine-readable {@link EmbedHostErrorCode}.
   */
  constructor(message: string, code: EmbedHostErrorCode) {
    super(message, code);
    Object.setPrototypeOf(this, EmbedHostError.prototype);
  }
}
