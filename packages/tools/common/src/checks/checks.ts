import { noopLogger } from '../logger.js';
import type { Logger } from '../logger.js';

import type {
  CheckResult,
  CommandOutput,
  CommandRunOptions,
  CommandRunner,
  PrereqDefinition,
} from './types.js';

/**
 * Prerequisite definitions for project setup.
 */
export const PREREQ_DEFINITIONS: readonly PrereqDefinition[] = [
  {
    name: 'Node.js',
    command: 'node --version',
    installUrl: 'https://nodejs.org',
    minMajorVersion: 20,
  },
  {
    name: 'Docker',
    command: 'docker --version',
    installUrl: 'https://www.docker.com/products/docker-desktop/',
  },
];

/**
 * Parse the major version number from a version string.
 *
 * Handles formats like "v20.11.0", "Docker version 24.0.7", "gh version 2.40.1".
 * Returns `null` if no version pattern is found.
 */
export function parseMajorVersion(output: string): number | null {
  // Cap input length to prevent polynomial regex backtracking on adversarial input
  const match = output.slice(0, 200).match(/(\d+)\.\d+/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Evaluate a single prerequisite against its command output.
 * Pure function — no I/O.
 */
export function evaluatePrereq(
  def: PrereqDefinition,
  output: CommandOutput
): CheckResult {
  if (output.exitCode !== 0) {
    return {
      status: 'fail',
      name: def.name,
      detail: 'Not found',
      installUrl: def.installUrl,
    };
  }

  const version = (output.stdout.trim() || output.stderr.trim())
    .split(/\r?\n/)[0]
    .slice(0, 500) // Bound line length to prevent polynomial regex backtracking
    .replace(/\s*https?:\/\/\S+/g, '')
    .trim();

  if (def.minMajorVersion) {
    const major = parseMajorVersion(version);
    if (major !== null && major < def.minMajorVersion) {
      return {
        status: 'warn',
        name: def.name,
        detail: `Version ${def.minMajorVersion}+ required (found: ${version})`,
        installUrl: def.installUrl,
      };
    }
  }

  return { status: 'pass', name: def.name, detail: version };
}

/**
 * Run all prerequisite checks using the provided runner.
 */
export async function checkAllPrereqs(
  runner: CommandRunner,
  logger: Logger = noopLogger,
  options: CommandRunOptions = {}
): Promise<CheckResult[]> {
  logger.info('Checking prerequisites…');
  const results: CheckResult[] = [];

  for (const def of PREREQ_DEFINITIONS) {
    options.signal?.throwIfAborted();
    logger.debug(`Running: ${def.command}`);
    const output = await runner.run(def.command, options);
    options.signal?.throwIfAborted();
    const result = evaluatePrereq(def, output);
    const tag = result.status === 'pass' ? 'pass' : result.status;
    logger.info(`${def.name}: ${tag} (${result.detail})`);
    results.push(result);
  }

  return results;
}

/**
 * Evaluate Docker GHCR (GitHub Container Registry) authentication.
 *
 * Checks whether `ghcr.io` credentials exist in the Docker config file
 * (`~/.docker/config.json`). Pure function — no I/O.
 */
export function evaluateDockerGhcrAuth(
  dockerConfig: CommandOutput
): CheckResult {
  if (dockerConfig.exitCode !== 0) {
    return {
      status: 'fail',
      name: 'Container Registry',
      detail: 'Docker config not found',
    };
  }

  try {
    const config = JSON.parse(dockerConfig.stdout) as {
      auths?: Record<string, unknown>;
      credHelpers?: Record<string, unknown>;
    };
    const hasAuth = config.auths?.['ghcr.io'] !== undefined;
    const hasCredHelper = config.credHelpers?.['ghcr.io'] !== undefined;

    if (hasAuth || hasCredHelper) {
      return {
        status: 'pass',
        name: 'Container Registry',
        detail: 'ghcr.io',
      };
    }
  } catch {
    return {
      status: 'fail',
      name: 'Container Registry',
      detail: 'Unable to read Docker config',
    };
  }

  return {
    status: 'fail',
    name: 'Container Registry',
    detail: 'Not authenticated to ghcr.io',
  };
}
