import { describe, expect, it } from 'vitest';

import {
  APPROVED_MICROSOFT_PACKAGE_NAMES,
  getTelemetryPropertyMaxLength,
  getTelemetryPropertyPolicy,
  InvocationContext,
  MAX_FABRIC_ACTIVITY_IDS,
  sanitizeTelemetryProperty,
  serializeFabricActivityIds,
  serializeMicrosoftPackages,
  TELEMETRY_MEASUREMENT_KEYS,
  TELEMETRY_PROPERTY_KEYS,
} from '../telemetry/index.js';
import type {
  EnvironmentInfo,
  TelemetryMeasurementKey,
  TelemetryPropertyKey,
} from '../telemetry/index.js';

const TEST_ENV: EnvironmentInfo = {
  osType: 'linux',
  osVersion: '6.1.0',
  nodeVersion: 'v20.11.0',
  shellType: 'bash',
};
const ORIGIN_ID = '9f970daa-6101-4df2-98f9-e0d86e975c61';
const OTHER_ORIGIN_ID = '2cb4fdd3-7224-4577-a70d-56f205f45e13';

// ── InvocationContext ───────────────────────────────────────────────

describe('InvocationContext', () => {
  it('generates a valid UUID v4 correlationId', () => {
    const ctx = new InvocationContext('rayfin-cli', '1.0.0');
    expect(ctx.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('records startTime at construction', () => {
    const before = Date.now();
    const ctx = new InvocationContext('rayfin-cli', '1.0.0');
    const after = Date.now();
    expect(ctx.startTime.getTime()).toBeGreaterThanOrEqual(before);
    expect(ctx.startTime.getTime()).toBeLessThanOrEqual(after);
  });

  it('finalize() produces correct schemaVersion and eventName', () => {
    const ctx = new InvocationContext('rayfin-cli', '1.0.0');
    ctx.setCommand('init', ['--verbose']);
    ctx.markSuccess();
    const event = ctx.finalize(TEST_ENV);
    expect(event.schemaVersion).toBe(2);
    expect(event.eventName).toBe('rayfin/command');
  });

  it('finalize() includes command name and safe params', () => {
    const ctx = new InvocationContext('rayfin-cli', '2.0.0');
    ctx.setCommand('dev.db', ['--dialect', '--verbose']);
    ctx.markSuccess();
    const event = ctx.finalize(TEST_ENV);
    expect(event.commandName).toBe('dev.db');
    expect(event.safeParameterNames).toEqual(['--dialect', '--verbose']);
  });

  it('templateName is undefined unless recorded', () => {
    const ctx = new InvocationContext('create-rayfin', '1.0.0');
    ctx.setCommand('create', ['--template']);
    ctx.markSuccess();
    expect(ctx.finalize(TEST_ENV).templateName).toBeUndefined();
  });

  it('recordTemplateName() is reflected in finalize()', () => {
    const ctx = new InvocationContext('create-rayfin', '1.0.0');
    ctx.setCommand('create', ['--template']);
    ctx.recordTemplateName('todoapp');
    ctx.markSuccess();
    expect(ctx.finalize(TEST_ENV).templateName).toBe('todoapp');
  });

  it('includes invocation properties and measurements', () => {
    const ctx = new InvocationContext('rayfin-cli', '1.0.0');
    ctx.addProperty('project_origin_id', ORIGIN_ID);
    ctx.addMeasurement('microsoft_package_count', 4);
    ctx.addMeasurement('package_unresolved_count', 1);

    const event = ctx.finalize(TEST_ENV);

    expect(event.properties).toEqual({ project_origin_id: ORIGIN_ID });
    expect(event.measurements).toEqual({
      microsoft_package_count: 4,
      package_unresolved_count: 1,
    });
  });

  it('accumulates unique Fabric activity IDs in response order', () => {
    const ctx = new InvocationContext('rayfin-cli', '1.0.0');
    ctx.recordFabricActivityId('activity-1');
    ctx.recordFabricActivityId('activity-2');
    ctx.recordFabricActivityId('activity-1');

    expect(ctx.finalize(TEST_ENV).properties?.fabric_activity_ids).toBe(
      '["activity-1","activity-2"]'
    );
  });

  it('merges canonical Fabric activity IDs added as a property', () => {
    const ctx = new InvocationContext('rayfin-cli', '1.0.0');
    ctx.recordFabricActivityId('activity-1');
    ctx.addProperty(
      'fabric_activity_ids',
      serializeFabricActivityIds(['activity-2', 'activity-3'])
    );

    expect(ctx.finalize(TEST_ENV).properties?.fabric_activity_ids).toBe(
      '["activity-1","activity-2","activity-3"]'
    );
  });

  it('rejects non-canonical Fabric activity ID properties', () => {
    const ctx = new InvocationContext('rayfin-cli', '1.0.0');
    ctx.addProperty('fabric_activity_ids', '["activity-1","activity-1"]');

    expect(
      ctx.finalize(TEST_ENV).properties?.fabric_activity_ids
    ).toBeUndefined();
  });

  it('drops malformed Fabric activity IDs', () => {
    const ctx = new InvocationContext('rayfin-cli', '1.0.0');
    ctx.recordFabricActivityId('activity-1');
    ctx.recordFabricActivityId('/home/alice/private');
    ctx.recordFabricActivityId('token=value');
    ctx.recordFabricActivityId('x'.repeat(129));

    expect(ctx.finalize(TEST_ENV).properties?.fabric_activity_ids).toBe(
      '["activity-1"]'
    );
  });

  it('retains the first and latest Fabric activity IDs', () => {
    const ctx = new InvocationContext('rayfin-cli', '1.0.0');
    for (let index = 0; index < 100; index++) {
      ctx.recordFabricActivityId(`activity-${index}`);
    }

    const serialized = ctx.finalize(TEST_ENV).properties?.fabric_activity_ids;
    expect(serialized?.length).toBeLessThanOrEqual(4096);
    expect(JSON.parse(serialized ?? '[]')).toEqual([
      ...Array.from({ length: 32 }, (_, index) => `activity-${index}`),
      ...Array.from({ length: 32 }, (_, index) => `activity-${index + 68}`),
    ]);
  });

  it('shrinks Fabric activity IDs to the serialized length limit', () => {
    const activityIds = Array.from(
      { length: MAX_FABRIC_ACTIVITY_IDS },
      (_, index) => `${'a'.repeat(120)}${String(index).padStart(8, '0')}`
    );

    const serialized = serializeFabricActivityIds(activityIds);
    const parsed = JSON.parse(serialized) as string[];

    expect(serialized.length).toBeLessThanOrEqual(
      getTelemetryPropertyMaxLength('fabric_activity_ids')
    );
    expect(parsed.length).toBeLessThan(MAX_FABRIC_ACTIVITY_IDS);
    expect(parsed[0]).toBe(activityIds[0]);
    expect(parsed.at(-1)).toBe(activityIds.at(-1));
  });

  it.each([
    'github-actions',
    'azure-pipelines',
    'gitlab-ci',
    'jenkins',
    'codespaces',
    'devcontainer',
    'local',
    'other',
    'customer-prod',
    'customer_env-01',
  ])('accepts safe telemetry environment %s', (environment) => {
    const ctx = new InvocationContext('rayfin-cli', '1.0.0');
    ctx.addProperty('telemetry_environment', environment);

    expect(ctx.finalize(TEST_ENV).properties?.telemetry_environment).toBe(
      environment
    );
  });

  it('rejects an empty telemetry environment name', () => {
    const ctx = new InvocationContext('rayfin-cli', '1.0.0');
    ctx.addProperty('telemetry_environment', '');

    expect(ctx.finalize(TEST_ENV).properties).toBeUndefined();
  });

  it('rejects unsafe telemetry environment names', () => {
    const ctx = new InvocationContext('rayfin-cli', '1.0.0');
    ctx.addProperty('telemetry_environment', '/home/alice/private');
    ctx.addProperty('telemetry_environment', 'name with spaces');
    ctx.addProperty('telemetry_environment', 'customer.prod');
    ctx.addProperty('telemetry_environment', 'x'.repeat(65));

    expect(ctx.finalize(TEST_ENV).properties?.telemetry_environment).toBe(
      undefined
    );
  });

  it('includes a canonical Microsoft package inventory', () => {
    const ctx = new InvocationContext('rayfin-cli', '1.0.0');
    const packages = serializeMicrosoftPackages([
      { name: '@microsoft/rayfin-core', version: '1.35.0-alpha' },
      { name: '@microsoft/fabric-visuals', version: '1.0.0' },
    ]);

    ctx.addProperty('microsoft_packages', packages.value);
    ctx.addMeasurement('microsoft_package_count', 2);

    const event = ctx.finalize(TEST_ENV);
    expect(event.properties?.microsoft_packages).toBe(
      '[{"name":"@microsoft/fabric-visuals","version":"1.0.0"},{"name":"@microsoft/rayfin-core","version":"1.35.0-alpha"}]'
    );
  });

  it('rejects malformed Microsoft package inventories', () => {
    const ctx = new InvocationContext('rayfin-cli', '1.0.0');

    ctx.addProperty('microsoft_packages', 'not-json');
    ctx.addProperty(
      'microsoft_packages',
      '[{"name":"@other/package","version":"1.0.0"}]'
    );
    ctx.addProperty(
      'microsoft_packages',
      '[{"name":"@microsoft/rayfin-z","version":"1.0.0"},{"name":"@microsoft/rayfin-a","version":"1.0.0"}]'
    );

    expect(ctx.finalize(TEST_ENV).properties).toBeUndefined();
  });

  it('rejects Microsoft packages outside the privacy-reviewed set', () => {
    expect(
      serializeMicrosoftPackages([
        { name: '@microsoft/internal-codename', version: '1.0.0' },
        { name: '@microsoft/rayfin-core', version: '1.35.0-alpha' },
      ]).value
    ).toBe('[{"name":"@microsoft/rayfin-core","version":"1.35.0-alpha"}]');
  });

  it('sorts and deduplicates Microsoft package inventories', () => {
    expect(
      serializeMicrosoftPackages([
        { name: '@microsoft/rayfin-storage', version: '2.0.0' },
        { name: '@microsoft/rayfin-auth', version: '1.0.0' },
        { name: '@microsoft/rayfin-auth', version: '1.0.0' },
      ]).value
    ).toBe(
      '[{"name":"@microsoft/rayfin-auth","version":"1.0.0"},{"name":"@microsoft/rayfin-storage","version":"2.0.0"}]'
    );
  });

  it('canonicalizes package object key order', () => {
    expect(
      serializeMicrosoftPackages([
        { version: '1.35.0-alpha', name: '@microsoft/rayfin-core' },
      ]).value
    ).toBe('[{"name":"@microsoft/rayfin-core","version":"1.35.0-alpha"}]');
  });

  it('preserves an approved adjacent Microsoft package name', () => {
    const ctx = new InvocationContext('rayfin-cli', '1.0.0');
    const packages = serializeMicrosoftPackages([
      { name: '@microsoft/fabric-visuals', version: '1.0.0' },
    ]);

    ctx.addProperty('microsoft_packages', packages.value);

    expect(ctx.finalize(TEST_ENV).properties?.microsoft_packages).toBe(
      '[{"name":"@microsoft/fabric-visuals","version":"1.0.0"}]'
    );
  });

  it('declares an explicit redaction policy for every property key', () => {
    expect(getTelemetryPropertyPolicy('fabric_activity_ids')).toEqual({
      maxLength: 4096,
      redactPaths: false,
    });
    expect(getTelemetryPropertyPolicy('project_origin_id')).toEqual({
      maxLength: 36,
      redactPaths: true,
    });
    expect(getTelemetryPropertyPolicy('microsoft_packages')).toEqual({
      maxLength: 4096,
      redactPaths: false,
    });
    expect(getTelemetryPropertyPolicy('telemetry_environment')).toEqual({
      maxLength: 64,
      redactPaths: false,
    });
  });

  it('keeps every approved package name safe from path redaction', () => {
    for (const packageName of APPROVED_MICROSOFT_PACKAGE_NAMES) {
      expect(sanitizeTelemetryProperty(packageName, 4096)).toBe(packageName);
    }
  });

  it('bounds large package inventories to the emitted schema limits', () => {
    const packages = serializeMicrosoftPackages(
      Array.from({ length: 100 }, (_, index) => ({
        name: '@microsoft/rayfin-core',
        version: `1.0.0-${String(index).padStart(3, '0')}`,
      }))
    );

    expect(packages.value.length).toBeLessThanOrEqual(4096);
    expect(packages.count).toBe(64);
    expect(JSON.parse(packages.value)).toHaveLength(64);
  });

  it('bounds the serialized inventory to the character limit', () => {
    const packages = serializeMicrosoftPackages(
      Array.from({ length: 64 }, (_, index) => ({
        name: '@microsoft/rayfin-connector-fabric-semanticmodel',
        version: `1.0.0-preview.${index}+build.20260810`,
      }))
    );

    expect(packages.value.length).toBeLessThanOrEqual(4096);
    expect(packages.count).toBeLessThan(64);
    expect(JSON.parse(packages.value)).toHaveLength(packages.count);
  });

  it('uses the last value for repeated keys', () => {
    const ctx = new InvocationContext('rayfin-cli', '1.0.0');
    ctx.addProperty('project_origin_id', ORIGIN_ID);
    ctx.addProperty('project_origin_id', OTHER_ORIGIN_ID);

    const event = ctx.finalize(TEST_ENV);

    expect(event.properties).toEqual({
      project_origin_id: OTHER_ORIGIN_ID,
    });
  });

  it('rejects values that do not match the policy for their approved key', () => {
    const ctx = new InvocationContext('rayfin-cli', '1.0.0');
    ctx.addProperty('project_origin_id', '/home/alice/project/package.json');
    ctx.addProperty('project_origin_id', 'secret-token-value');
    ctx.addMeasurement('microsoft_package_count', -1);

    const event = ctx.finalize(TEST_ENV);

    expect(event.properties).toBeUndefined();
    expect(event.measurements).toBeUndefined();
  });

  it('rejects keys outside the privacy-reviewed allowlists', () => {
    const ctx = new InvocationContext('rayfin-cli', '1.0.0');
    for (const key of ['oid', 'user_oid', 'void_count', 'api_key']) {
      ctx.addProperty(key as TelemetryPropertyKey, 'ignored');
    }
    ctx.addMeasurement('duration' as TelemetryMeasurementKey, 1);

    const event = ctx.finalize(TEST_ENV);

    expect(event.properties).toBeUndefined();
    expect(event.measurements).toBeUndefined();
  });

  it('uses snake_case for every approved enrichment key', () => {
    for (const key of [
      ...TELEMETRY_PROPERTY_KEYS,
      ...TELEMETRY_MEASUREMENT_KEYS,
    ]) {
      expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('rejects invalid package counts', () => {
    const ctx = new InvocationContext('rayfin-cli', '1.0.0');
    ctx.addMeasurement('microsoft_package_count', Number.NaN);
    ctx.addMeasurement('microsoft_package_count', 1.5);
    ctx.addMeasurement('package_unresolved_count', -1);

    expect(ctx.finalize(TEST_ENV).measurements).toBeUndefined();
  });

  it('finalize() sets clientSource based on productName', () => {
    const cliCtx = new InvocationContext('rayfin-cli', '1.0.0');
    cliCtx.markSuccess();
    expect(cliCtx.finalize(TEST_ENV).clientSource).toBe('cli');

    const createCtx = new InvocationContext('create-rayfin', '0.1.0');
    createCtx.markSuccess();
    expect(createCtx.finalize(TEST_ENV).clientSource).toBe('create-rayfin');
  });

  it('markSuccess() sets resultCategory to Success', () => {
    const ctx = new InvocationContext('rayfin-cli', '1.0.0');
    ctx.setCommand('init', []);
    ctx.markSuccess();
    const event = ctx.finalize(TEST_ENV);
    expect(event.resultCategory).toBe('Success');
    expect(event.errorType).toBeUndefined();
    expect(event.errorName).toBeUndefined();
  });

  it('markFailure() sets resultCategory and error fields', () => {
    const ctx = new InvocationContext('rayfin-cli', '1.0.0');
    ctx.setCommand('up', []);
    ctx.markFailure(new TypeError('network error'));
    const event = ctx.finalize(TEST_ENV);
    expect(event.resultCategory).toBe('Failure');
    expect(event.errorType).toBe('TypeError');
    expect(event.errorName).toBe('TypeError');
    expect(event.resultSummary).toBe('network error');
  });

  it('markUserFault() sets resultCategory to UserFault', () => {
    const ctx = new InvocationContext('rayfin-cli', '1.0.0');
    ctx.markUserFault('missing required argument');
    const event = ctx.finalize(TEST_ENV);
    expect(event.resultCategory).toBe('UserFault');
    expect(event.resultSummary).toBe('missing required argument');
  });

  it('markCanceled() sets resultCategory to Canceled', () => {
    const ctx = new InvocationContext('rayfin-cli', '1.0.0');
    ctx.markCanceled();
    const event = ctx.finalize(TEST_ENV);
    expect(event.resultCategory).toBe('Canceled');
  });

  it('defaults to Success when no result is set', () => {
    const ctx = new InvocationContext('rayfin-cli', '1.0.0');
    const event = ctx.finalize(TEST_ENV);
    expect(event.resultCategory).toBe('Success');
  });

  it('hasResult returns false initially and true after marking', () => {
    const ctx = new InvocationContext('rayfin-cli', '1.0.0');
    expect(ctx.hasResult).toBe(false);
    ctx.markSuccess();
    expect(ctx.hasResult).toBe(true);
  });

  it('finalize() includes environment info from parameter', () => {
    const ctx = new InvocationContext('rayfin-cli', '1.0.0');
    ctx.markSuccess();
    const event = ctx.finalize(TEST_ENV);
    expect(event.osType).toBe('linux');
    expect(event.osVersion).toBe('6.1.0');
    expect(event.nodeVersion).toBe('v20.11.0');
    expect(event.shellType).toBe('bash');
  });

  it('finalize() propagates devDeviceId from environment', () => {
    const ctx = new InvocationContext('rayfin-cli', '1.0.0');
    ctx.markSuccess();
    const event = ctx.finalize({
      ...TEST_ENV,
      devDeviceId: '00000000-0000-4000-8000-000000000abc',
    });
    expect(event.devDeviceId).toBe('00000000-0000-4000-8000-000000000abc');
  });

  it('finalize() leaves devDeviceId undefined when not provided', () => {
    const ctx = new InvocationContext('rayfin-cli', '1.0.0');
    ctx.markSuccess();
    const event = ctx.finalize(TEST_ENV);
    expect(event.devDeviceId).toBeUndefined();
  });

  it('finalize() computes positive durationMs', () => {
    const ctx = new InvocationContext('rayfin-cli', '1.0.0');
    ctx.markSuccess();
    const event = ctx.finalize(TEST_ENV);
    expect(event.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('finalize() produces valid ISO 8601 startTimeIso', () => {
    const ctx = new InvocationContext('rayfin-cli', '1.0.0');
    ctx.markSuccess();
    const event = ctx.finalize(TEST_ENV);
    expect(() => new Date(event.startTimeIso)).not.toThrow();
    expect(new Date(event.startTimeIso).toISOString()).toBe(event.startTimeIso);
  });

  // ── Golden payload: no sensitive fields ─────────────────────────

  it('finalize() never includes sensitive fields', () => {
    const ctx = new InvocationContext('rayfin-cli', '1.0.0');
    ctx.setCommand('login', ['--tenant']);
    ctx.markSuccess();
    const event = ctx.finalize(TEST_ENV);
    const serialized = JSON.stringify(event);

    // No file paths, tokens, secrets, or user identifiers.
    expect(serialized).not.toMatch(/password/i);
    expect(serialized).not.toMatch(/secret/i);
    expect(serialized).not.toMatch(/token/i);
    expect(serialized).not.toMatch(/bearer/i);
    expect(serialized).not.toMatch(/authorization/i);
  });
});
