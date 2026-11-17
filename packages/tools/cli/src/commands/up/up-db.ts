import { Command } from 'commander';

import { applyDbConfig } from '../../utils/apply-db-config.js';
import {
  loadRayfinConfig,
  resolveServicePath,
} from '../../utils/config-utils.js';
import {
  resolveCommandFlags,
  emitJson,
  emitJsonError,
  formatDuration,
  isInteractive,
  modeWarn,
} from '../../utils/output-mode.js';
import { findRayfinProjectRoot } from '../../utils/project-utils.js';
import { resolveDeploymentForUpdate } from '../../utils/resolve-deployment-for-update.js';

/**
 * DB subcommand for remote deployment.
 * Provides 'rayfin up db apply' functionality.
 */
export const upDbCommand = new Command('db')
  .description('Database operations for remote Rayfin item deployment')
  .addCommand(
    new Command('apply')
      .description(
        'Generate and apply DAB configuration to remote Rayfin item workload endpoint'
      )
      .option('-v, --verbose', 'Enable verbose output')
      .option(
        '--force',
        'Allow destructive schema changes that may result in data loss',
        false
      )
      .option('--json', 'Output result as JSON', false)
      .action(async function (
        this: Command,
        options: {
          force?: boolean;
          verbose?: boolean;
          json?: boolean;
        }
      ) {
        const {
          mode,
          verbose: resolvedVerbose,
          yes,
        } = resolveCommandFlags(this);

        // The parent `up` command also declares `--force` (for the full
        // `rayfin up --force` deploy). Commander binds the `--force` token to
        // that ancestor command, so this subcommand's own `options.force`
        // stays at its `false` default even when the user typed
        // `rayfin up db apply --force`. OR-merge with the ancestor-captured
        // value (via `optsWithGlobals()`) so the flag is honored regardless of
        // which command in the chain Commander attributed it to.
        const resolvedForce =
          Boolean(options.force) || Boolean(this.optsWithGlobals().force);

        const startTime = Date.now();

        try {
          // Resolve workspace deployment interactively
          const projectRoot = findRayfinProjectRoot(process.cwd(), {
            verbose: false,
            silent: true,
          });
          const rayfinConfig = loadRayfinConfig(projectRoot, { silent: true });
          const dataServiceRoot = resolveServicePath(
            projectRoot,
            rayfinConfig?.services?.data?.path
          );
          const globals = this.optsWithGlobals();
          const resolved = await resolveDeploymentForUpdate({
            projectRoot,
            workspace: globals.workspace,
            workspaceId: globals.workspaceId,
            itemName: globals.itemName,
            dryRun: globals.dryRun,
            workspaceUri: globals.workspaceUri,
            nonInteractive: !isInteractive({ yes }),
          });
          for (const warning of resolved?.warnings ?? []) {
            modeWarn(mode, warning);
          }

          // Use shared applyDbConfig function with remote: true.
          // No `remoteEndpoint` override — applyDbConfig falls through to
          // `getRemoteApplyConfigUrl()`, which now returns the correct
          // Fabric item endpoint.
          await applyDbConfig({
            remote: true,
            mode,
            force: resolvedForce,
            verbose: resolvedVerbose,
            exitOnError: true,
            // Thread the configured dialect from rayfin.yml. Without it,
            // applyDbConfig defaults to 'mssql' and generates SQL Server types
            // (UNIQUEIDENTIFIER, NVARCHAR, DATETIME2) that a PostgreSQL backend
            // rejects on apply.
            dialect: rayfinConfig?.services?.data?.dialect || 'mssql',
            serviceRoot: dataServiceRoot,
            buildCommand: rayfinConfig?.services?.data?.buildCommand,
            retryTransientErrors: true,
          });

          if (mode === 'json') {
            const duration = Date.now() - startTime;
            emitJson({
              status: 'success',
              rayfinApiUrl: resolved?.deployment.rayfinApiUrl ?? '',
              duration: formatDuration(duration),
            });
          }
        } catch (error) {
          if (mode === 'json') {
            const duration = Date.now() - startTime;
            emitJsonError(mode, (error as Error).message, {
              duration: formatDuration(duration),
            });
          }
          throw error;
        }
      })
  );
