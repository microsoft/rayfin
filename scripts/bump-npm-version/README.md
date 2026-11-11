# bump-npm-version

Deterministic, scriptable version-bump for the Rayfin monorepo.

This script replaces the long English prompt at
[../../.github/prompts/bump-npm-version.prompt.md](../../.github/prompts/bump-npm-version.prompt.md).
It exists because LLM-driven multi-step release workflows are inconsistent:
the same prompt produces different commits, missed phases, or forbidden
`[skip ci]` markers depending on which agent runs it.
Everything that can be deterministic is.
The only optional LLM touchpoint is a single GenAIScript hook that polishes
the PR title and body, and it is off by default.

## Contents

- [Prerequisites](#prerequisites)
- [Quickstart](#quickstart)
- [Flags](#flags)
- [How it works](#how-it-works)
- [The `[skip ci]` rule](#the-skip-ci-rule)
- [Resuming after a failure](#resuming-after-a-failure)
- [Optional LLM hook](#optional-llm-hook)
- [Troubleshooting](#troubleshooting)
- [Extending the script](#extending-the-script)

## Prerequisites

- Node.js 20 or later (matches [rush.json](../../rush.json)).
- A clean, committed working tree on a non-`main` branch.
- `rush` available on `PATH` (already true for this monorepo).
- Access to the npm registry for the pinned `tsx` runner installed by
  [../../common/scripts/install-run.js](../../common/scripts/install-run.js).
- For `--pr`: the GitHub CLI (`gh`) authenticated against
  `microsoft/project-rayfin` with PR-create permissions.
- For `--with-llm-narrative`: an environment configured for
  [GenAIScript](https://microsoft.github.io/genaiscript/).
  This is optional and never required for the core flow.

The script auto-discovers publishable packages by reading
[../../rush.json](../../rush.json) and filtering entries where
`shouldPublish !== false`.
You do not need to keep a separate list in sync.

## Quickstart

### Local-only bump

This is the default.
It commits locally but does not push or open a PR.

```bash
npm run bump:npm
```

### Coordinated release with explicit version, push, and PR

```bash
npm run bump:npm -- \
    --target-version 1.31.0 \
    --push \
    --pr \
    --issue 1234
```

`--pr` requires `--push` and `--issue <N>`.
The script resolves the issue's author through `gh issue view` and assigns
them automatically.
`Closes #<N>` is appended to the PR body.

### Dry run

The dry run prints every command the script would execute without applying
mutating side effects.
Read-only git commands such as `git status` and `git rev-parse HEAD` still run
so the diagnostics are accurate.

```bash
npm run bump:npm -- --dry-run --skip-rebuild
```

## Flags

Run `npm run bump:npm -- --help` for the canonical list.
Summary:

| Flag | Default | Purpose |
| --- | --- | --- |
| `--target-version <semver>` | unset | Pin the `typescript-sdk` lockstep policy in [../../common/config/rush/version-policies.json](../../common/config/rush/version-policies.json) to this exact stable version. Individual-version policies (`cli`, `rayfin-mcp`, `rayfin-docs`, `rayfin-guide`, `rayfin-host-docs`) still auto-bump from existing changefiles. |
| `--push` | `false` | Push the current branch after all commits are in place. |
| `--pr` | `false` | Open a PR via `gh`. Requires `--push` and `--issue`. |
| `--issue <N>` | unset | GitHub issue number to link with `Closes #N` and to auto-assign its author. Required when `--pr` is set. |
| `--with-llm-narrative` | `false` | When `--pr` is set, hand the templated PR title and body to [bump-pr-narrative.genai.mts](bump-pr-narrative.genai.mts) for polishing. No-op without `--pr`. |
| `--skip-rebuild` | `false` | Skip `rush rebuild` during preflight. Useful when you have just built the workspace. |
| `--from <phase>` | `preflight` | Resume from a named phase after a failure. See the [phase list](#how-it-works). |
| `--dry-run` | `false` | Print every command without applying mutating side effects. |
| `--help` | — | Print usage and exit. |

### Flag validation

The script fails fast on invalid combinations:

- `--target-version` must match `MAJOR.MINOR.PATCH`.
- Prerelease and build metadata targets are not supported.
- `--target-version` cannot be lower than the current `typescript-sdk`
  lockstep version.
- `--pr` requires `--push`.
- `--pr` requires `--issue <N>` with a positive integer.
- `--from <phase>` must name a known phase.

## How it works

The script runs eight named phases sequentially.
Each phase logs a header and is small enough to reason about in isolation.

| # | Phase | What it does |
| --- | --- | --- |
| 1 | `preflight` | Refuses to run on `main`, on a detached HEAD, or with a dirty working tree. Runs `rush update` and `rush rebuild` (skippable). Captures the pre-bump HEAD SHA and saves it under `.git` for resumed runs. |
| 2 | `bumpVersions` | If `--target-version` is set, edits only the `version` field of the `typescript-sdk` lockstep entry in [../../common/config/rush/version-policies.json](../../common/config/rush/version-policies.json) via a targeted regex (preserving JSONC comments and surrounding formatting). Then runs `rush version --bump` (deliberately without `-b <branch>` — see below). |
| 3 | `stripSkipCi` | Inspects every commit in `preBumpHead..HEAD` for forbidden markers (`[skip ci]`, `[ci skip]`, `[no ci]`, `[skip actions]`, `***NO_CI***`). Rewrites only those commits using `git filter-branch --msg-filter` scoped to the same range. Aborts if any marker remains. |
| 4 | `commitBump` | Stages everything and commits with `chore: bump versions`. Skips silently if nothing is staged. |
| 5 | `formatAndLint` | Runs `rush format` then `rush docs:lint --fix`. |
| 6 | `commitFormat` | Stages everything and commits with `chore: format after version bump`. Skips silently if nothing changed. |
| 7 | `push` | Pushes the branch when `--push` is set. Otherwise prints the exact command for manual use. |
| 8 | `openPr` | Opens a PR when `--pr` is set. Resolves the assignee via `gh issue view <N> --json author -q .author.login`. Body includes a bumped-package table and `Closes #<N>`. |

## The `[skip ci]` rule

`rush version --bump` historically auto-generates commits like
`Update changelogs [skip ci]`.
The `[skip ci]` marker is forbidden in this repository because it bypasses
required CI on the release commits themselves.

Phase 3 enforces this rule deterministically:

1. It only ever inspects commits in `preBumpHead..HEAD`.
2. It builds a map of `sha → cleaned-message` for any commit that matches the
   forbidden regex.
3. It uses `git filter-branch --msg-filter` over the same range to substitute
   the cleaned messages.
4. It re-greps the rewritten range and aborts if any marker remains.

You should never need to invoke `git filter-branch` or `git rebase --reword`
manually for this rule.

## Resuming after a failure

If any phase fails, fix the underlying issue and resume from that phase:

```bash
npm run bump:npm -- --from commitBump --skip-rebuild
```

Re-running earlier phases is generally idempotent (`rush update`,
`rush rebuild`, formatting, lint), but Phase 2 will refuse to re-pin the
lockstep version if it is already at the target.
Phase 4 and Phase 6 skip silently when their staging step produces no diff,
so they are safe to repeat.
The preflight phase writes the pre-bump HEAD SHA to a private state file under
`.git`.
Resume runs load that state so skip-CI scanning continues to inspect the same
commit range.
If the state file is missing, resume from `preflight`.

## Optional LLM hook

The script is fully deterministic on its own.
The only optional LLM touchpoint is [bump-pr-narrative.genai.mts](bump-pr-narrative.genai.mts),
invoked only when both `--pr` and `--with-llm-narrative` are passed.

The hook receives the templated PR `title`, `body`, and a JSON `summary` of
the bumped packages through environment variables and is expected to return
a JSON object `{ title, body }` on stdout.
If the hook is missing, fails to launch, or returns invalid JSON, the
deterministic templated body is used instead.

The hook never executes filesystem or git commands.
It only polishes wording.
This means the worst-case failure mode of the LLM step is a slightly less
pretty PR body.

## Troubleshooting

### "Working tree is not clean"

Stash or commit local changes.
The script refuses to mix unrelated edits into a release commit.

### "Refusing to run on branch `main`"

Create a branch:

```bash
git switch -c release/bump-$(date +%Y%m%d)
```

### `gh` is not installed

Skip `--pr`.
The bump itself runs without it.
Push the branch and open the PR via the GitHub UI.

### Lockstep pin refused

The script will not lower the `typescript-sdk` version below its current
value.
Pick a value greater than or equal to whatever is in
[../../common/config/rush/version-policies.json](../../common/config/rush/version-policies.json).

### Why this script doesn't pass `-b` to `rush version --bump`

The rush docs describe `-b BRANCH` as
*"changes will be committed and merged into the target branch."*
In practice rush does this by creating a temporary `version/bump-<timestamp>`
branch, emitting two `[skip ci]` commits on it, then running `git checkout` on
the target branch to merge.
That checkout fails whenever the working tree has any unexpected diffs (for
example, after a fresh `git merge main` that brings CHANGELOG updates), which
leaves the repo stuck on the temp branch with uncommitted modifications.

This script instead invokes plain `rush version --bump` (no `-b`).
Rush only mutates the working tree; Phase 4 commits the result.
Phase 3 (`stripSkipCi`) is kept as a safety net for legacy resume scenarios.

### Recovering from a stuck `version/bump-*` branch

If an older bump run (or a run from a version of this script that passed `-b`)
left you on an auto-generated `version/bump-<timestamp>` branch, the script
refuses to start in preflight.

To recover:

```bash
# 1. Discard any uncommitted CHANGELOG / package.json modifications:
git reset --hard HEAD

# 2. Capture the original working branch name (NOT a version/bump-* branch):
ORIGINAL_BRANCH=<your-feature-branch>

# 3. Switch back to it:
git checkout "$ORIGINAL_BRANCH"

# 4. Delete the temp branch locally (and on origin if it was pushed):
TEMP=$(git branch --list 'version/bump-*' | head -1 | tr -d ' *')
git branch -D "$TEMP"
git push origin --delete "$TEMP"  # only if it was pushed

# 5. Re-run with the current script:
npm run bump:npm
```

The two `[skip ci]` commits that rush created on the temp branch are not
worth salvaging — they would be rewritten by Phase 3 anyway, and Phase 2 of
the current script regenerates the same bumps deterministically.

## Extending the script

The script is a single TypeScript file at [index.ts](index.ts) using only
Node.js built-ins plus a pinned `tsx` runner invoked through Rush's
`install-run.js` helper.

To add a phase:

1. Add its name to the `PHASES` tuple in [index.ts](index.ts).
2. Implement a `phaseMyName(ctx: Ctx): void` function.
3. Register it in the `PHASE_FNS` map.

Conventions to keep:

- Read-only commands (`git rev-parse`, `gh issue view`)
  must pass `forceRun: true` so they execute under `--dry-run`.
- Mutating commands should respect `--dry-run` by returning early or wrapping
  the side-effecting write in `if (dryRun) { ... return; }`.
- Never invoke an LLM from inside a core phase.
  The single approved LLM touchpoint is `tryRunLlmNarrative` in Phase 8.

## See also

- [../../.github/prompts/bump-npm-version.prompt.md](../../.github/prompts/bump-npm-version.prompt.md)
  — the prompt stub that points here.
- [../../.github/instructions/rush.instructions.md](../../.github/instructions/rush.instructions.md)
  — change-management rules this script follows.
- [../../common/config/rush/version-policies.json](../../common/config/rush/version-policies.json)
  — source of truth for lockstep and individual version policies.
- [../../rush.json](../../rush.json) — source of truth for publishable
  packages (`shouldPublish !== false`).
