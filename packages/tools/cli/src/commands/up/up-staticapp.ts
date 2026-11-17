import type { RayfinConfig } from '@microsoft/rayfin-tools-common/_internal/config';
import {
  preserveRecordedRuntimeSettings,
  translateStaticHostingAccessError,
  type RuntimeSettingsServices,
} from '@microsoft/rayfin-tools-common/_internal/services/runtime-settings';
import { Command } from 'commander';

import { MONIKER_HEADER } from '../../config/constants.js';
import { CliHandledError } from '../../errors.js';
import {
  loadRayfinConfig,
  resolveServiceRoot,
} from '../../utils/config-utils.js';
import { formatBytes } from '../../utils/format-utils.js';
import { persistHostingUrl } from '../../utils/hosting-url-utils.js';
import { fabricFetch, throwIfNotOk } from '../../utils/http-client.js';
import {
  resolveCommandFlags,
  modeLog,
  modeError,
  emitJson,
  emitJsonError,
  formatDuration,
  isInteractive,
  modeWarn,
} from '../../utils/output-mode.js';
import { resolveDeclaredPackageVersions } from '../../utils/package-versions.js';
import { findRayfinProjectRoot } from '../../utils/project-utils.js';
import {
  getRemoteAuthorizationHeader,
  getRemoteStaticDeployUrl,
  getRemoteRuntimeSettingsUrl,
  hasRemoteEndpoint,
} from '../../utils/remote-endpoint-utils.js';
import { resolveDeploymentForUpdate } from '../../utils/resolve-deployment-for-update.js';
import { HttpError, withRetry, RETRY_CONFIG } from '../../utils/retry-utils.js';
import {
  removeRuntimeConfigFile,
  writeRuntimeConfigFile,
} from '../../utils/runtime-config-file.js';
import {
  deployStaticContent,
  packageStaticFolder,
  runStaticBuildCommand,
  validateStaticFolder,
} from '../../utils/static-hosting-utils.js';

interface UpdateHostingRedirectSettingsOptions {
  settingsUrl: string;
  headers: Record<string, string>;
  updatedServices: RayfinConfig['services'];
  packageVersions: Record<string, string>;
}

/** Preserve current workload settings while updating the hosting redirect URI. */
export async function updateHostingRedirectSettings(
  options: UpdateHostingRedirectSettingsOptions
): Promise<void> {
  const { settingsUrl, headers, updatedServices, packageVersions } = options;
  const currentResponse = await fabricFetch(settingsUrl, { headers });
  const currentText = await throwIfNotOk(
    currentResponse,
    'Current runtime settings retrieval failed'
  );
  const currentProjectSettings = JSON.parse(currentText) as {
    serviceSettings?: RuntimeSettingsServices;
  };
  if (!currentProjectSettings.serviceSettings) {
    throw new Error(
      'Current runtime settings response did not include serviceSettings'
    );
  }

  const response = await fabricFetch(settingsUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(
      preserveRecordedRuntimeSettings({
        recorded: currentProjectSettings.serviceSettings,
        services: updatedServices,
        packageVersions,
      })
    ),
  });
  await throwIfNotOk(
    response,
    'Runtime settings update failed',
    translateStaticHostingAccessError
  );
}

/**
 * Static-app subcommand for remote deployment.
 * Provides 'rayfin up staticapp deploy' functionality as an escape hatch
 * when the full `rayfin up` flow is not needed.
 */
