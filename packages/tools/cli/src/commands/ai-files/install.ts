/**
 * `rayfin init ai-files install` — write the default scaffold (or merge with existing
 * project state). Idempotent. Interactive when stdin is a TTY and no per-item flags
 * are passed.
 */

import { Command } from 'commander';
import inquirer from 'inquirer';

import { idFor } from '../../services/agent-files/manager.js';
import { FEATURE_FLAGS_ENV_VAR } from '@microsoft/rayfin-tools-common/_internal';
import type { ItemId, ItemState } from '../../services/agent-files/types.js';
import {
  emitJson,
  isInteractive,
  resolveOutputMode,
  resolveRootOutputFlags,
} from '../../utils/output-mode.js';

import {
  buildEnableMap,
  buildManager,
  collectMulti,
  handleCommandError,
  modeLog,
  parseItemId,
  printReport,
  validateEnableDisableConflict,
} from './helpers.js';
import { getDocsService } from '../docs/helpers.js';

interface InstallCliOptions {
  /**
   * Commander variadic optional-arg shape:
   * - flag absent → `undefined`
   * - `--force` alone → `true`
   * - `--force mcp:rayfin` → `['mcp:rayfin']`
   * - `--force mcp:rayfin skill:rayfin` → `['mcp:rayfin', 'skill:rayfin']`
   */
  force?: boolean | string[];
  enable?: string[];
  disable?: string[];
  removeFiles?: boolean;
  nonInteractive?: boolean;
  yes?: boolean;
  json?: boolean;
  dryRun?: boolean;
}

/** Exit code emitted by `install` when the run succeeds but raised warnings. */
export const EXIT_CODE_WARNINGS = 3;

export const installCommand = new Command('install')
  .description(
    'Install or refresh Rayfin agent files (AGENTS.md, .mcp.json, .agents/skills/) in this project. Idempotent — re-running auto-updates items whose bundled content has changed.'
  )
  .option(
    '-f, --force [ids...]',
    'Overwrite existing files. Pass with no args to force every managed item; pass one or more namespaced ids (e.g. `--force mcp:rayfin`) to scope force to those items only — other items use default behavior (warn instead of overwrite). Variadic.'
  )
  .option(
    '-y, --yes',
    'Skip the interactive prompt (alias of --non-interactive). Locally re-declared so it works after the subcommand: `rayfin init ai-files install --yes`.',
    false
  )
  .option(
    '--non-interactive',
    'Skip the interactive prompt and accept defaults (all items enabled).',
    false
  )
  .option(
    '--enable <id>',
    'Enable a managed item by its namespaced id (e.g. skill:rayfin). Repeatable. Skips the interactive prompt.',
    collectMulti,
    [] as string[]
  )
  .option(
    '--disable <id>',
    'Disable a managed item — record the choice without writing the file. Repeatable. Skips the interactive prompt.',
    collectMulti,
    [] as string[]
  )
  .option(
    '--remove-files',
    'When used with --disable on a previously-installed item, also remove the on-disk content.',
    false
  )
  .option(
    '--json',
    'Emit a single JSON envelope to stdout instead of human-formatted progress lines. Suppresses interactive prompts.',
    false
  )
  .option(
    '-n, --dry-run',
    'Classify what install would do and emit the report without touching disk. Pairs with --json for previewability in scripts.',
    false
  )
  .action(async (options: InstallCliOptions, command) => {
    const json = Boolean(options.json) || resolveRootOutputFlags(command).json;
    const mode = resolveOutputMode({ json });
    try {
      const enableIds = (options.enable ?? []).map(parseItemId);
      const disableIds = (options.disable ?? []).map(parseItemId);
      validateEnableDisableConflict(enableIds, disableIds);
      if (options.removeFiles && disableIds.length === 0) {
        throw new Error(
          '--remove-files is only valid when --disable is also passed.'
        );
      }

      // Resolve --force variadic into the manager's per-item shape.
      // - undefined / [] (variadic provided but empty) → no force
      // - true (--force alone) → global force
      // - non-empty array → scope force to those ids only
      const forceArg = resolveForce(options.force);

      // Reject --enable/--disable for ids the CLI doesn't know about. Without
      // this, a typo like `--enable mcp:rayifn` is silently accepted (the
      // install loop iterates the managed descriptors, the orphan loop ignores
      // the map) and the user sees `Up to date` with no clue that the flag did
      // nothing. Now that --enable/--disable are the primary per-item control,
      // a typo deserves a hard error.
      const mgr = buildManager();
      const forceIdsForValidation =
        forceArg instanceof Set ? Array.from(forceArg) : [];
      validateKnownIds(
        [...enableIds, ...disableIds, ...forceIdsForValidation],
        mgr
      );

      // `-y/--yes` is now declared both globally (root program) AND locally
      // on this command for help-text discoverability. We resolve via
      // `optsWithGlobals` rather than `options.yes ?? globalOpts.yes` because:
      //
      // 1. Commander assigns the duplicate-named flag to the PARENT'S option
      //    object on parse, not the subcommand's. So `command.opts().yes` is
      //    always the local default (false) regardless of where the user
      //    placed `--yes`.
      // 2. The local `false` default would short-circuit `??` to `false`
      //    even when the global flag was set.
      //
      // optsWithGlobals merges parent + local correctly, so reading `.yes`
      // off the merged result captures both placements.
      const yes = Boolean((command.optsWithGlobals() as { yes?: boolean }).yes);

      const hasFlags = enableIds.length + disableIds.length > 0;
      // --json implies non-interactive (we must not write inquirer prompt
      // output to a stdout that's been promised to a JSON consumer).
      const skipPrompt =
        options.nonInteractive || json || hasFlags || !isInteractive({ yes });

      let enable = buildEnableMap(enableIds, disableIds);

      if (!skipPrompt) {
        const promptResult = await runInteractivePrompt(mgr);
        // Merge prompt selections with any explicit flags (flags win on conflict).
        enable = { ...promptResult.enable, ...enable };
      }

      const report = mgr.install({
        force: forceArg,
        enable,
        removeFiles: options.removeFiles,
        dryRun: options.dryRun,
      });
      if (
        !options.dryRun &&
        process.env[FEATURE_FLAGS_ENV_VAR]?.split(',').some((flag) => flag.trim())
      ) {
        getDocsService();
      }
      const hadWarnings = report.warnings.length > 0;

      if (mode === 'json') {
        // S1-4: structured envelope for agent / scripted consumers.
        emitJson({
          status: hadWarnings ? 'warnings' : 'ok',
          schemaVersion: 1,
          dryRun: options.dryRun ?? false,
          report,
        });
      } else {
        modeLog(
          mode,
          options.dryRun
            ? '🛠️  rayfin init ai-files install (dry-run, no writes)'
            : '🛠️  rayfin init ai-files install'
        );
        printReport(mode, report);
      }

      if (hadWarnings) {
        // S1-2: distinct exit code so agent consumers can tell warning-only
        // success from a hard error (which exits 1 via CliHandledError).
        process.exitCode = EXIT_CODE_WARNINGS;
      }
    } catch (err) {
      handleCommandError(mode, err);
    }
  });

