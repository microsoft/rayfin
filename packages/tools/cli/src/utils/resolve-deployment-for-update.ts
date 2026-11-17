import { validateWorkspaceFlagSet } from '../commands/init-helpers.js';
import { RayfinItemManager } from '../services/fabric/rayfin-item.js';

import { getAmbientWorkspaceId } from './ambient-env.js';
import { loadRayfinConfig } from './config-utils.js';
import { listDeploymentsState } from './deployments-registry.js';
import {
  persistDeploymentEnvFile,
  resolveDeploymentEnvFile,
  type ResolvedDeployment,
} from './env-fabric-utils.js';
import { envBackupNoticeLines } from './env-file-utils.js';
import { readDeploymentFromFabric } from './hydrate-deployment.js';
import {
  acquireFabricTokenForLookup,
  resolveWorkspaceIdByName,
} from './resolve-workspace-name.js';

interface UpdateTargetOptions {
  projectRoot: string;
  workspace?: string;
  workspaceId?: string;
  itemName?: string;
  nonInteractive: boolean;
  dryRun?: boolean;
  workspaceUri?: string;
}

/** Resolve an existing app for a targeted update, including fresh CI checkouts. */
export async function resolveDeploymentForUpdate(
  options: UpdateTargetOptions
): Promise<(ResolvedDeployment & { warnings: string[] }) | null> {
  const { projectRoot, nonInteractive } = options;
  if (options.dryRun) {
    throw new Error(
      "Targeted deployments do not support --dry-run. Use 'rayfin up --dry-run' to preview a full deployment."
    );
  }
  if (options.workspaceUri !== undefined) {
    throw new Error(
      'Targeted deployments require --workspace or --workspace-id instead of --workspace-uri.'
    );
  }
  const flagErrors = validateWorkspaceFlagSet(options);
  if (flagErrors.length > 0) {
    throw new Error(flagErrors.join('\n'));
  }
  if (options.workspace !== undefined && !options.workspace.trim()) {
    throw new Error('Pass a non-empty workspace name with --workspace <name>.');
  }
  let requestedWorkspaceId =
    options.workspaceId ??
    (options.workspace ? undefined : getAmbientWorkspaceId());
  let token: string | undefined;
  if (options.workspace) {
    token = await acquireFabricTokenForLookup({
      interactive: !nonInteractive,
    });
    requestedWorkspaceId = (
      await resolveWorkspaceIdByName(options.workspace, { token })
    ).id;
  }
  const registry = requestedWorkspaceId
    ? listDeploymentsState(projectRoot)
    : undefined;
  const matchingDeployment = registry?.deployments.find(
    ({ record }) => record.workspaceId === requestedWorkspaceId
  );
  const recorded =
    requestedWorkspaceId && !matchingDeployment
      ? null
      : await resolveDeploymentEnvFile({
          projectRoot,
          nonInteractive,
          ...(matchingDeployment
            ? { workspaceName: matchingDeployment.workspaceName }
            : {}),
        });

  let resolved: ResolvedDeployment;
  if (recorded && options.itemName === undefined) {
    resolved = recorded;
  } else {
    const workspaceId =
      requestedWorkspaceId ?? recorded?.deployment.fabricWorkspaceId;
    if (!workspaceId) {
      return null;
    }

    const itemName =
      options.itemName ?? loadRayfinConfig(projectRoot, { silent: true })?.id;
    if (!itemName?.trim()) {
      throw new Error(
        'No Fabric item name configured. Pass --item-name <name> or set id in rayfin.yml.'
      );
    }
    token ??= await acquireFabricTokenForLookup({
      interactive: !nonInteractive,
    });
    const items = await new RayfinItemManager(token).listItems(
      workspaceId,
      'AppBackend'
    );
    const matches = items.filter(
      (item) => item.displayName === itemName.trim()
    );
    if (matches.length !== 1) {
      throw new Error(
        matches.length === 0
          ? `AppBackend "${itemName}" not found in the selected workspace. Check --item-name, or run 'rayfin up' for the initial deployment.`
          : `Multiple AppBackend items match "${itemName}". Use a unique --item-name before retrying.`
      );
    }
    const fetched = await readDeploymentFromFabric({
      projectRoot,
      workspaceId,
      itemId: matches[0].id,
      interactive: !nonInteractive,
    });
    resolved = {
      workspaceName: fetched.workspaceDisplayName,
      deployment: {
        ...fetched.deployment,
        rayfinItemName: matches[0].displayName,
      },
    };
  }

  const persisted = await persistDeploymentEnvFile(
    projectRoot,
    resolved.workspaceName,
    resolved.deployment
  );
  return {
    ...resolved,
    workspaceName: persisted.workspaceKey,
    warnings: [
      ...(registry?.warnings ?? []),
      ...persisted.warnings,
      ...(persisted.backup ? envBackupNoticeLines(persisted.backup) : []),
    ],
  };
}
