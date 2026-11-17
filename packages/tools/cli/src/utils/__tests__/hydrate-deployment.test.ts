import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  hydrateDeploymentFromFabric,
  readDeploymentFromFabric,
} from '../hydrate-deployment.js';

const mocks = vi.hoisted(() => ({
  acquireToken: vi.fn(),
  getWorkspace: vi.fn(),
  getExtendedProperties: vi.fn(),
  fabricFetch: vi.fn(),
  writeDeploymentEnvFile: vi.fn(),
}));

vi.mock('../../auth/index.js', () => ({
  getRayfinAuth: async () => ({ acquireToken: mocks.acquireToken }),
  loadAuthState: async () => ({ tenantId: 'tenant-id' }),
}));
vi.mock('../ambient-env.js', () => ({
  hasAmbientToken: () => false,
  getAmbientToken: () => null,
}));
vi.mock('../../config/constants.js', () => ({
  MONIKER_HEADER: 'moniker',
  resolveFabricPortalUrl: () => 'https://portal.test/',
}));
vi.mock('../../services/fabric/workspace.js', () => ({
  WorkspaceManager: class {
    getWorkspace = mocks.getWorkspace;
  },
}));
vi.mock('../../services/fabric/rayfin-item.js', () => ({
  RayfinItemManager: class {
    getExtendedProperties = mocks.getExtendedProperties;
    getRayfinItemEndpoint = () => 'https://api.test/item';
    getAuthorizationHeader = () => 'Bearer token';
  },
}));
vi.mock('../http-client.js', () => ({
  fabricFetch: mocks.fabricFetch,
}));
vi.mock('../env-fabric-utils.js', () => ({
  writeDeploymentEnvFile: mocks.writeDeploymentEnvFile,
}));

const options = {
  projectRoot: '/repo',
  workspaceId: 'workspace-id',
  itemId: 'item-id',
};

describe('Fabric deployment hydration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.acquireToken.mockResolvedValue({ token: 'token' });
    mocks.getWorkspace.mockResolvedValue({ displayName: 'Production' });
    mocks.getExtendedProperties.mockResolvedValue({
      BaaSEndpoint: 'https://app.test',
    });
    mocks.fabricFetch.mockResolvedValue(
      new Response(JSON.stringify({ publishableKey: 'public-key' }))
    );
    mocks.writeDeploymentEnvFile.mockResolvedValue(
      '/repo/rayfin/.deployments.json'
    );
  });

  it('reads deployment metadata without persisting or provisioning resources', async () => {
    const result = await readDeploymentFromFabric(options);

    expect(result).toEqual({
      workspaceDisplayName: 'Production',
      deployment: {
        rayfinItemId: 'item-id',
        rayfinApiUrl: 'https://app.test',
        fabricWorkspaceId: 'workspace-id',
        fabricTenantId: 'tenant-id',
        publishableKey: 'public-key',
        fabricPortalUrl: 'https://portal.test',
        hostingUrl: undefined,
      },
    });
    expect(mocks.acquireToken).toHaveBeenCalledWith(undefined, {
      silentOnly: true,
    });
    expect(mocks.getWorkspace).toHaveBeenCalledWith('workspace-id');
    expect(mocks.getExtendedProperties).toHaveBeenCalledWith(
      'workspace-id',
      'item-id'
    );
    expect(mocks.fabricFetch).toHaveBeenCalledExactlyOnceWith(
      'https://api.test/item/__private/publishable-key',
      expect.objectContaining({ method: 'GET' })
    );
    expect(mocks.writeDeploymentEnvFile).not.toHaveBeenCalled();
  });

  it('preserves the existing hydrate-and-persist contract', async () => {
    const result = await hydrateDeploymentFromFabric(options);

    expect(mocks.writeDeploymentEnvFile).toHaveBeenCalledExactlyOnceWith(
      '/repo',
      'Production',
      expect.objectContaining({
        rayfinItemId: 'item-id',
        rayfinApiUrl: 'https://app.test',
        publishableKey: 'public-key',
      })
    );
    expect(result).toEqual({
      workspaceDisplayName: 'Production',
      baasEndpoint: 'https://app.test',
      publishableKey: 'public-key',
      envFilePath: '/repo/rayfin/.deployments.json',
    });
  });

  it('does not persist partial metadata when discovery fails', async () => {
    mocks.getExtendedProperties.mockRejectedValue(new Error('Forbidden'));

    await expect(hydrateDeploymentFromFabric(options)).rejects.toThrow(
      'Forbidden'
    );
    expect(mocks.writeDeploymentEnvFile).not.toHaveBeenCalled();
    expect(mocks.fabricFetch).not.toHaveBeenCalled();
  });
});
