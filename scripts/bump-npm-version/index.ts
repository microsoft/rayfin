#!/usr/bin/env node
/**
 * scripts/bump-npm-version/index.ts
 *
 * Deterministic replacement for the prompt at
 * `.github/prompts/bump-npm-version.prompt.md`.
 *
 * Drives the full Rayfin coordinated-release flow:
 *   preflight → bumpVersions → stripSkipCi → commitBump →
 *   formatAndLint → commitFormat → push (opt-in) → openPr (opt-in)
 *
 * Run with:
 *   npm run bump:npm -- [flags]
 *
 * Or, equivalently:
 *   node common/scripts/install-run.js tsx\@4.21.0 tsx scripts/bump-npm-version/index.ts [flags]
 *
 * The script is locally-safe by default. Pushing (`--push`) and PR creation
 * (`--pr`) are opt-in. `--pr` requires `--push` and `--issue <N>`.
 *
 * See the README at `scripts/bump-npm-version/README.md` for full docs.
 */

import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const PHASES = [
  'preflight',
  'bumpVersions',
  'stripSkipCi',
  'commitBump',
  'formatAndLint',
  'commitFormat',
  'push',
  'openPr',
] as const;
type Phase = (typeof PHASES)[number];

const TSX_PACKAGE = 'tsx@4.21.0';

interface Args {
  targetVersion?: string;
  push: boolean;
  pr: boolean;
  issue?: number;
  skipRebuild: boolean;
  fromPhase?: Phase;
  dryRun: boolean;
  withLlmNarrative: boolean;
}

interface RushProject {
  packageName: string;
  projectFolder: string;
  versionPolicyName?: string;
  shouldPublish?: boolean;
  subspaceName?: string;
}

interface Ctx {
  args: Args;
  repoRoot: string;
  currentBranch: string;
  preBumpHead: string;
  publishablePackages: RushProject[];
  stateFile: string;
}

interface RunState {
  currentBranch: string;
  preBumpHead: string;
}

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

