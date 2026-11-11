/**
 * Typed telemetry event schemas for the Rayfin platform.
 *
 * These interfaces define the wire format for all client-side telemetry
 * events emitted by the Rayfin CLI tools. Every field is typed,
 * documented, and versioned via `schemaVersion`.
 *
 * Shared runtime guards validate enrichment at accumulation and serialization
 * boundaries so host transports cannot drift from the privacy-reviewed schema.
 */

/** Product identifiers for telemetry events. */
export type ProductName = 'rayfin-cli' | 'create-rayfin';

/** Client source discriminator. */
export type ClientSource = 'cli' | 'create-rayfin';

/** Outcome classification for a command invocation. */
export type ResultCategory = 'Success' | 'Failure' | 'UserFault' | 'Canceled';

/** Privacy-reviewed string dimensions accepted by invocation enrichment. */
export const TELEMETRY_PROPERTY_KEYS = [
  'fabric_activity_ids',
  'project_origin_id',
  'microsoft_packages',
  'telemetry_environment',
] as const;

/** A privacy-reviewed string-dimension key. */
export type TelemetryPropertyKey = (typeof TELEMETRY_PROPERTY_KEYS)[number];

/** Privacy-reviewed numeric dimensions accepted by invocation enrichment. */
export const TELEMETRY_MEASUREMENT_KEYS = [
  'package_count',
  'microsoft_package_count',
  'package_unresolved_count',
] as const;

/** A privacy-reviewed numeric-dimension key. */
export type TelemetryMeasurementKey =
  (typeof TELEMETRY_MEASUREMENT_KEYS)[number];

const TELEMETRY_PROPERTY_KEY_SET: ReadonlySet<string> = new Set(
  TELEMETRY_PROPERTY_KEYS
);
const TELEMETRY_MEASUREMENT_KEY_SET: ReadonlySet<string> = new Set(
  TELEMETRY_MEASUREMENT_KEYS
);
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Opaque, server-controlled correlation IDs. The pattern bounds shape only,
// not semantics; the entry and serialized-length caps are independent, so
// the length cap may retain fewer than the maximum number of IDs.
const FABRIC_ACTIVITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:;+-]{0,127}$/;
export const MAX_FABRIC_ACTIVITY_IDS = 64;
const MAX_FABRIC_ACTIVITY_IDS_LENGTH = 4096;

/** Known execution environment categories used by automatic detection. */
export const TELEMETRY_ENVIRONMENTS = [
  'github-actions',
  'azure-pipelines',
  'gitlab-ci',
  'jenkins',
  'codespaces',
  'devcontainer',
  'local',
  'other',
] as const;

/** Validated execution environment label. */
export type TelemetryEnvironment = string;

const TELEMETRY_ENVIRONMENT_SET: ReadonlySet<string> = new Set(
  TELEMETRY_ENVIRONMENTS
);
const TELEMETRY_ENVIRONMENT_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_TELEMETRY_ENVIRONMENT_LENGTH = 64;
// Keep these lists explicit. Every addition requires schema and privacy review
// before the package may be emitted in telemetry.
const APPROVED_RAYFIN_PACKAGE_NAMES = [
  '@microsoft/create-rayfin',
  '@microsoft/rayfin-auth',
  '@microsoft/rayfin-auth-provider-fabric',
  '@microsoft/rayfin-cli',
  '@microsoft/rayfin-client',
  '@microsoft/rayfin-connector-fabric-graphql',
  '@microsoft/rayfin-connector-fabric-semanticmodel',
  '@microsoft/rayfin-connector-kusto',
  '@microsoft/rayfin-connectors',
  '@microsoft/rayfin-core',
  '@microsoft/rayfin-data',
  '@microsoft/rayfin-functions',
  '@microsoft/rayfin-lib',
  '@microsoft/rayfin-mcp',
  '@microsoft/rayfin-storage',
] as const;
const APPROVED_ADJACENT_MICROSOFT_PACKAGE_NAMES = [
  '@microsoft/fabric-app-data',
  '@microsoft/fabric-app-data-cli',
  '@microsoft/fabric-app-data-cli-proxy',
  '@microsoft/fabric-app-data-embed-client',
  '@microsoft/fabric-app-data-proxy',
  '@microsoft/fabric-datagrid',
  '@microsoft/fabric-visuals',
  '@microsoft/fabric-visuals-core',
] as const;

/** Privacy-reviewed package names accepted for deployment telemetry. */
export const APPROVED_MICROSOFT_PACKAGE_NAMES = [
  ...APPROVED_RAYFIN_PACKAGE_NAMES,
  ...APPROVED_ADJACENT_MICROSOFT_PACKAGE_NAMES,
] as const;

const APPROVED_MICROSOFT_PACKAGE_NAME_SET: ReadonlySet<string> = new Set(
  APPROVED_MICROSOFT_PACKAGE_NAMES
);
const PACKAGE_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
// Independent caps bound inventories collected across package roots.
// Distinct versions of one approved package can consume multiple entries, so
// the serialized-length cap may reduce the inventory below the entry cap.
const MAX_MICROSOFT_PACKAGE_ENTRIES = 64;
const MAX_MICROSOFT_PACKAGES_LENGTH = 4096;

