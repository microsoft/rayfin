import { Command } from 'commander';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The subcommand action handlers call out to these helpers. Stub them so the
// tests exercise only the `--force` resolution / propagation logic without
// touching the filesystem, network, or real deployment endpoints.
vi.mock('../utils/apply-db-config.js', () => ({ applyDbConfig: vi.fn() }));
vi.mock('../utils/apply-storage-config.js', () => ({
  applyStorageConfig: vi.fn(),
}));
vi.mock('../utils/env-fabric-utils.js', () => ({
  resolveDeploymentEnvFile: vi.fn(async () => ({
    deployment: { rayfinApiUrl: 'https://example.test/api' },
  })),
}));
vi.mock('../utils/resolve-deployment-for-update.js', () => ({
  resolveDeploymentForUpdate: vi.fn(async () => ({
    deployment: { rayfinApiUrl: 'https://example.test/api' },
    warnings: [],
  })),
}));
vi.mock('../utils/project-utils.js', () => ({
  findRayfinProjectRoot: vi.fn(() => '/tmp/project'),
}));
vi.mock('../utils/config-utils.js', () => ({
  loadRayfinConfig: vi.fn(() => ({
    services: { data: { dialect: 'mssql' } },
  })),
  resolveServicePath: vi.fn((projectRoot: string, servicePath?: string) =>
    servicePath ? `${projectRoot}/${servicePath}` : projectRoot
  ),
  resolveServiceRoot: vi.fn(
    (projectRoot: string, _serviceName: string, servicePath?: string) =>
      servicePath ? `${projectRoot}/${servicePath}` : projectRoot
  ),
}));

type MockedFn = ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  // Reset the module registry so each test gets a brand-new Command instance.
  // Commander does not reset previously-parsed option values on re-parse, so
  // reusing a singleton across parses can leak `force: true` between tests.
  vi.resetModules();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

async function loadUpDb() {
  const { upDbCommand } = await import('../commands/up/up-db.js');
  const { applyDbConfig } = await import('../utils/apply-db-config.js');
  return { upDbCommand, applyDbConfig: applyDbConfig as MockedFn };
}

async function loadDevDb() {
  const { devDbCommand } = await import('../commands/dev/dev-db.js');
  const { applyDbConfig } = await import('../utils/apply-db-config.js');
  return { devDbCommand, applyDbConfig: applyDbConfig as MockedFn };
}

async function loadDevStorage() {
  const { devStorageCommand } = await import('../commands/dev/dev-storage.js');
  const { applyStorageConfig } =
    await import('../utils/apply-storage-config.js');
  return {
    devStorageCommand,
    applyStorageConfig: applyStorageConfig as MockedFn,
  };
}

/**
 * Builds a parent command that mirrors the real `up`/`dev` wiring. The
 * `declaresForce` flag controls whether the parent also declares `--force`,
 * which is the exact condition that makes Commander bind a trailing `--force`
 * token to the ancestor instead of the subcommand.
 */
function makeParent(name: string, declaresForce: boolean): Command {
  const parent = new Command(name);
  if (declaresForce) {
    parent.option(
      '--force',
      'Allow destructive data schema changes that may result in data loss',
      false
    );
  }
  parent.exitOverride();
  return parent;
}

describe('--force propagation through apply subcommands', () => {
  describe('rayfin up db apply', () => {
    // Regression test for the parent-`up` shadowing bug: `up` declares
    // `--force`, so `up db apply --force` previously left the subcommand's own
    // `force` at its `false` default and sent `force: false` to the server.
    it('forwards force:true even though the parent `up` also declares --force', async () => {
      const { upDbCommand, applyDbConfig } = await loadUpDb();
      const parent = makeParent('up', true).addCommand(upDbCommand);

      await parent.parseAsync(['node', 'rayfin', 'db', 'apply', '--force']);

      expect(applyDbConfig).toHaveBeenCalledTimes(1);
      expect(applyDbConfig).toHaveBeenCalledWith(
        expect.objectContaining({ remote: true, force: true })
      );
    });

    it('forwards force:false when --force is omitted', async () => {
      const { upDbCommand, applyDbConfig } = await loadUpDb();
      const parent = makeParent('up', true).addCommand(upDbCommand);

      await parent.parseAsync(['node', 'rayfin', 'db', 'apply']);

      expect(applyDbConfig).toHaveBeenCalledTimes(1);
      expect(applyDbConfig).toHaveBeenCalledWith(
        expect.objectContaining({ remote: true, force: false })
      );
    });
  });

  describe('rayfin dev db apply', () => {
    it('forwards force:true when --force is provided', async () => {
      const { devDbCommand, applyDbConfig } = await loadDevDb();
      const parent = makeParent('dev', false).addCommand(devDbCommand);

      await parent.parseAsync(['node', 'rayfin', 'db', 'apply', '--force']);

      expect(applyDbConfig).toHaveBeenCalledTimes(1);
      expect(applyDbConfig).toHaveBeenCalledWith(
        expect.objectContaining({ remote: false, force: true })
      );
    });

    it('forwards force:false when --force is omitted', async () => {
      const { devDbCommand, applyDbConfig } = await loadDevDb();
      const parent = makeParent('dev', false).addCommand(devDbCommand);

      await parent.parseAsync(['node', 'rayfin', 'db', 'apply']);

      expect(applyDbConfig).toHaveBeenCalledTimes(1);
      expect(applyDbConfig).toHaveBeenCalledWith(
        expect.objectContaining({ remote: false, force: false })
      );
    });

    it('stays correct if a parent ever declares --force (shadowing guard)', async () => {
      const { devDbCommand, applyDbConfig } = await loadDevDb();
      const parent = makeParent('dev', true).addCommand(devDbCommand);

      await parent.parseAsync(['node', 'rayfin', 'db', 'apply', '--force']);

      expect(applyDbConfig).toHaveBeenCalledTimes(1);
      expect(applyDbConfig).toHaveBeenCalledWith(
        expect.objectContaining({ remote: false, force: true })
      );
    });
  });

  describe('rayfin dev storage apply', () => {
    it('forwards force:true when --force is provided', async () => {
      const { devStorageCommand, applyStorageConfig } = await loadDevStorage();
      const parent = makeParent('dev', false).addCommand(devStorageCommand);

      await parent.parseAsync([
        'node',
        'rayfin',
        'storage',
        'apply',
        '--force',
      ]);

      expect(applyStorageConfig).toHaveBeenCalledTimes(1);
      expect(applyStorageConfig).toHaveBeenCalledWith(
        expect.objectContaining({ remote: false, force: true })
      );
    });

    it('forwards force:false when --force is omitted', async () => {
      const { devStorageCommand, applyStorageConfig } = await loadDevStorage();
      const parent = makeParent('dev', false).addCommand(devStorageCommand);

      await parent.parseAsync(['node', 'rayfin', 'storage', 'apply']);

      expect(applyStorageConfig).toHaveBeenCalledTimes(1);
      expect(applyStorageConfig).toHaveBeenCalledWith(
        expect.objectContaining({ remote: false, force: false })
      );
    });

    it('stays correct if a parent ever declares --force (shadowing guard)', async () => {
      const { devStorageCommand, applyStorageConfig } = await loadDevStorage();
      const parent = makeParent('dev', true).addCommand(devStorageCommand);

      await parent.parseAsync([
        'node',
        'rayfin',
        'storage',
        'apply',
        '--force',
      ]);

      expect(applyStorageConfig).toHaveBeenCalledTimes(1);
      expect(applyStorageConfig).toHaveBeenCalledWith(
        expect.objectContaining({ remote: false, force: true })
      );
    });
  });
});
