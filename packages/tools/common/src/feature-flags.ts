import type { RayfinConfig } from './config/index.js';

export const FEATURE_FLAGS_ENV_VAR = 'RAYFIN_FEATURE_FLAGS';

export interface FeatureFlagContext {
  env: Map<string, string>;
  rayfinConfig?: RayfinConfig | null;
}

export type FeatureFlagValue = boolean | null;

export interface FeatureFlagResolver {
  on: (
    env: Map<string, string>,
    rayfinConfig?: RayfinConfig | null
  ) => FeatureFlagValue;
}

export interface FeatureFlagsRegistry {
  register(name: string, resolver: FeatureFlagResolver): void;
  get(name: string): FeatureFlagValue;
}

const registeredDocsFeatureFlags = new Set<string>();

for (const name of [
  'storage',
  'postgresql',
  'docker-local-dev',
  'tools-arch-v2',
  'up-legacy',
  'cli-up-anonstatic',
  'cli-minor-fixes',
]) {
  registeredDocsFeatureFlags.add(name);
}

export function normalizeFeatureFlagName(name: string): string {
  return name.trim().toLowerCase();
}

export function registerDocsFeatureFlag(name: string): void {
  const normalizedName = normalizeFeatureFlagName(name);
  if (!normalizedName) {
    throw new Error('Documentation feature flag names cannot be empty.');
  }
  registeredDocsFeatureFlags.add(normalizedName);
}

export function getRegisteredDocsFeatureFlags(): readonly string[] {
  return [...registeredDocsFeatureFlags].sort();
}

export function parseFeatureFlags(
  env: Map<string, string>
): ReadonlySet<string> {
  const rawFeatureFlags = env.get(FEATURE_FLAGS_ENV_VAR) ?? '';

  return new Set(
    rawFeatureFlags
      .split(',')
      .map((featureName) => normalizeFeatureFlagName(featureName))
      .filter((featureName) => featureName.length > 0)
  );
}

export function createFeatureFlags(
  context: FeatureFlagContext
): FeatureFlagsRegistry {
  const resolvers = new Map<string, FeatureFlagResolver>();

  return {
    register(name: string, resolver: FeatureFlagResolver): void {
      const normalizedName = normalizeFeatureFlagName(name);
      resolvers.set(normalizedName, resolver);
    },
    get(name: string): FeatureFlagValue {
      const normalizedName = normalizeFeatureFlagName(name);
      const resolver = resolvers.get(normalizedName);

      if (!resolver) {
        return null;
      }

      const resolvedValue = resolver.on(context.env, context.rayfinConfig);

      if (resolvedValue === true || resolvedValue === false) {
        return resolvedValue;
      }

      return null;
    },
  };
}
