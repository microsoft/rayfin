/**
 * TelemetryHandle adapter — per-invocation event enrichment.
 *
 * The host owns the `InvocationContext` lifecycle (the CLI installs Commander
 * hooks). Workflows enrich the current invocation's event through this handle
 * rather than ambient async-local-storage, which is unavailable in browsers.
 *
 * Properties are string dimensions; measurements are numeric metrics.
 * Callers MUST pass only safe, non-identifying values (the shared telemetry
 * policy gate and sanitizer remain the source of truth for what is emitted).
 */
import type {
  TelemetryMeasurementKey,
  TelemetryPropertyKey,
} from '../telemetry/schema.js';

export interface TelemetryHandle {
  /**
   * Attach an approved string property to the current invocation's event.
   * Callers must pass only safe, non-identifying values, never credentials,
   * tokens, user input, URLs, or other sensitive data.
   */
  addProperty(key: TelemetryPropertyKey, value: string): void;

  /** Attach a numeric measurement to the current invocation's event. */
  addMeasurement(key: TelemetryMeasurementKey, value: number): void;
}

/** A telemetry handle that discards all enrichment (test/opt-out default). */
export const noopTelemetryHandle: TelemetryHandle = {
  addProperty() {},
  addMeasurement() {},
};
