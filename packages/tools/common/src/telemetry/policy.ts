/**
 * Telemetry policy gate.
 *
 * Centralizes the decision of whether telemetry is allowed. The shared
 * code never reads environment variables or host-specific settings
 * directly. Each app resolves its own platform-specific inputs and
 * passes pre-resolved booleans to this gate.
 */

export interface TelemetryPolicyOptions {
  /** True when the user has explicitly opted out (e.g. env var, config). */
  userOptOut: boolean;
  /** Host-resolved telemetry setting. */
  hostSettingEnabled?: boolean;
}

/**
 * Returns `true` when telemetry should be collected based on the
 * pre-resolved policy inputs.
 *
 * Rules (evaluated in order):
 * 1. User opt-out → disabled.
 * 2. Host setting explicitly disabled → disabled.
 * 3. Otherwise → enabled.
 */
export function isTelemetryEnabled(options: TelemetryPolicyOptions): boolean {
  if (options.userOptOut) {
    return false;
  }

  if (options.hostSettingEnabled === false) {
    return false;
  }

  return true;
}