/** One installed Microsoft package captured for deployment telemetry. */
export interface MicrosoftPackageVersion {
  name: string;
  version: string;
}

/** Canonical package inventory ready for telemetry emission. */
export interface SerializedMicrosoftPackages {
  value: string;
  count: number;
}

/** Sanitization policy for one approved telemetry property. */
export interface TelemetryPropertyPolicy {
  maxLength: number;
  redactPaths: boolean;
}

/** Return whether a package name is approved for deployment telemetry. */
export function isApprovedMicrosoftPackageName(value: string): boolean {
  return value.length <= 214 && APPROVED_MICROSOFT_PACKAGE_NAME_SET.has(value);
}

/** Return whether a package version is safe for deployment telemetry. */
export function isTelemetryPackageVersion(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 64 &&
    PACKAGE_VERSION_PATTERN.test(value)
  );
}

/** Return whether a runtime string is an approved property key. */
export function isTelemetryPropertyKey(
  key: string
): key is TelemetryPropertyKey {
  return TELEMETRY_PROPERTY_KEY_SET.has(key);
}

/** Return whether a runtime string is an approved measurement key. */
export function isTelemetryMeasurementKey(
  key: string
): key is TelemetryMeasurementKey {
  return TELEMETRY_MEASUREMENT_KEY_SET.has(key);
}

/** Validate a property value against the policy for its approved key. */
export function isTelemetryPropertyValue(
  key: TelemetryPropertyKey,
  value: unknown
): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  switch (key) {
    case 'fabric_activity_ids':
      return isFabricActivityIdsValue(value);
    case 'project_origin_id':
      return UUID_V4_PATTERN.test(value);
    case 'microsoft_packages':
      return isMicrosoftPackagesValue(value);
    case 'telemetry_environment':
      return isTelemetryEnvironment(value);
  }
}

/** Return the sanitization policy for an approved property key. */
export function getTelemetryPropertyPolicy(
  key: TelemetryPropertyKey
): TelemetryPropertyPolicy {
  switch (key) {
    case 'fabric_activity_ids':
      return {
        maxLength: MAX_FABRIC_ACTIVITY_IDS_LENGTH,
        redactPaths: false,
      };
    case 'project_origin_id':
      return { maxLength: 36, redactPaths: true };
    case 'microsoft_packages':
      return {
        maxLength: MAX_MICROSOFT_PACKAGES_LENGTH,
        redactPaths: false,
      };
    case 'telemetry_environment':
      return {
        maxLength: MAX_TELEMETRY_ENVIRONMENT_LENGTH,
        redactPaths: false,
      };
  }
}

/** Maximum serialized length accepted for a property key. */
export function getTelemetryPropertyMaxLength(
  key: TelemetryPropertyKey
): number {
  return getTelemetryPropertyPolicy(key).maxLength;
}

/** Serialize package pairs into the canonical telemetry representation. */
export function serializeMicrosoftPackages(
  packages: readonly MicrosoftPackageVersion[]
): SerializedMicrosoftPackages {
  const canonical = [...packages]
    .filter(isMicrosoftPackageVersion)
    .map(({ name, version }) => ({ name, version }))
    .sort((left, right) =>
      compareStrings(
        `${left.name}\0${left.version}`,
        `${right.name}\0${right.version}`
      )
    )
    .filter(
      (entry, index, all) =>
        index === 0 ||
        entry.name !== all[index - 1].name ||
        entry.version !== all[index - 1].version
    )
    .slice(0, MAX_MICROSOFT_PACKAGE_ENTRIES);

  while (canonical.length > 0) {
    const serialized = JSON.stringify(canonical);
    if (serialized.length <= MAX_MICROSOFT_PACKAGES_LENGTH) {
      return { value: serialized, count: canonical.length };
    }
    canonical.pop();
  }
  return { value: '[]', count: 0 };
}

/** Return whether a value is a known category or a safe custom label. */
export function isTelemetryEnvironment(
  value: unknown
): value is TelemetryEnvironment {
  return (
    typeof value === 'string' &&
    (TELEMETRY_ENVIRONMENT_SET.has(value) ||
      (value.length <= MAX_TELEMETRY_ENVIRONMENT_LENGTH &&
        TELEMETRY_ENVIRONMENT_PATTERN.test(value)))
  );
}

/** Return whether a value is a safe Fabric response activity identifier. */
export function isFabricActivityId(value: unknown): value is string {
  return typeof value === 'string' && FABRIC_ACTIVITY_ID_PATTERN.test(value);
}

/** Serialize unique Fabric activity IDs, retaining the earliest and latest. */
export function serializeFabricActivityIds(
  activityIds: readonly string[]
): string {
  const canonical = [
    ...new Set(activityIds.map((value) => value.trim())),
  ].filter(isFabricActivityId);

  let retained = retainBoundaries(canonical, MAX_FABRIC_ACTIVITY_IDS);

  while (retained.length > 0) {
    const serialized = JSON.stringify(retained);
    if (serialized.length <= MAX_FABRIC_ACTIVITY_IDS_LENGTH) {
      return serialized;
    }
    retained = retainBoundaries(canonical, retained.length - 1);
  }

  return '[]';
}

