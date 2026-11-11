/**
 * Per-invocation telemetry context.
 *
 * Accumulates state during a single CLI command and
 * produces a typed {@link RayfinCommandEvent} at finalization. This
 * object is passed through the call chain explicitly — it is **not** a
 * global singleton.
 */

import {
  boundField,
  sanitizeException,
  sanitizeTelemetryProperty,
} from './sanitize.js';
import type {
  ClientSource,
  EnvironmentInfo,
  ProductName,
  RayfinCommandEvent,
  ResultCategory,
  TelemetryMeasurementKey,
  TelemetryPropertyKey,
} from './schema.js';
import {
  getTelemetryPropertyPolicy,
  isTelemetryMeasurementKey,
  isTelemetryMeasurementValue,
  isFabricActivityId,
  isTelemetryPropertyKey,
  isTelemetryPropertyValue,
  MAX_FABRIC_ACTIVITY_IDS,
  serializeFabricActivityIds,
} from './schema.js';

const FIRST_FABRIC_ACTIVITY_IDS_LIMIT = Math.ceil(MAX_FABRIC_ACTIVITY_IDS / 2);
const RECENT_FABRIC_ACTIVITY_IDS_LIMIT =
  MAX_FABRIC_ACTIVITY_IDS - FIRST_FABRIC_ACTIVITY_IDS_LIMIT;

export class InvocationContext {
  readonly correlationId: string;
  readonly startTime: Date;

  private _commandName = '';
  private _safeParameterNames: string[] = [];
  private _templateName: string | undefined;
  private _resultCategory: ResultCategory | undefined;
  private _resultSummary: string | undefined;
  private _errorType: string | undefined;
  private _errorName: string | undefined;
  private readonly _properties = new Map<TelemetryPropertyKey, string>();
  private readonly _measurements = new Map<TelemetryMeasurementKey, number>();
  private readonly _firstFabricActivityIds: string[] = [];
  private readonly _recentFabricActivityIds: string[] = [];
  private readonly _fabricActivityIdSet = new Set<string>();

  constructor(
    private readonly _productName: ProductName,
    private readonly _productVersion: string
  ) {
    this.correlationId = crypto.randomUUID();
    this.startTime = new Date();
  }

  /** Whether a result category has already been recorded. */
  get hasResult(): boolean {
    return this._resultCategory !== undefined;
  }

  /** Set the command name and safe parameter names for this invocation. */
  setCommand(name: string, safeParams: string[]): void {
    this._commandName = name;
    this._safeParameterNames = safeParams;
  }

  /**
   * Record the template used for scaffolding. Callers must pass only safe,
   * non-identifying values (a built-in template name or a generic category
   * such as `external`/`local`) — never a raw git URL or filesystem path.
   */
  recordTemplateName(name: string): void {
    this._templateName = name;
  }

  /**
   * Attach an approved, bounded string dimension to this invocation.
   * Callers must pass only safe, non-identifying values, never credentials,
   * tokens, user input, URLs, or other sensitive data.
   */
  addProperty(key: TelemetryPropertyKey, value: string): void {
    if (!isTelemetryPropertyKey(key) || !isTelemetryPropertyValue(key, value)) {
      return;
    }
    if (key === 'fabric_activity_ids') {
      // Merge serialized values through the accumulator so copied context and
      // response-derived IDs share ordering, deduplication, and bounds.
      for (const activityId of JSON.parse(value) as string[]) {
        this.recordFabricActivityId(activityId);
      }
      return;
    }
    const { maxLength, redactPaths } = getTelemetryPropertyPolicy(key);
    this._properties.set(
      key,
      redactPaths
        ? sanitizeTelemetryProperty(value, maxLength)
        : boundField(value, maxLength)
    );
  }

  /** Attach a numeric measurement approved by the policy for its key. */
  addMeasurement(key: TelemetryMeasurementKey, value: number): void {
    if (
      !isTelemetryMeasurementKey(key) ||
      !isTelemetryMeasurementValue(key, value)
    ) {
      return;
    }
    this._measurements.set(key, value);
  }

  /** Add a Fabric response activity ID to this invocation. */
  recordFabricActivityId(activityId: string | undefined): void {
    const normalized = activityId?.trim();
    if (
      !normalized ||
      !isFabricActivityId(normalized) ||
      this._fabricActivityIdSet.has(normalized)
    ) {
      return;
    }

    if (this._firstFabricActivityIds.length < FIRST_FABRIC_ACTIVITY_IDS_LIMIT) {
      this._firstFabricActivityIds.push(normalized);
      this._fabricActivityIdSet.add(normalized);
      return;
    }

    if (
      this._recentFabricActivityIds.length === RECENT_FABRIC_ACTIVITY_IDS_LIMIT
    ) {
      const evicted = this._recentFabricActivityIds.shift();
      if (evicted) {
        this._fabricActivityIdSet.delete(evicted);
      }
    }
    this._recentFabricActivityIds.push(normalized);
    this._fabricActivityIdSet.add(normalized);
  }

  markSuccess(): void {
    if (this._resultCategory !== undefined) return;
    this._resultCategory = 'Success';
  }

  markFailure(error: Error): void {
    this._resultCategory = 'Failure';
    const sanitized = sanitizeException(error);
    this._errorType = sanitized.type;
    this._errorName = sanitized.name;
    this._resultSummary = sanitized.message;
  }

  markUserFault(message: string): void {
    if (this._resultCategory === 'Failure') return;
    this._resultCategory = 'UserFault';
    this._resultSummary = message;
  }

  markCanceled(): void {
    if (this._resultCategory === 'Failure') return;
    this._resultCategory = 'Canceled';
  }

  /**
   * Produce the final {@link RayfinCommandEvent}.
   *
   * @param env - Platform-specific environment info provided by the
   *   host application (the shared core cannot access `process` or
   *   Node.js globals).
   */
  finalize(env: EnvironmentInfo): RayfinCommandEvent {
    const durationMs = Date.now() - this.startTime.getTime();
    const clientSourceMap: Record<ProductName, ClientSource> = {
      'rayfin-cli': 'cli',
      'create-rayfin': 'create-rayfin',
    };
    const clientSource: ClientSource = clientSourceMap[this._productName];

    const properties = new Map(this._properties);
    const serializedActivityIds = serializeFabricActivityIds([
      ...this._firstFabricActivityIds,
      ...this._recentFabricActivityIds,
    ]);
    if (serializedActivityIds !== '[]') {
      properties.set('fabric_activity_ids', serializedActivityIds);
    }

    return {
      schemaVersion: 2,
      eventName: 'rayfin/command',
      correlationId: this.correlationId,

      productName: this._productName,
      productVersion: this._productVersion,
      clientSource,

      commandName: this._commandName,
      safeParameterNames: this._safeParameterNames,
      templateName: this._templateName,
      resultCategory: this._resultCategory ?? 'Success',
      resultSummary: this._resultSummary,

      startTimeIso: this.startTime.toISOString(),
      durationMs,

      osType: env.osType,
      osVersion: env.osVersion,
      nodeVersion: env.nodeVersion,
      shellType: env.shellType,
      devDeviceId: env.devDeviceId,

      errorType: this._errorType,
      errorName: this._errorName,

      properties:
        properties.size > 0 ? Object.fromEntries(properties) : undefined,
      measurements:
        this._measurements.size > 0
          ? Object.fromEntries(this._measurements)
          : undefined,
    };
  }
}
