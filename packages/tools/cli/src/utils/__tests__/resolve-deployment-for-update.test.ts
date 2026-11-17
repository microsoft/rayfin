import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveDeploymentForUpdate } from '../resolve-deployment-for-update.js';

const mocks = vi.hoisted(() => ({
  getAmbientWorkspaceId: vi.fn(),
  loadRayfinConfig: vi.fn(),
  listDeploymentsState: vi.fn(),
  resolveDeploymentEnvFile: vi.fn(),
  persistDeploymentEnvFile: vi.fn(),
  acquireFabricTokenForLookup: vi.fn(),
  resolveWorkspaceIdByName: vi.fn(),
  listItems: vi.fn(),
  readDeploymentFromFabric: vi.fn(),
}));

vi.mock('../ambient-env.js', () => ({
  getAmbientWorkspaceId: mocks.getAmbientWorkspaceId,
}));
vi.mock('../config-utils.js', () => ({
  loadRayfinConfig: mocks.loadRayfinConfig,
}));
vi.mock('../deployments-registry.js', () => ({
  listDeploymentsState: mocks.listDeploymentsState,
}));
vi.mock('../env-fabric-utils.js', () => ({
  resolveDeploymentEnvFile: mocks.resolveDeploymentEnvFile,
  persistDeploymentEnvFile: mocks.persistDeploymentEnvFile,
}));
vi.mock('../resolve-workspace-name.js', () => ({
  acquireFabricTokenForLookup: mocks.acquireFabricTokenForLookup,
  resolveWorkspaceIdByName: mocks.resolveWorkspaceIdByName,
}));
vi.mock('../hydrate-deployment.js', () => ({
  readDeploymentFromFabric: mocks.readDeploymentFromFabric,
}));
vi.mock('../../services/fabric/rayfin-item.js', () => ({
  RayfinItemManager: class {
    listItems = mocks.listItems;
  },
}));

const workspaceId = '11111111-1111-1111-1111-111111111111';
const deployment = {
  rayfinItemId: 'item-id',
  rayfinApiUrl: 'https://app.test',
  fabricWorkspaceId: workspaceId,
  publishableKey: 'public-key',
};
const options = { projectRoot: '/repo', nonInteractive: true };