function retainBoundaries<T>(values: readonly T[], limit: number): T[] {
  if (values.length <= limit) {
    return [...values];
  }

  const firstCount = Math.ceil(limit / 2);
  const lastCount = limit - firstCount;
  return [
    ...values.slice(0, firstCount),
    ...(lastCount > 0 ? values.slice(-lastCount) : []),
  ];
}

function isFabricActivityIdsValue(value: string): boolean {
  if (value.length > MAX_FABRIC_ACTIVITY_IDS_LENGTH) {
    return false;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((entry): entry is string => typeof entry === 'string') &&
      serializeFabricActivityIds(parsed) === value
    );
  } catch {
    return false;
  }
}

/** Validate a measurement against the policy for its approved key. */
export function isTelemetryMeasurementValue(
  key: TelemetryMeasurementKey,
  value: unknown
): value is number {
  if (typeof value !== 'number') {
    return false;
  }

  switch (key) {
    case 'package_count':
    case 'microsoft_package_count':
    case 'package_unresolved_count':
      return Number.isSafeInteger(value) && value >= 0;
  }
}

function isMicrosoftPackagesValue(value: string): boolean {
  if (value.length > MAX_MICROSOFT_PACKAGES_LENGTH) {
    return false;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return false;
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_MICROSOFT_PACKAGE_ENTRIES) {
    return false;
  }

  let previous = '';
  for (const entry of parsed) {
    if (!isMicrosoftPackageVersion(entry)) {
      return false;
    }
    const key = `${entry.name}\0${entry.version}`;
    if (key <= previous) {
      return false;
    }
    previous = key;
  }
  return true;
}

function isMicrosoftPackageVersion(
  value: unknown
): value is MicrosoftPackageVersion {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    Object.keys(entry).length === 2 &&
    typeof entry['name'] === 'string' &&
    isApprovedMicrosoftPackageName(entry['name']) &&
    isTelemetryPackageVersion(entry['version'])
  );
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Platform environment information provided by the host application.
 *
 * The shared telemetry core cannot access `process` or other
 * platform-specific globals, so each consumer resolves these values
 * and passes them at finalization time.
 */
export interface EnvironmentInfo {
  osType: string;
  osVersion: string;
  nodeVersion: string;
  shellType?: string;
  /**
   * Stable, opaque identifier generated and persisted by Rayfin. Used to
   * correlate events emitted from the same installation across invocations.
   * Optional because resolution is best-effort.
   */
  devDeviceId?: string;
}

/**
 * Emitted once per CLI command invocation.
 *
 * Captures timing, outcome, and safe parameter metadata.
 * The schema evolves additively: optional fields and allowlisted
 * enrichment dimensions may be added without a version bump. Removing,
 * renaming, or changing the meaning of an existing field requires a bump.
 *
 * Version 2 redefined {@link RayfinCommandEvent.devDeviceId} from a machine
 * identifier to a per-installation identifier; filter on `schemaVersion` to
 * separate the two populations.
 */
export interface RayfinCommandEvent {
  schemaVersion: 2;
  eventName: 'rayfin/command';
  correlationId: string;

  productName: ProductName;
  productVersion: string;
  clientSource: ClientSource;

  commandName: string;
  safeParameterNames: string[];
  resultCategory: ResultCategory;
  resultSummary?: string;

  /**
   * The template used for scaffolding, when applicable (e.g. `rayfin init`
   * / `create-rayfin`). Only safe, non-identifying values are recorded:
   * the built-in template name (e.g. `todoapp`, `dataapp`) or a generic
   * category (`external`, `local`) for user-supplied git URLs and local
   * paths. Raw URLs and paths are never recorded. Undefined for commands
   * that do not involve a template.
   */
  templateName?: string;

  startTimeIso: string;
  durationMs: number;

  osType: string;
  osVersion: string;
  nodeVersion: string;
  shellType?: string;

  /** Stable per-installation identifier, when available. */
  devDeviceId?: string;

  errorType?: string;
  errorName?: string;

  /** Safe, bounded string dimensions added during the invocation. */
  properties?: Readonly<Partial<Record<TelemetryPropertyKey, string>>>;
  /** Safe, bounded numeric measurements added during the invocation. */
  measurements?: Readonly<Partial<Record<TelemetryMeasurementKey, number>>>;
}

/**
 * Emitted on unhandled exceptions or unexpected errors.
 */
export interface RayfinFaultEvent {
  schemaVersion: 1;
  eventName: 'rayfin/fault';
  correlationId: string;
  productName: string;
  productVersion: string;
  faultType: string;
  faultName: string;
  sanitizedMessage?: string;
}

/**
 * Emitted for non-command actions such as UI interactions,
 * configuration changes, or lifecycle events.
 */
export interface RayfinActionEvent {
  schemaVersion: 1;
  eventName: 'rayfin/action';
  correlationId: string;
  productName: ProductName;
  productVersion: string;
  action: string;
  properties?: Record<string, string>;
  measurements?: Record<string, number>;
}
