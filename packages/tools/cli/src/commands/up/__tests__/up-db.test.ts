import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  applyDbConfig: vi.fn(),
  loadRayfinConfig: vi.fn(),
  resolveServicePath: vi.fn(),
  resolveDeploymentForUpdate: vi.fn(),
  findRayfinProjectRoot: vi.fn(),
}));

vi.mock('../../../utils/apply-db-config.js', () => ({
  applyDbConfig: mocks.applyDbConfig,
}));

vi.mock('../../../utils/config-utils.js', () => ({
  loadRayfinConfig: mocks.loadRayfinConfig,
  resolveServicePath: mocks.resolveServicePath,
}));

vi.mock('../../../utils/resolve-deployment-for-update.js', () => ({
  resolveDeploymentForUpdate: mocks.resolveDeploymentForUpdate,
}));

vi.mock('../../../utils/project-utils.js', () => ({
  findRayfinProjectRoot: mocks.findRayfinProjectRoot,
}));

async function runApply(args: string[] = []): Promise<void> {
  const { upDbCommand } = await import('../up-db.js');
  await upDbCommand.parseAsync(['apply', ...args], { from: 'user' });
}

describe('rayfin up db apply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findRayfinProjectRoot.mockReturnValue('/repo');
    mocks.loadRayfinConfig.mockReturnValue({
      services: {
        data: { path: 'packages/data', buildCommand: 'npm run build' },
      },
    });
    mocks.resolveServicePath.mockReturnValue('/repo/packages/data');
    mocks.resolveDeploymentForUpdate.mockResolvedValue({
      deployment: { rayfinApiUrl: 'https://example.test/workload' },
      warnings: [],
    });
    mocks.applyDbConfig.mockResolvedValue(undefined);
  });

  it('resolves an existing app before applying database changes in a fresh checkout', async () => {
    await runApply();

    expect(mocks.resolveDeploymentForUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ projectRoot: '/repo', nonInteractive: true })
    );
    expect(
      mocks.resolveDeploymentForUpdate.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.applyDbConfig.mock.invocationCallOrder[0]);
  });

  it('does not apply database changes when target discovery fails', async () => {
    mocks.resolveDeploymentForUpdate.mockRejectedValueOnce(
      new Error('AppBackend not found')
    );

    await expect(runApply()).rejects.toThrow('AppBackend not found');
    expect(mocks.applyDbConfig).not.toHaveBeenCalled();
  });

  it('enables transient-error retry on the remote apply', async () => {
    await runApply();

    expect(mocks.applyDbConfig).toHaveBeenCalledTimes(1);
    expect(mocks.applyDbConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        remote: true,
        retryTransientErrors: true,
        serviceRoot: '/repo/packages/data',
        buildCommand: 'npm run build',
      })
    );
  });

  it('keeps retry enabled when --force is passed', async () => {
    await runApply(['--force']);

    expect(mocks.applyDbConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        remote: true,
        force: true,
        retryTransientErrors: true,
      })
    );
  });

  it('forwards the configured postgresql dialect to applyDbConfig', async () => {
    mocks.loadRayfinConfig.mockReturnValue({
      services: { data: { enabled: true, dialect: 'postgresql' } },
    });

    await runApply();

    expect(mocks.applyDbConfig).toHaveBeenCalledWith(
      expect.objectContaining({ dialect: 'postgresql' })
    );
  });

  it('defaults to mssql when no dialect is configured', async () => {
    await runApply();

    expect(mocks.applyDbConfig).toHaveBeenCalledWith(
      expect.objectContaining({ dialect: 'mssql' })
    );
  });
});
