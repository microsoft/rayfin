/**
 * Public entrypoint for the `up` workflow.
 *
 * Hosts (such as CLI `cli/src/index.ts`) import the workflow
 * runner and its request/result/deps contracts from here. The backend
 * provisioning steps are also exported for peer workflows that need to create
 * the same Fabric target without running the full deployment workflow.
 */
export { runUpWorkflow } from './workflow.js';
export type { UpRequest, UpResult, UpDeps, UpNotice } from './types.js';
export { persistDeployment } from './steps/persist-deployment.js';
export { resolveOrCreateItem } from './steps/resolve-or-create-item.js';
export { resolveWorkspace } from './steps/resolve-workspace.js';
export type { FabricCapacitySource } from '../fabric-readiness/index.js';
export { refreshFrameworkEnv } from './steps/refresh-framework-env.js';
export {
  ASSET_ACCESS_YAML_PATH,
  RECOMMENDED_STATIC_HOSTING_POSTURE,
  STATIC_HOSTING_POSTURE_VALUES,
  describeInvalidPostureError,
  describeMissingPostureError,
  describePlannedPosture,
  describePosturePersistError,
  ensureStaticHostingPosture,
  inspectStaticHostingPosture,
  withAssetAccess,
} from './steps/ensure-static-hosting-posture.js';
export type {
  EnsureStaticHostingPostureResult,
  StaticHostingPosture,
  StaticHostingPostureState,
} from './steps/ensure-static-hosting-posture.js';
export {
  describeOutdatedAuthSdk,
  describeUnresolvedAuthSdk,
  ensureAuthSdk,
} from './steps/ensure-auth-sdk.js';
export type { EnsureAuthSdkResult } from './steps/ensure-auth-sdk.js';
