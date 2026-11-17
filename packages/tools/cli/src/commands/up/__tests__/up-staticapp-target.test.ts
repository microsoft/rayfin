import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MONIKER_HEADER } from '../../../config/constants.js';
import { upStaticappCommand } from '../up-staticapp.js';

const mocks = vi.hoisted(() => ({
  targetReady: false,
  resolveDeploymentForUpdate: vi.fn(),
  deployStaticContent: vi.fn(),
  removeRuntimeConfigFile: vi.fn(),
  writeRuntimeConfigFile: vi.fn(),
}));

vi.mock('../../../utils/project-utils.js', () => ({
  findRayfinProjectRoot: () => '/repo',
}));
vi.mock('../../../utils/config-utils.js', () => ({
  loadRayfinConfig: () => ({
    id: 'my-app',
    services: { staticHosting: { enabled: true, path: 'frontend' } },
  }),
  resolveServiceRoot: () => '/repo/frontend',
}));
vi.mock('../../../utils/resolve-deployment-for-update.js', () => ({
  resolveDeploymentForUpdate: mocks.resolveDeploymentForUpdate,
}));
vi.mock('../../../utils/remote-endpoint-utils.js', () => ({
  hasRemoteEndpoint: () => mocks.targetReady,
  getRemoteStaticDeployUrl: () => 'https://api.test/webapp/deploy',
  getRemoteRuntimeSettingsUrl: () => 'https://api.test/projectRuntimeSettings',
  getRemoteAuthorizationHeader: async () => 'Bearer token',
}));
vi.mock('../../../utils/static-hosting-utils.js', () => ({
  validateStaticFolder: () => ({
    exists: true,
    empty: false,
    resolvedPath: '/repo/frontend/dist',
    fileCount: 1,
    totalSizeBytes: 10,
  }),
  packageStaticFolder: async () => Buffer.from('zip'),
  deployStaticContent: mocks.deployStaticContent,
  runStaticBuildCommand: vi.fn(),
}));
vi.mock('../../../utils/runtime-config-file.js', () => ({
  writeRuntimeConfigFile: mocks.writeRuntimeConfigFile,
  removeRuntimeConfigFile: mocks.removeRuntimeConfigFile,
}));

function runDeploy(args: string[] = []): Promise<Command> {
  const up = new Command('up')
    .option('--workspace-id <id>', 'Target workspace')
    .option('--item-name <name>', 'Target app')
    .option('--json', 'Output JSON', false)
    .addCommand(upStaticappCommand);
  return new Command('rayfin')
    .option('--json', 'Output JSON', false)
    .addCommand(up)
    .parseAsync(['up', ...args, 'staticapp', 'deploy', '--skip-build'], {
      from: 'user',
    });
}

describe('targeted static deployment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.targetReady = false;
    mocks.resolveDeploymentForUpdate.mockImplementation(async () => {
      mocks.targetReady = true;
      return {
        workspaceName: 'production',
        deployment: {
          rayfinItemId: 'item-id',
          fabricWorkspaceId: 'workspace-id',
          rayfinApiUrl: 'https://app.test',
          publishableKey: 'public-key',
        },
        warnings: [],
      };
    });
    mocks.writeRuntimeConfigFile.mockResolvedValue({
      path: '/repo/frontend/dist/rayfin.config.json',
      preexisting: false,
      differences: [],
    });
    mocks.deployStaticContent.mockResolvedValue({});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves a fresh-checkout target before checking the endpoint or deploying', async () => {
    await runDeploy([
      '--workspace-id',
      'workspace-id',
      '--item-name',
      'my-app',
    ]);

    expect(mocks.resolveDeploymentForUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot: '/repo',
        workspaceId: 'workspace-id',
        itemName: 'my-app',
        nonInteractive: true,
      })
    );
    expect(mocks.deployStaticContent).toHaveBeenCalledWith(
      Buffer.from('zip'),
      'https://api.test/webapp/deploy',
      'Bearer token',
      expect.objectContaining({ [MONIKER_HEADER]: 'item-id' })
    );
    expect(mocks.writeRuntimeConfigFile).toHaveBeenCalledWith(
      '/repo/frontend/dist',
      expect.objectContaining({
        apiUrl: 'https://app.test',
        publishableKey: 'public-key',
        workspaceId: 'workspace-id',
        itemId: 'item-id',
      })
    );
    expect(mocks.removeRuntimeConfigFile).toHaveBeenCalledWith(
      '/repo/frontend/dist/rayfin.config.json'
    );
  });

  it('does not deploy when target discovery fails', async () => {
    mocks.resolveDeploymentForUpdate.mockRejectedValueOnce(
      new Error('AppBackend not found')
    );

    await expect(runDeploy()).rejects.toThrow('AppBackend not found');
    expect(mocks.deployStaticContent).not.toHaveBeenCalled();
    expect(mocks.writeRuntimeConfigFile).not.toHaveBeenCalled();
  });

  it('emits one JSON error when target discovery fails', async () => {
    mocks.resolveDeploymentForUpdate.mockRejectedValueOnce(
      new Error('AppBackend not found')
    );
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await expect(runDeploy(['--json'])).rejects.toThrow('AppBackend not found');

    expect(stdout).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(stdout.mock.calls[0][0]))).toEqual({
      status: 'error',
      error: 'AppBackend not found',
    });
    expect(mocks.deployStaticContent).not.toHaveBeenCalled();
  });

  it('emits one JSON result for a successful targeted deployment', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await runDeploy(['--json']);

    expect(stdout).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(stdout.mock.calls[0][0]))).toEqual({
      status: 'success',
      hostingUrl: '',
      duration: expect.any(String),
    });
  });
});
