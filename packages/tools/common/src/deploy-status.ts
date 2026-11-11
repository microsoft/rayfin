/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Origin of the code currently deployed on a Rayfin (AppBackend)
 * Fabric artifact.
 *
 * - `'None'` — no code has been deployed yet (newly-provisioned item).
 * - `'Template'` — the backend was deployed from a Fabric portal
 *   template; the local project should not auto-deploy on first open
 *   to avoid overwriting the templated backend.
 * - `'User'` — user code was deployed (e.g. via `rayfin up` from a
 *   client tool); the local project should likewise not auto-deploy.
 */
export type DeployedCodeOrigin = 'None' | 'Template' | 'User';

/** Status of an in-flight or recently completed deploy operation. */
export type DeployOperationStatus = 'InProgress' | 'Completed' | 'Failed';

/**
 * Response shape for the Fabric workload `__private/deploy/status`
 * endpoint. All fields are optional/nullable because the workload may
 * return partial state when no deploy has ever been requested.
 */
export interface DeployStatusResponse {
  status?: DeployOperationStatus | null;
  operationId?: string | null;
  templateId?: string | null;
  startedAt?: string | null;
  deployedCodeOrigin?: DeployedCodeOrigin | null;
  deployedTemplateId?: string | null;
}

/**
 * Builds the Fabric REST API path (relative to the API base URL) for the
 * Rayfin workload `__private/deploy/status` endpoint.
 *
 * Centralizes the workload endpoint contract for deploy clients.
 */
export function deployStatusPath(
  workspaceId: string,
  artifactId: string
): string {
  return `/workspaces/${workspaceId}/appBackends/${artifactId}/__private/deploy/status`;
}

/**
 * Builds the Fabric REST API path (relative to the API base URL) for the
 * Rayfin workload `__private/extended-properties` endpoint, which exposes
 * the resolved `BaaSEndpoint` for a provisioned item.
 */
export function extendedPropertiesPath(
  workspaceId: string,
  artifactId: string
): string {
  return `/workspaces/${workspaceId}/appBackends/${artifactId}/__private/extended-properties`;
}
