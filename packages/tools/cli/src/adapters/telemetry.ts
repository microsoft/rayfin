/**
 * CLI implementation of the {@link TelemetryHandle} adapter.
 *
 * Workflows enrich the current invocation's event through this handle rather
 * than via ambient async-local-storage (unavailable in browsers).
 * The CLI owns the {@link InvocationContext} lifecycle via Commander hooks;
 * this handle is the per-invocation enrichment seam workflows see.
 *
 * The bound context owns enrichment so properties and measurements are part
 * of the finalized command event regardless of how the invocation completes.
 */
import type { TelemetryHandle } from '@microsoft/rayfin-tools-common/_internal/adapters';
import type {
  InvocationContext,
  TelemetryMeasurementKey,
  TelemetryPropertyKey,
} from '@microsoft/rayfin-tools-common/_internal/telemetry';

/**
 * {@link TelemetryHandle} bound to a single {@link InvocationContext}.
 *
 * Last write wins for a repeated key, matching App Insights semantics.
 */
export class CliTelemetryHandle implements TelemetryHandle {
  constructor(private readonly context: InvocationContext) {}

  addProperty(key: TelemetryPropertyKey, value: string): void {
    this.context.addProperty(key, value);
  }

  addMeasurement(key: TelemetryMeasurementKey, value: number): void {
    this.context.addMeasurement(key, value);
  }
}