export const upStaticappCommand = new Command('staticapp')
  .description('Static web app operations for remote Rayfin item deployment')
  .addCommand(
    new Command('deploy')
      .description(
        'Build, package, and deploy static content to remote Rayfin item'
      )
      .option('-v, --verbose', 'Enable verbose output')
      .option(
        '--skip-build',
        'Skip the build command and deploy existing content',
        false
      )
      .option('--json', 'Output result as JSON', false)
      .action(async function (
        this: Command,
        options: { verbose?: boolean; skipBuild?: boolean; json?: boolean }
      ) {
        const {
          mode,
          verbose: resolvedVerbose,
          yes,
        } = resolveCommandFlags(this);
        const projectRoot = findRayfinProjectRoot(process.cwd(), {
          verbose: false,
          silent: true,
        });
        const rayfinConfig = loadRayfinConfig(projectRoot, { silent: true });
        if (!rayfinConfig) {
          if (mode === 'json') {
            emitJsonError(mode, 'Could not load rayfin.yml configuration');
          }
          modeError(mode, '❌ Could not load rayfin.yml configuration');
          modeError(
            mode,
            "   Run 'rayfin init' to create a project configuration."
          );
          throw new CliHandledError(
            new Error('Could not load rayfin.yml configuration')
          );
        }

        const staticConfig = rayfinConfig.services.staticHosting;
        if (!staticConfig?.enabled) {
          if (mode === 'json') {
            emitJsonError(mode, 'Static hosting is not enabled in rayfin.yml');
          }
          modeError(mode, '❌ Static hosting is not enabled in rayfin.yml');
          modeError(
            mode,
            "💡 Set 'services.staticHosting.enabled: true' and re-run"
          );
          throw new CliHandledError(
            new Error('Static hosting is not enabled in rayfin.yml')
          );
        }
        const globals = this.optsWithGlobals();
        const resolved = await resolveDeploymentForUpdate({
          projectRoot,
          workspace: globals.workspace,
          workspaceId: globals.workspaceId,
          itemName: globals.itemName,
          dryRun: globals.dryRun,
          workspaceUri: globals.workspaceUri,
          nonInteractive: !isInteractive({ yes }),
        }).catch((error: unknown) => {
          const message =
            error instanceof Error ? error.message : String(error);
          if (mode === 'json') {
            emitJsonError(mode, message);
          }
          modeError(mode, `❌ ${message}`);
          modeError(
            mode,
            '   Check the selected workspace and --item-name, then retry.'
          );
          throw new CliHandledError(error);
        });
        for (const warning of resolved?.warnings ?? []) {
          modeWarn(mode, warning);
        }

        // Verify remote endpoint exists
        if (!hasRemoteEndpoint()) {
          if (mode === 'json') {
            emitJsonError(
              mode,
              'No remote endpoint configured. Run "rayfin up" first.'
            );
          }
          modeError(mode, '❌ No remote endpoint configured');
          modeError(
            mode,
            "💡 Run 'rayfin up' first to deploy and configure the remote endpoint"
          );
          throw new CliHandledError(new Error('No remote endpoint configured'));
        }

        const deployUrl = getRemoteStaticDeployUrl();
        if (!deployUrl) {
          if (mode === 'json') {
            emitJsonError(mode, 'Could not construct static deploy URL');
          }
          modeError(mode, '❌ Could not construct static deploy URL');
          throw new CliHandledError(
            new Error('Could not construct static deploy URL')
          );
        }

        const staticServiceRoot = resolveServiceRoot(
          projectRoot,
          'staticHosting',
          staticConfig.path ?? '.'
        );

        // Read rayfinItemId and workspaceName from the deployment registry
        const rayfinItemId = resolved?.deployment.rayfinItemId;
        const workspaceName = resolved?.workspaceName;
        const monikerHeaders: Record<string, string> = rayfinItemId
          ? { [MONIKER_HEADER]: rayfinItemId }
          : {};

        modeLog(mode, '🌐 Static App Deploy (Remote Mode)\n');
        modeLog(mode, `🎯 Target: Remote Rayfin item workload endpoint`);
        modeLog(mode, `📍 Endpoint: ${deployUrl}`);

        const startTime = Date.now();

        // Path of the transient rayfin.config.json written into the build
        // output for this deploy; removed in the finally so it is never left
        // on disk (where it would shadow local-dev VITE_* values) — unless a
        // file already existed at that path, in which case it is left
        // untouched and reused as-is.
        let emittedRuntimeConfigPath: string | undefined;
        let emittedRuntimeConfigPreexisting = false;

        try {
          // Run build command unless skipped
          if (!options.skipBuild && staticConfig.buildCommand) {
            modeLog(
              mode,
              `\n🔨 Running build command: ${staticConfig.buildCommand}`
            );
            const buildSuccess = await runStaticBuildCommand(
              staticServiceRoot,
              staticConfig
            );
            if (!buildSuccess) {
              if (mode === 'json') {
                emitJsonError(mode, 'Build command failed');
              }
              modeError(mode, '❌ Build command failed');
              throw new CliHandledError(new Error('Build command failed'));
            }
            modeLog(mode, '✔ Build completed');
          } else if (options.skipBuild) {
            modeLog(mode, '\n⏭️  Skipping build (--skip-build)');
          }

          // Validate
          const validation = validateStaticFolder(
            staticServiceRoot,
            staticConfig
          );
          if (!validation.exists || validation.empty) {
            if (mode === 'json') {
              emitJsonError(
                mode,
                validation.message || 'Static folder validation failed'
              );
            }
            modeError(mode, `❌ ${validation.message}`);
            throw new CliHandledError(
              new Error(validation.message || 'Static folder validation failed')
            );
          }

          // Emit the transient runtime config into the built static folder so
          // the deployed SPA can fetch it at runtime. Removed in the finally
          // below so it is never left on disk — unless a file already existed
          // at that path, in which case it is left untouched and reused as-is
          // instead of being overwritten or removed.
          const deployment = resolved?.deployment;
          if (deployment?.rayfinApiUrl) {
            const written = await writeRuntimeConfigFile(
              validation.resolvedPath,
              {
                apiUrl: deployment.rayfinApiUrl,
                publishableKey: deployment.publishableKey,
                workspaceId: deployment.fabricWorkspaceId,
                itemId: deployment.rayfinItemId,
                portalUrl: deployment.fabricPortalUrl,
                tenantId: deployment.fabricTenantId,
              }
            );
            emittedRuntimeConfigPath = written.path;
            emittedRuntimeConfigPreexisting = written.preexisting;
            if (written.differences.length > 0) {
              modeLog(
                mode,
                `⚠️  Found an existing ${written.path} that doesn't match this deployment (${written.differences.join('; ')}) — reusing it as-is (not overwritten). Delete it and re-run to regenerate it.`
              );
            } else if (written.preexisting) {
              modeLog(mode, `✅ Using existing ${written.path}`);
            } else {
              modeLog(mode, `✅ Emitted ${emittedRuntimeConfigPath}`);
            }
          }

          // Package
          modeLog(
            mode,
            `\n📦 Packaging ${validation.fileCount} files (${formatBytes(validation.totalSizeBytes)})...`
          );
          const zipBuffer = await packageStaticFolder(validation.resolvedPath);
          modeLog(mode, '✔ Packaged');

          // Auth
          modeLog(mode, '\n🔐 Authenticating...');
          const authorizationHeader = await getRemoteAuthorizationHeader();
          modeLog(mode, '✔ Authenticated');

          // Deploy with retry for transient failures
          modeLog(mode, '\n🚀 Deploying...');
          const result = await withRetry(
            async () =>
              deployStaticContent(
                zipBuffer,
                deployUrl,
                authorizationHeader,
                monikerHeaders
              ),
            {
              label: 'static-deploy',
              verbose: resolvedVerbose
                ? (...args: any[]) => modeLog(mode, '[verbose]', ...args)
                : () => {},
              shouldRetry: (error) =>
                error instanceof HttpError &&
                [404, 408, 425, 429, 502, 503].includes(error.statusCode),
              onRetry: (attempt, delay, error) => {
                const status =
                  error instanceof HttpError ? error.statusCode : 'error';
                modeLog(
                  mode,
                  `⏳ Deploy endpoint not ready (${status}), retrying in ${delay / 1000}s... (${attempt}/${RETRY_CONFIG.maxAttempts})`
                );
              },
            }
          );
          modeLog(
            mode,
            `✅ Static content deployed (${validation.fileCount} files, ${formatBytes(validation.totalSizeBytes)})`
          );

          if (result.hostingUrl) {
            modeLog(mode, `  🌐 Hosting URL: ${result.hostingUrl}`);

            await persistHostingUrl({
              hostingUrl: result.hostingUrl,
              services: rayfinConfig.services,
              projectRoot,
              workspaceName: workspaceName ?? 'My workspace',
              postSettings: async (updatedServices) => {
                const settingsUrl = getRemoteRuntimeSettingsUrl();
                if (!settingsUrl) return;
                const headers = {
                  Authorization: authorizationHeader,
                  'Content-Type': 'application/json',
                  ...monikerHeaders,
                };
                await updateHostingRedirectSettings({
                  settingsUrl,
                  headers,
                  updatedServices,
                  packageVersions: resolveDeclaredPackageVersions(
                    projectRoot,
                    rayfinConfig.services
                  ),
                });
              },
            });
          }
          if (result.deploymentId) {
            modeLog(mode, `  🏷️  Deployment ID: ${result.deploymentId}`);
          }

          if (mode === 'json') {
            const duration = Date.now() - startTime;
            emitJson({
              status: 'success',
              hostingUrl: result.hostingUrl ?? '',
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
          modeError(
            mode,
            `\n❌ Static deploy failed: ${(error as Error).message}`
          );
          modeError(mode, '\n💡 Troubleshooting tips:');
          modeError(
            mode,
            '   • Verify the Rayfin item workload is running and healthy'
          );
          modeError(mode, "   • Check if 'rayfin up' completed successfully");
          modeError(
            mode,
            '   • Ensure your network can reach the remote endpoint'
          );
          modeError(
            mode,
            '   • Use --skip-build to deploy existing content without rebuilding'
          );
          throw new CliHandledError(error);
        } finally {
          // The runtime config is a transient deploy artifact: bundled into
          // the deployed content, but never left on disk. Remove it whether
          // the deploy succeeded or failed — unless it preexisted, in which
          // case it was left untouched above and is not ours to delete.
          if (!emittedRuntimeConfigPreexisting) {
            await removeRuntimeConfigFile(emittedRuntimeConfigPath);
          }
        }
      })
  );
