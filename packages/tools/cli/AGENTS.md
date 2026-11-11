# Rayfin CLI agent notes

Agent instructions for working in `packages/tools/cli/` (`@microsoft/rayfin-cli`).

See [`packages/tools/AGENTS.md`](../AGENTS.md) for tools-wide conventions (ESM imports, `.js` specifiers, shared `@microsoft/rayfin-tools-common`).

## CLI Work (MANDATORY)

Any task that touches the Rayfin CLI — `packages/tools/cli/`, the `rayfin` command, or a new/changed command, subcommand, flag, output, error message, exit code, progress indicator, or interactive behavior — REQUIRES loading `.github/skills/rayfin-cli-ux/SKILL.md` BEFORE planning, drafting an OpenSpec proposal/spec/design/tasks, implementing, or reviewing the change. This is not optional and applies even when the user asks for "a quick fix."

- Load the skill at the start of the task. Do not rely on memory from prior turns.
- For OpenSpec changes touching the CLI, the change's `tasks.md` MUST begin with the mandatory pre-flight checklist defined in the skill's "Pre-flight Checklist" section.
- For implementation tasks, apply the skill's "Reviewing a Command" checklist before declaring the change done.
- For all CLI work, follow the constitutional rules in the skill (output modes, recovery hints, standard flags, `--force` gating, non-interactive behavior, `dev` vs `up` topology).

Skipping the skill is a defect. Pull requests and proposals missing the pre-flight block or the help-text/error-message conventions MUST be sent back for revision.

## Comments in `src/` ship to consumers

The shared tsconfig sets `removeComments: false`, so every comment in `packages/tools/cli/src/` is emitted verbatim into the published `dist/`. Consumers — and coding agents working inside a scaffolded app's `node_modules` — read it.

Keep rationale that explains _why_ a capability is hidden out of `src/`. Put it here instead. A comment saying a feature is gated, unsupported, or reachable via some flag is an advertisement for that feature, and it survives every other attempt to conceal it.

### Storage service gating

Rayfin storage is not enabled in the Fabric service. The CLI keeps it reachable but unadvertised:

- `rayfin dev storage` is registered only when `featureFlags.get('storage') === true` (`src/commands/dev/dev.ts`).
- The interactive service picker lists Storage only under the same flag.
- `rayfin init --help` describes `--services` as `(auth,data)`. Storage is intentionally absent from the help text.
- `--services storage` is accepted only when that same flag is on, matching the picker. Passing it otherwise fails `--services` validation like any unknown service.
- `rayfin init` emits a `storage` block into `rayfin.yml` only when the caller opted in. Scaffolded apps get no `storage:` key at all.

The flag self-activates from configuration: `createCliFeatureFlags` turns `storage` on whenever `services.storage.enabled === true` in `rayfin.yml` (`src/utils/feature-flags.ts`). So hand-editing that key remains a complete opt-in — it enables `rayfin dev storage`, the Azurite Docker profile, and the local storage apply, and it re-enables `--services storage` for later `rayfin init` runs in that project. `RAYFIN_FEATURE_FLAGS=storage` is the other way in.

The gate is therefore about discovery, not enforcement. It stops a fresh scaffold from reaching storage through an advertised flag; it does not prevent a Builder who deliberately writes the config from using it.

## Functions extension bundle compatibility

Local functions scaffolding and the Universal App functions capability kit require Preview `[4.49.0, 5.0.0)`, whose floor includes Fabric extension `1.0.121`, MSAL `4.80.0`, and the `FabricItemAttribute.AudienceScope` binding property.
This bundle fixes local sign-in on macOS with .NET 10 and on Windows when Core Tools is started by an agent without a console window.
Keep both local templates aligned.
Core Tools can reuse a cached bundle within the configured range without checking for updates, so the lower bound must exclude incompatible bundles.
Existing apps must update their local `host.json` separately; scaffolding changes do not migrate them.

Deployment substitutes `assets/functions/host.deploy.json` for the local host configuration.
Keep its stable bundle ID and independent `[4.38.1, 5.0.0)` floor, which includes Fabric extension `1.0.110`.
Do not copy Preview version numbers into the stable channel.
Bundle contents are documented in the [Preview 4.49.0 release](https://github.com/Azure/azure-functions-extension-bundles/releases/tag/4.49.0-Preview) and [stable 4.38.1 release](https://github.com/Azure/azure-functions-extension-bundles/releases/tag/4.38.1).
Binding metadata establishes property support, not an end-to-end ADO token test; verify target-ring bundle availability and token acquisition before shipping a floor change.

## Command entry points

`src/index.ts` owns command registration for both direct `init` and full-tree help.
It always registers `createInitCommand()` and imports the other command modules only when the invocation does not select init.
This avoids evaluating unrelated parent runtime settings without a separate init entry point.
Define root options in `src/root-command.ts` and all init options, subcommands, and actions in `src/commands/init.ts`.
The selector in `src/root-command.ts` only chooses which command modules to load.
Commander still validates option values and arguments.
Keep the selector's positive and negative cases covered, and preserve E2E parity between `init --help`, `init -h`, and `help init`, along with the full root help listing.

## Bundled template manifests

Templates may declare an ordered `template.features` list in their root `package.json`.
Each feature owns a relative file overlay under `.template-features/<feature>/`.
The shared post-scaffold pipeline applies overlays selected by `RAYFIN_FEATURE_FLAGS`, before installing dependencies, for bundled, local, and external templates.
Template feature selection reads only the invocation environment, never an enclosing project's deployment configuration or environment file.
The common CLI entry point defers unrelated runtime commands during `init`, preserving root flags, telemetry, and error handling without validating parent service settings.
It consumes the declaration and removes the authoring payload from the generated app in both enabled and disabled cases.
Overlay paths must remain inside the app and must not traverse links or tool-state directories.
Later enabled overlays win when two features author the same file.
Templates without the declaration are unchanged.

The Universal App declares `finley`.
The blueprint and live-activity plugin are always included; only companion code, styles, tests, and its entry-point wiring live in the optional overlay.

`scripts/bundle-templates.ts` preserves nested `package.json` files, including capability-kit projects.
Samples with an outer validation harness are bundled from their authoring `template/` directory, not from the harness or generated `target/`.
Apply the global and template-specific ignore rules before collecting nested manifests; do not restore files from excluded directories.
Reject included linked manifests before copying them; a copied symlink could redirect a later rewrite into the source template.
Inspect manifest links without dereferencing them so ignored dangling links remain skipped and included ones get a relative-path error.
Resolve `workspace:*` dependencies from the same workspace version map at every included manifest depth.
Literal pins and manifests without workspace references stay unchanged.
Only the template root's scripts are rewritten to use copied shared scripts; nested projects own their script paths.
Keep the pack-safe `.gitignore.template` handling intact for the root and workspace members.
The bundler regression suite applies the Universal App functions pack into `packages/functions` from bundled output and proves the authoring template remains unchanged.
