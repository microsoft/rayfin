import { describe, expect, it } from 'vitest';

import {
  createFeatureFlags,
  FEATURE_FLAGS_ENV_VAR,
  getRegisteredDocsFeatureFlags,
  parseFeatureFlags,
  registerDocsFeatureFlag,
} from '../feature-flags.js';

describe('feature flags registry', () => {
  it('normalizes and exposes registered documentation feature flags', () => {
    registerDocsFeatureFlag(' Docs-Experimental-Test ');

    expect(getRegisteredDocsFeatureFlags()).toContain('docs-experimental-test');
    expect(() => registerDocsFeatureFlag('  ')).toThrow(/cannot be empty/);
  });

  it('returns true for a registered feature resolver', () => {
    const featureFlags = createFeatureFlags({
      env: new Map(),
      rayfinConfig: null,
    });

    featureFlags.register('storage', {
      on: () => true,
    });

    expect(featureFlags.get('storage')).toBe(true);
  });

  it('returns false for a registered feature resolver', () => {
    const featureFlags = createFeatureFlags({
      env: new Map(),
      rayfinConfig: null,
    });

    featureFlags.register('storage', {
      on: () => false,
    });

    expect(featureFlags.get('storage')).toBe(false);
  });

  it('returns null for an unregistered feature', () => {
    const featureFlags = createFeatureFlags({
      env: new Map(),
      rayfinConfig: null,
    });

    expect(featureFlags.get('storage')).toBeNull();
  });

  it('normalizes feature names during registration and lookup', () => {
    const featureFlags = createFeatureFlags({
      env: new Map(),
      rayfinConfig: null,
    });

    featureFlags.register(' storage ', {
      on: () => true,
    });

    expect(featureFlags.get('STORAGE')).toBe(true);
  });

  it('parses the shared feature flag env var as a trimmed comma-delimited list', () => {
    const featureFlags = parseFeatureFlags(
      new Map([[FEATURE_FLAGS_ENV_VAR, ' storage, ,DATA , Storage  ']])
    );

    expect(featureFlags.has('storage')).toBe(true);
    expect(featureFlags.has('data')).toBe(true);
    expect(featureFlags.size).toBe(2);
  });
});