const COLOR = process.stdout.isTTY;
const c = {
  bold: (s: string) => (COLOR ? `\x1b[1m${s}\x1b[0m` : s),
  dim: (s: string) => (COLOR ? `\x1b[2m${s}\x1b[0m` : s),
  red: (s: string) => (COLOR ? `\x1b[31m${s}\x1b[0m` : s),
  green: (s: string) => (COLOR ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (COLOR ? `\x1b[33m${s}\x1b[0m` : s),
  cyan: (s: string) => (COLOR ? `\x1b[36m${s}\x1b[0m` : s),
};

function info(msg: string): void {
  console.log(c.cyan('› ') + msg);
}
function ok(msg: string): void {
  console.log(c.green('✓ ') + msg);
}
function warn(msg: string): void {
  console.log(c.yellow('! ') + msg);
}
function header(msg: string): void {
  console.log('\n' + c.bold(c.cyan('═ ' + msg)) + '\n');
}
function die(msg: string): never {
  console.error(c.red('✗ ') + msg);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------

interface RunOptions {
  cwd?: string;
  /** When true, return stdout instead of streaming. */
  capture?: boolean;
  /** When true, do not throw on non-zero exit. */
  allowFailure?: boolean;
  /** Override the global dry-run flag (e.g. for read-only commands). */
  forceRun?: boolean;
  env?: Record<string, string | undefined>;
}

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

let dryRun = false;

function quote(arg: string): string {
  if (/^[A-Za-z0-9_\-./@:=]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

function run(cmd: string, argv: string[], opts: RunOptions = {}): RunResult {
  const display = [cmd, ...argv].map(quote).join(' ');
  const cwdDisplay = opts.cwd
    ? c.dim(`(${relative(process.cwd(), opts.cwd) || '.'})`)
    : '';
  console.log(c.dim('$ ') + display + (cwdDisplay ? ' ' + cwdDisplay : ''));

  if (dryRun && !opts.forceRun) {
    return { status: 0, stdout: '', stderr: '' };
  }

  const spawnOpts: SpawnSyncOptions = {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
  };
  const result = spawnSync(cmd, argv, spawnOpts);

  if (result.error) {
    if (opts.allowFailure) {
      return { status: 1, stdout: '', stderr: String(result.error) };
    }
    die(`Failed to launch ${cmd}: ${result.error.message}`);
  }

  const status = result.status ?? 1;
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';

  if (status !== 0 && !opts.allowFailure) {
    if (opts.capture) {
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
    }
    die(`Command failed (exit ${status}): ${display}`);
  }

  return { status, stdout, stderr };
}

function git(args: string[], opts: RunOptions = {}): RunResult {
  return run('git', args, opts);
}

function gitCapture(args: string[], opts: RunOptions = {}): string {
  return git(args, { ...opts, capture: true, forceRun: true }).stdout.trim();
}

// ---------------------------------------------------------------------------
// JSON / JSONC helpers
// ---------------------------------------------------------------------------

/** Strip // and /* *\/ comments from a JSONC string. Naive but sufficient for Rush configs. */
function stripJsonComments(input: string): string {
  let out = '';
  let i = 0;
  const n = input.length;
  let inString = false;
  let stringQuote = '';

  while (i < n) {
    const ch = input[i];
    const next = input[i + 1];

    if (inString) {
      out += ch;
      if (ch === '\\' && i + 1 < n) {
        out += input[i + 1];
        i += 2;
        continue;
      }
      if (ch === stringQuote) inString = false;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = ch;
      out += ch;
      i++;
      continue;
    }

    if (ch === '/' && next === '/') {
      while (i < n && input[i] !== '\n') i++;
      continue;
    }

    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(input[i] === '*' && input[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    out += ch;
    i++;
  }

  // Remove trailing commas before } or ]
  return out.replace(/,(\s*[}\]])/g, '$1');
}

function readJsonc<T>(path: string): T {
  return JSON.parse(stripJsonComments(readFileSync(path, 'utf8'))) as T;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function writeJsonPreservingTrailingNewline(
  path: string,
  value: unknown
): void {
  const original = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const hasTrailingNewline = original.endsWith('\n');
  let text = JSON.stringify(value, null, 2);
  if (hasTrailingNewline) text += '\n';
  writeFileSync(path, text, 'utf8');
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function printUsageAndExit(code = 0): never {
  console.log(`
${c.bold('bump-npm-version')} — coordinated Rayfin package version bump

Usage:
  npm run bump:npm -- [flags]
  (equivalently: node common/scripts/install-run.js ${TSX_PACKAGE} tsx scripts/bump-npm-version/index.ts [flags])

Flags:
  --target-version <semver>   Pin typescript-sdk lockstep to this stable version.
                              Individual-version policies (cli, mcp, docs, guide, host-docs)
                              still auto-bump from changefiles.
  --push                      Push the branch when done. Default: false.
  --pr                        Open a PR. Requires --push and --issue.
  --issue <N>                 GitHub issue number to link with Closes #N and to auto-assign
                              its author. Required when --pr is set.
  --with-llm-narrative        When --pr is set, use scripts/bump-npm-version/bump-pr-narrative.genai.mts
                              to polish the PR title/body. Optional; no-op without --pr.
  --skip-rebuild              Skip 'rush rebuild' in preflight.
  --from <phase>              Resume from a specific phase. Phases:
                              ${PHASES.join(', ')}
  --dry-run                   Print every command without executing side effects.
  --help                      Show this message.

Examples:
  # Local-only bump using changefiles already on the branch:
  npm run bump:npm

  # Pin lockstep version, push, and open a PR linked to issue 1234:
  npm run bump:npm -- \\
      --target-version 1.31.0 --push --pr --issue 1234
`);
  process.exit(code);
}

function parseCliArgs(): Args {
  let parsed: ReturnType<typeof parseArgs<Record<string, never>>>;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      options: {
        'target-version': { type: 'string' },
        push: { type: 'boolean', default: false },
        pr: { type: 'boolean', default: false },
        issue: { type: 'string' },
        'with-llm-narrative': { type: 'boolean', default: false },
        'skip-rebuild': { type: 'boolean', default: false },
        from: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
      allowPositionals: false,
      strict: true,
    }) as ReturnType<typeof parseArgs<Record<string, never>>>;
  } catch (err) {
    console.error(
      c.red('✗ ') + (err instanceof Error ? err.message : String(err))
    );
    printUsageAndExit(2);
  }

  const v = parsed.values as Record<string, string | boolean | undefined>;
  if (v.help) printUsageAndExit(0);

  const args: Args = {
    targetVersion:
      typeof v['target-version'] === 'string' ? v['target-version'] : undefined,
    push: v.push === true,
    pr: v.pr === true,
    issue: typeof v.issue === 'string' ? Number(v.issue) : undefined,
    skipRebuild: v['skip-rebuild'] === true,
    fromPhase: typeof v.from === 'string' ? (v.from as Phase) : undefined,
    dryRun: v['dry-run'] === true,
    withLlmNarrative: v['with-llm-narrative'] === true,
  };

  // Validation
  if (args.targetVersion && !isValidTargetVersion(args.targetVersion)) {
    die(
      `--target-version must be MAJOR.MINOR.PATCH with no prerelease or build metadata (got "${args.targetVersion}").`
    );
  }
  if (args.pr && !args.push) {
    die('--pr requires --push.');
  }
  if (
    args.pr &&
    (args.issue === undefined || Number.isNaN(args.issue) || args.issue <= 0)
  ) {
    die('--pr requires --issue <N> with a positive integer.');
  }
  if (args.withLlmNarrative && !args.pr) {
    warn('--with-llm-narrative has no effect without --pr; ignoring.');
    args.withLlmNarrative = false;
  }
  if (args.fromPhase && !PHASES.includes(args.fromPhase)) {
    die(`--from must be one of: ${PHASES.join(', ')}`);
  }

  return args;
}

function isValidTargetVersion(v: string): boolean {
  // Prerelease/build versions are intentionally unsupported because this
  // release workflow coordinates stable package versions across policies.
  return /^\d+\.\d+\.\d+$/.test(v);
}

function compareSemver(a: string, b: string): number {
  const parse = (v: string): [number, number, number] => {
    const core = v.split('-')[0]!.split('+')[0]!;
    const [maj, min, pat] = core.split('.').map((s) => Number(s));
    return [maj ?? 0, min ?? 0, pat ?? 0];
  };
  const [am, ai, ap] = parse(a);
  const [bm, bi, bp] = parse(b);
  if (am !== bm) return am - bm;
  if (ai !== bi) return ai - bi;
  return ap - bp;
}

// ---------------------------------------------------------------------------
// Repo helpers
// ---------------------------------------------------------------------------

function findRepoRoot(start: string): string {
  let cur = start;
  while (true) {
    if (existsSync(join(cur, 'rush.json'))) return cur;
    const parent = dirname(cur);
    if (parent === cur)
      die('Could not locate rush.json in any parent directory.');
    cur = parent;
  }
}

function readPublishablePackages(repoRoot: string): RushProject[] {
  const rushJson = readJsonc<{ projects: RushProject[] }>(
    join(repoRoot, 'rush.json')
  );
  return rushJson.projects.filter((p) => p.shouldPublish !== false);
}

function getStateFile(repoRoot: string): string {
  const gitPath = gitCapture([
    '-C',
    repoRoot,
    'rev-parse',
    '--git-path',
    'rayfin-bump-npm-version-state.json',
  ]);
  return isAbsolute(gitPath) ? gitPath : join(repoRoot, gitPath);
}

function writeRunState(ctx: Ctx): void {
  if (dryRun) return;
  const state: RunState = {
    currentBranch: ctx.currentBranch,
    preBumpHead: ctx.preBumpHead,
  };
  writeJsonPreservingTrailingNewline(ctx.stateFile, state);
}

function loadRunState(ctx: Ctx): void {
  if (!existsSync(ctx.stateFile)) {
    die(
      `Cannot resume without ${relative(ctx.repoRoot, ctx.stateFile)}. Re-run from preflight, or restore the state file from the failed run.`
    );
  }
  const state = readJson<RunState>(ctx.stateFile);
  if (state.currentBranch !== ctx.currentBranch) {
    die(
      `Saved bump state is for branch "${state.currentBranch}", but current branch is "${ctx.currentBranch}".`
    );
  }
  if (!state.preBumpHead) {
    die('Saved bump state does not contain a pre-bump HEAD SHA.');
  }
  ctx.preBumpHead = state.preBumpHead;
  ok(`Loaded pre-bump HEAD from saved state: ${ctx.preBumpHead.slice(0, 12)}`);
}

// ---------------------------------------------------------------------------
// Phase: preflight
// ---------------------------------------------------------------------------

function phasePreflight(ctx: Ctx): void {
  header('Phase 1 — Preflight');

  // Refuse on main / detached HEAD.
  if (ctx.currentBranch === 'main' || ctx.currentBranch === '') {
    die(`Refusing to run on branch "${ctx.currentBranch || '(detached)'}".`);
  }

  // Refuse on a `version/bump-*` branch — these are auto-generated by older
  // rush version --bump invocations that included `-b`. If the user is on one,
  // a previous attempt failed mid-flight and they should recover before
  // re-running. See README “Recovering from a stuck `version/bump-*` branch”.
  if (/^version\/bump-/.test(ctx.currentBranch)) {
    die(
      `Refusing to run on auto-generated rush branch "${ctx.currentBranch}". ` +
        'A previous bump attempt left the repo on this temp branch. ' +
        'Discard or rebase its commits, switch back to your working branch, ' +
        'delete this branch (local + remote if pushed), then re-run. ' +
        'See scripts/bump-npm-version/README.md for the recovery steps.'
    );
  }

  // Refuse if working tree dirty.
  const status = gitCapture(['status', '--porcelain']);
  if (status.length > 0) {
    die(`Working tree is not clean. Commit or stash changes first.\n${status}`);
  }

  run('rush', ['update'], { cwd: ctx.repoRoot });

  if (ctx.args.skipRebuild) {
    warn('Skipping rush rebuild (--skip-rebuild).');
  } else {
    run('rush', ['rebuild'], { cwd: ctx.repoRoot });
  }

  ctx.preBumpHead = gitCapture(['rev-parse', 'HEAD']);
  writeRunState(ctx);
  ok(`Pre-bump HEAD: ${ctx.preBumpHead.slice(0, 12)}`);
}

// ---------------------------------------------------------------------------
// Phase: bumpVersions
// ---------------------------------------------------------------------------

function phaseBumpVersions(ctx: Ctx): void {
  header('Phase 2 — Bump versions');

  if (ctx.args.targetVersion) {
    pinLockstepVersion(ctx, ctx.args.targetVersion);
  }

  // We deliberately do NOT pass `-b <branch>` here. With `-b`, rush version
  // --bump auto-creates a `version/bump-<timestamp>` branch, emits two
  // `[skip ci]` commits, then tries to `git checkout` the target branch to
  // merge — which fails (and leaves the repo on the temp branch with dirty
  // CHANGELOGs) whenever its expected pre/post state isn't pristine. Without
  // `-b`, rush only mutates files in the working tree; Phase 4 commits them
  // deterministically. Phase 3 remains a safety net for legacy resume cases.
  run('rush', ['version', '--bump'], {
    cwd: ctx.repoRoot,
  });
}

interface VersionPolicy {
  policyName: string;
  definitionName: 'lockStepVersion' | 'individualVersion';
  version?: string;
  nextBump?: string;
  lockedMajor?: number;
  includeEmailInChangeFile?: boolean;
}

function pinLockstepVersion(ctx: Ctx, target: string): void {
  const path = join(ctx.repoRoot, 'common/config/rush/version-policies.json');
  const policies = readJsonc<VersionPolicy[]>(path);
  const lockstep = policies.find((p) => p.policyName === 'typescript-sdk');
  if (!lockstep)
    die('Could not find "typescript-sdk" policy in version-policies.json.');
  if (lockstep.definitionName !== 'lockStepVersion') {
    die('"typescript-sdk" policy is not a lockStepVersion policy.');
  }
  const current = lockstep.version ?? '0.0.0';
  if (compareSemver(target, current) < 0) {
    die(
      `--target-version ${target} is lower than current lockstep version ${current}.`
    );
  }
  if (compareSemver(target, current) === 0) {
    info(`Lockstep version already at ${target}; nothing to pin.`);
    return;
  }

  // Patch only the typescript-sdk policy's `version` field; preserve all
  // surrounding JSONC formatting (including comments) by doing a targeted
  // textual replacement rather than a full JSON rewrite.
  if (dryRun) {
    info(
      `(dry-run) Would set typescript-sdk version "${current}" → "${target}" in ${relative(ctx.repoRoot, path)}`
    );
    return;
  }
  const raw = readFileSync(path, 'utf8');
  const blockRe = /(\{[^}]*"policyName"\s*:\s*"typescript-sdk"[^}]*\})/m;
  const block = raw.match(blockRe);
  if (!block)
    die(
      'Could not locate typescript-sdk policy block in version-policies.json.'
    );
  const patched = block[0].replace(
    /("version"\s*:\s*")([^"]+)(")/,
    (_m, p1, _old, p3) => `${p1}${target}${p3}`
  );
  const out = raw.replace(blockRe, patched);
  writeFileSync(path, out, 'utf8');
  ok(`Pinned typescript-sdk lockstep version: ${current} → ${target}`);
}

// ---------------------------------------------------------------------------
// Phase: stripSkipCi
// ---------------------------------------------------------------------------

const SKIP_CI_RE =
  /\[(skip[ _-]ci|ci[ _-]skip|no[ _-]ci|skip[ _-]actions)\]|\*\*\*NO_CI\*\*\*/gi;

function phaseStripSkipCi(ctx: Ctx): void {
  header('Phase 3 — Strip [skip ci] markers');

  if (dryRun) {
    info(
      '(dry-run) Would inspect commits in preBumpHead..HEAD and reword any containing forbidden markers.'
    );
    return;
  }

  const range = `${ctx.preBumpHead}..HEAD`;
  const shas = gitCapture(['rev-list', '--reverse', range])
    .split('\n')
    .filter(Boolean);

  if (shas.length === 0) {
    info('No commits added by rush version --bump; nothing to scan.');
    return;
  }

  const cleanedMessages = new Map<string, string>();
  for (const sha of shas) {
    const msg = gitCapture(['log', '-1', '--pretty=%B', sha]);
    if (SKIP_CI_RE.test(msg)) {
      // Reset state because of /g flag.
      SKIP_CI_RE.lastIndex = 0;
      const cleaned =
        msg
          .replace(SKIP_CI_RE, '')
          .replace(/[ \t]+\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim() + '\n';
      cleanedMessages.set(sha, cleaned);
    }
    SKIP_CI_RE.lastIndex = 0;
  }

  if (cleanedMessages.size === 0) {
    ok('No [skip ci] markers found in newly created commits.');
    return;
  }

  info(`Rewriting ${cleanedMessages.size} commit message(s)...`);

  // Use `git filter-branch --msg-filter` over the limited range. It is
  // deprecated but built-in and trivially scoped to one rev range.
  const messagesDir = join(ctx.repoRoot, '.git', 'tmp-bump-msgs');
  mkdirSync(messagesDir, { recursive: true });
  for (const [sha, msg] of cleanedMessages) {
    writeFileSync(join(messagesDir, sha), msg, 'utf8');
  }

  const msgFilter = `
sha=$(git rev-parse "$GIT_COMMIT");
if [ -f "${messagesDir}/$sha" ]; then
  cat "${messagesDir}/$sha";
else
  cat;
fi
`.trim();

  // filter-branch refuses by default if a backup ref exists; clean it first.
  git(['update-ref', '-d', 'refs/original/refs/heads/' + ctx.currentBranch], {
    allowFailure: true,
  });

  run(
    'git',
    [
      'filter-branch',
      '-f',
      '--msg-filter',
      msgFilter,
      `${ctx.preBumpHead}..HEAD`,
    ],
    {
      cwd: ctx.repoRoot,
      env: { ...process.env, FILTER_BRANCH_SQUELCH_WARNING: '1' },
    }
  );

  // Verify zero matches remain.
  const after = gitCapture(['log', `${ctx.preBumpHead}..HEAD`, '--pretty=%B']);
  if (SKIP_CI_RE.test(after)) {
    SKIP_CI_RE.lastIndex = 0;
    die('[skip ci] markers still present after rewrite. Aborting before push.');
  }
  SKIP_CI_RE.lastIndex = 0;
  ok('All [skip ci] markers removed from new commits.');
}

// ---------------------------------------------------------------------------
// Phase: commitBump
// ---------------------------------------------------------------------------

function phaseCommitBump(ctx: Ctx): void {
  header('Phase 4 — Commit bump');

  git(['add', '-A'], { cwd: ctx.repoRoot });
  if (workingTreeHasStagedChanges(ctx)) {
    git(['commit', '-m', 'chore: bump versions'], { cwd: ctx.repoRoot });
    ok('Committed: chore: bump versions');
  } else {
    info('No staged changes to commit; skipping bump commit.');
  }
}

function workingTreeHasStagedChanges(ctx: Ctx): boolean {
  if (dryRun) return true;
  const result = git(['diff', '--cached', '--quiet'], {
    cwd: ctx.repoRoot,
    allowFailure: true,
    capture: true,
    forceRun: true,
  });
  return result.status !== 0;
}

// ---------------------------------------------------------------------------
// Phase: formatAndLint
// ---------------------------------------------------------------------------

function phaseFormatAndLint(ctx: Ctx): void {
  header('Phase 5 — Format & lint');
  run('rush', ['format'], { cwd: ctx.repoRoot });
  run('rush', ['docs:lint', '--fix'], { cwd: ctx.repoRoot });
}

// ---------------------------------------------------------------------------
// Phase: commitFormat
// ---------------------------------------------------------------------------

function phaseCommitFormat(ctx: Ctx): void {
  header('Phase 6 — Commit formatting changes');
  git(['add', '-A'], { cwd: ctx.repoRoot });
  if (workingTreeHasStagedChanges(ctx)) {
    git(['commit', '-m', 'chore: format after version bump'], {
      cwd: ctx.repoRoot,
    });
    ok('Committed: chore: format after version bump');
  } else {
    info('No formatting changes to commit.');
  }
}

// ---------------------------------------------------------------------------
// Phase: push
// ---------------------------------------------------------------------------

function phasePush(ctx: Ctx): void {
  header('Phase 7 — Push');
  if (!ctx.args.push) {
    info(`--push not set. To push manually run:`);
    console.log(`    git push origin ${ctx.currentBranch}`);
    return;
  }
  git(['push', 'origin', ctx.currentBranch], { cwd: ctx.repoRoot });
  ok(`Pushed ${ctx.currentBranch}`);
}

// ---------------------------------------------------------------------------
// Phase: openPr
// ---------------------------------------------------------------------------

function phaseOpenPr(ctx: Ctx): void {
  header('Phase 8 — Open pull request');
  if (!ctx.args.pr) {
    info('--pr not set; skipping PR creation.');
    return;
  }
  if (ctx.args.issue === undefined) die('--pr requires --issue.');

  // Resolve issue author for assignment.
  const assignee = ctx.args.dryRun
    ? '<issue-author>'
    : tryGhCapture(
        [
          'issue',
          'view',
          String(ctx.args.issue),
          '--json',
          'author',
          '-q',
          '.author.login',
        ],
        ctx
      );

  const summary = buildBumpSummary(ctx);
  let title = `chore: bump packages${ctx.args.targetVersion ? ` to ${ctx.args.targetVersion}` : ''}`;
  let body = renderPrBody(ctx, summary);

  if (ctx.args.withLlmNarrative) {
    const polished = tryRunLlmNarrative(ctx, { title, body, summary });
    if (polished) {
      title = polished.title || title;
      body = polished.body || body;
    } else {
      warn('LLM narrative hook returned no output; using templated body.');
    }
  }

  const ghArgs = [
    'pr',
    'create',
    '--base',
    'main',
    '--head',
    ctx.currentBranch,
    '--title',
    title,
    '--body',
    body,
  ];
  if (assignee && assignee !== '<issue-author>') {
    ghArgs.push('--assignee', assignee);
  }
  run('gh', ghArgs, { cwd: ctx.repoRoot });
  ok(`Opened PR (assignee: ${assignee})`);
}

function tryGhCapture(argv: string[], ctx: Ctx): string {
  const result = run('gh', argv, {
    cwd: ctx.repoRoot,
    capture: true,
    allowFailure: true,
  });
  if (result.status !== 0) {
    warn(`gh ${argv.join(' ')} failed; continuing without assignee.`);
    return '';
  }
  return result.stdout.trim();
}

interface BumpSummary {
  packages: Array<{ name: string; version: string }>;
}

function buildBumpSummary(ctx: Ctx): BumpSummary {
  const packages: Array<{ name: string; version: string }> = [];
  for (const pkg of ctx.publishablePackages) {
    const pkgJsonPath = join(ctx.repoRoot, pkg.projectFolder, 'package.json');
    try {
      const j = readJson<{ name: string; version: string }>(pkgJsonPath);
      packages.push({ name: j.name, version: j.version });
    } catch {
      // ignore — pkg may not have a package.json yet
    }
  }
  return { packages };
}

function renderPrBody(ctx: Ctx, summary: BumpSummary): string {
  const lines: string[] = [];
  lines.push(
    `Coordinated version bump${ctx.args.targetVersion ? ` to \`${ctx.args.targetVersion}\`` : ''}.`
  );
  lines.push('');
  lines.push('## Bumped packages');
  lines.push('');
  lines.push('| Package | Version |');
  lines.push('| --- | --- |');
  for (const p of summary.packages) {
    lines.push(`| \`${p.name}\` | \`${p.version}\` |`);
  }
  lines.push('');
  lines.push(`Closes #${ctx.args.issue}.`);
  lines.push('');
  return lines.join('\n');
}

function tryRunLlmNarrative(
  ctx: Ctx,
  input: { title: string; body: string; summary: BumpSummary }
): { title?: string; body?: string } | undefined {
  const script = join(
    ctx.repoRoot,
    'scripts',
    'bump-npm-version',
    'bump-pr-narrative.genai.mts'
  );
  if (!existsSync(script)) {
    warn(
      `LLM hook script not found at ${relative(ctx.repoRoot, script)}; skipping.`
    );
    return undefined;
  }
  const result = run('npx', ['--yes', 'genaiscript', 'run', script], {
    cwd: ctx.repoRoot,
    capture: true,
    allowFailure: true,
    env: {
      ...process.env,
      BUMP_TITLE: input.title,
      BUMP_BODY: input.body,
      BUMP_SUMMARY: JSON.stringify(input.summary),
    },
  });
  if (result.status !== 0) return undefined;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

const PHASE_FNS: Record<Phase, (ctx: Ctx) => void> = {
  preflight: phasePreflight,
  bumpVersions: phaseBumpVersions,
  stripSkipCi: phaseStripSkipCi,
  commitBump: phaseCommitBump,
  formatAndLint: phaseFormatAndLint,
  commitFormat: phaseCommitFormat,
  push: phasePush,
  openPr: phaseOpenPr,
};

function main(): void {
  const args = parseCliArgs();
  dryRun = args.dryRun;

  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = findRepoRoot(here);
  const currentBranch = gitCapture([
    '-C',
    repoRoot,
    'branch',
    '--show-current',
  ]);
  const publishablePackages = readPublishablePackages(repoRoot);
  const stateFile = getStateFile(repoRoot);

  const ctx: Ctx = {
    args,
    repoRoot,
    currentBranch,
    preBumpHead: '',
    publishablePackages,
    stateFile,
  };

  if (args.dryRun) warn('DRY RUN — no side effects will be applied.');

  info(`Repo: ${repoRoot}`);
  info(`Branch: ${currentBranch}`);
  info(`Publishable packages: ${publishablePackages.length}`);
  if (args.targetVersion)
    info(`Target lockstep version: ${args.targetVersion}`);

  const startIndex = args.fromPhase ? PHASES.indexOf(args.fromPhase) : 0;
  if (startIndex < 0) die(`Unknown phase: ${args.fromPhase}`);
  if (startIndex > 0) loadRunState(ctx);

  for (let i = startIndex; i < PHASES.length; i++) {
    const phase = PHASES[i]!;
    PHASE_FNS[phase](ctx);
  }

  console.log('\n' + c.green(c.bold('✔ Done.')));
}

main();