describe('resolveDeploymentForUpdate', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getAmbientWorkspaceId.mockReturnValue(null);
    mocks.loadRayfinConfig.mockReturnValue({ id: 'my-app' });
    mocks.listDeploymentsState.mockReturnValue({
      deployments: [],
      warnings: [],
    });
    mocks.resolveDeploymentEnvFile.mockResolvedValue(null);
    mocks.acquireFabricTokenForLookup.mockResolvedValue('token');
    mocks.resolveWorkspaceIdByName.mockResolvedValue({ id: workspaceId });
    mocks.listItems.mockResolvedValue([
      { id: 'item-id', displayName: 'my-app', type: 'AppBackend' },
    ]);
    mocks.readDeploymentFromFabric.mockResolvedValue({
      workspaceDisplayName: 'My Workspace',
      deployment,
    });
    mocks.persistDeploymentEnvFile.mockResolvedValue({
      workspaceKey: 'my-workspace',
      warnings: [],
    });
  });

  it('discovers and records an existing app in a fresh CI checkout', async () => {
    mocks.getAmbientWorkspaceId.mockReturnValue(workspaceId);

    const result = await resolveDeploymentForUpdate(options);

    expect(mocks.acquireFabricTokenForLookup).toHaveBeenCalledWith({
      interactive: false,
    });
    expect(mocks.listItems).toHaveBeenCalledWith(workspaceId, 'AppBackend');
    expect(mocks.readDeploymentFromFabric).toHaveBeenCalledWith({
      projectRoot: '/repo',
      workspaceId,
      itemId: 'item-id',
      interactive: false,
    });
    expect(result?.deployment).toEqual({
      ...deployment,
      rayfinItemName: 'my-app',
    });
    expect(mocks.persistDeploymentEnvFile).toHaveBeenCalledWith(
      '/repo',
      'My Workspace',
      result?.deployment
    );
  });

  it('honors explicit workspace and item names instead of ambient targeting', async () => {
    mocks.getAmbientWorkspaceId.mockReturnValue('wrong-workspace');
    mocks.listItems.mockResolvedValue([
      { id: 'other-item', displayName: 'production-app', type: 'AppBackend' },
    ]);

    await resolveDeploymentForUpdate({
      ...options,
      workspace: 'Production',
      itemName: 'production-app',
    });

    expect(mocks.resolveWorkspaceIdByName).toHaveBeenCalledWith('Production', {
      token: 'token',
    });
    expect(mocks.listItems).toHaveBeenCalledWith(workspaceId, 'AppBackend');
    expect(mocks.readDeploymentFromFabric).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: 'other-item' })
    );
    expect(mocks.resolveDeploymentEnvFile).not.toHaveBeenCalled();
  });

  it('activates the selected recorded deployment without cloud discovery', async () => {
    mocks.resolveDeploymentEnvFile.mockResolvedValue({
      workspaceName: 'recorded-workspace',
      deployment,
    });

    await resolveDeploymentForUpdate(options);

    expect(mocks.resolveDeploymentEnvFile).toHaveBeenCalledWith(options);
    expect(mocks.persistDeploymentEnvFile).toHaveBeenCalledWith(
      '/repo',
      'recorded-workspace',
      deployment
    );
    expect(mocks.acquireFabricTokenForLookup).not.toHaveBeenCalled();
  });

  it('uses the recorded item for an explicitly selected workspace, not a stale active target', async () => {
    mocks.listDeploymentsState.mockReturnValue({
      deployments: [
        {
          workspaceName: 'production',
          record: { workspaceId },
        },
      ],
      warnings: [],
    });
    mocks.resolveDeploymentEnvFile.mockResolvedValue({
      workspaceName: 'production',
      deployment,
    });

    await resolveDeploymentForUpdate({
      ...options,
      workspaceId,
    });

    expect(mocks.resolveDeploymentEnvFile).toHaveBeenCalledWith({
      ...options,
      workspaceName: 'production',
    });
    expect(mocks.acquireFabricTokenForLookup).not.toHaveBeenCalled();
    expect(mocks.persistDeploymentEnvFile).toHaveBeenCalledWith(
      '/repo',
      'production',
      deployment
    );
  });

  it('rejects dry-run before discovery or local state changes', async () => {
    await expect(
      resolveDeploymentForUpdate({ ...options, dryRun: true })
    ).rejects.toThrow('do not support --dry-run');
    expect(mocks.resolveDeploymentEnvFile).not.toHaveBeenCalled();
    expect(mocks.acquireFabricTokenForLookup).not.toHaveBeenCalled();
    expect(mocks.persistDeploymentEnvFile).not.toHaveBeenCalled();
  });

  it.each([
    { items: [] },
    {
      items: [
        { id: 'one', displayName: 'my-app', type: 'AppBackend' },
        { id: 'two', displayName: 'my-app', type: 'AppBackend' },
      ],
    },
  ])(
    'rejects missing or ambiguous apps without persisting a target ($items)',
    async ({ items }) => {
      mocks.listItems.mockResolvedValue(items);

      await expect(
        resolveDeploymentForUpdate({ ...options, workspaceId })
      ).rejects.toThrow(/not found|Multiple AppBackend/);
      expect(mocks.readDeploymentFromFabric).not.toHaveBeenCalled();
      expect(mocks.persistDeploymentEnvFile).not.toHaveBeenCalled();
    }
  );

  it('does not perform cloud discovery without workspace context', async () => {
    await expect(resolveDeploymentForUpdate(options)).resolves.toBeNull();
    expect(mocks.acquireFabricTokenForLookup).not.toHaveBeenCalled();
    expect(mocks.persistDeploymentEnvFile).not.toHaveBeenCalled();
  });

  it('propagates lookup failures without replacing local deployment metadata', async () => {
    mocks.listItems.mockRejectedValue(new Error('Forbidden'));

    await expect(
      resolveDeploymentForUpdate({ ...options, workspaceId })
    ).rejects.toThrow('Forbidden');
    expect(mocks.persistDeploymentEnvFile).not.toHaveBeenCalled();
  });

  it.each([
    { workspaceId: '' },
    { workspace: ' ' },
    { workspace: 'Production', workspaceId },
  ])(
    'rejects invalid targeting before reading an active deployment (%j)',
    async (target) => {
      await expect(
        resolveDeploymentForUpdate({ ...options, ...target })
      ).rejects.toThrow(/GUID|non-empty|mutually exclusive/);
      expect(mocks.resolveDeploymentEnvFile).not.toHaveBeenCalled();
      expect(mocks.acquireFabricTokenForLookup).not.toHaveBeenCalled();
      expect(mocks.persistDeploymentEnvFile).not.toHaveBeenCalled();
    }
  );
});