/**
 * Throws if any id is neither in the descriptor table nor recorded in the
 * lockfile. The lockfile fallback lets `--disable` target a now-orphaned
 * item (one the CLI no longer ships but the project still has on disk).
 */
function validateKnownIds(
  ids: readonly ItemId[],
  mgr: ReturnType<typeof buildManager>
): void {
  if (ids.length === 0) return;
  const known = new Set<ItemId>();
  for (const d of mgr.managedDescriptors) known.add(idFor(d));
  for (const status of mgr.status()) known.add(status.id);
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown item id${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. ` +
        `Run 'rayfin init ai-files status' to see managed items.`
    );
  }
}

/**
 * Resolve commander's variadic `--force [ids...]` value into the manager's
 * per-item shape:
 * - flag absent (`undefined`) → `false` (no force)
 * - `--force` alone (`true`) → `true` (global force, legacy behavior)
 * - `--force <id> ...` (string array) → `Set<ItemId>` scoped to those ids
 * - `--force` with empty array → treated as global force (defensive: commander
 *   shouldn't produce this shape, but be tolerant).
 */
function resolveForce(
  raw: boolean | string[] | undefined
): boolean | ReadonlySet<ItemId> {
  if (raw === undefined || raw === false) return false;
  if (raw === true) return true;
  if (raw.length === 0) return true;
  return new Set(raw.map(parseItemId));
}

interface PromptResult {
  enable: Record<ItemId, boolean>;
}

async function runInteractivePrompt(
  mgr: ReturnType<typeof buildManager>
): Promise<PromptResult> {
  // Compute current state to seed defaults.
  const statuses = mgr.status();
  const stateById = new Map<ItemId, ItemState>(
    statuses.map((s) => [s.id, s.state])
  );

  const choices = mgr.managedDescriptors.map((d) => {
    const id = idFor(d);
    const state = stateById.get(id);
    const annotation = annotationFor(state);
    return {
      name: annotation ? `${id}  ${annotation}` : id,
      value: id,
      checked: state ? defaultEnabledFor(state) : true,
    };
  });

  const answer = await inquirer.prompt<{ selected: ItemId[] }>([
    {
      type: 'checkbox',
      name: 'selected',
      message: 'Select Rayfin agent files to install:',
      choices,
    },
  ]);

  const enable: Record<ItemId, boolean> = {};
  for (const choice of choices) {
    enable[choice.value] = answer.selected.includes(choice.value);
  }
  return { enable };
}

function annotationFor(state: ItemState | undefined): string {
  if (!state) return '';
  switch (state.kind) {
    case 'up-to-date':
      return '[up-to-date]';
    case 'update-available':
      return '[update-available]';
    case 'user-modified':
      return '⚠ [user-modified — local edits will be preserved]';
    case 'missing':
      return '⚠ [missing — file is gone]';
    case 'unreadable':
      return '⚠ [unreadable]';
    case 'disabled':
      return '[currently disabled]';
    case 'orphaned':
      return '[orphaned]';
    case 'not-installed':
      return '';
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

function defaultEnabledFor(state: ItemState): boolean {
  // Default off only when explicitly disabled; otherwise default on.
  return state.kind !== 'disabled';
}
