# Rayfin — New Project Setup

You're helping a developer create a new Rayfin project. Rayfin is a TypeScript
Backend-as-a-Service: decorate data models to get auto-generated APIs (REST +
GraphQL), typed clients, auth, storage, and a local dev stack.

**Core rule:** Rayfin's specifics are version-locked per project, so once a project
exists, never answer schema/API/auth/storage/deployment questions from memory:
remembered Rayfin APIs are routinely wrong. Defer to the project's installed skill,
`rayfin docs`, and `rayfin` MCP (Step 4). Keep this bootstrap light on Rayfin
internals.

**One question at a time:** whenever you need input from the user, ask a single
question and wait for the answer before asking the next.

## Step 1 — Detect context and ask what they want to build

First, check the current directory: context signals are enough, even if you can't
open the files. It's already a Rayfin project if it has `rayfin/rayfin.yml` or a
`package.json` with `@microsoft/rayfin-*` deps. Never create a project nested inside
or beside an existing app.

Then ask what they want to build. Infer whether it targets Microsoft Fabric or should
be self-contained, only clarifying if it's unclear. This guides the template and
later customization.

## Step 2 — Check prerequisites

Before running any `npx` command: `node --version` (need 20+) and `git --version`.
Install anything missing first:

- macOS: `brew install node git`
- Windows: `winget install -e --id OpenJS.NodeJS.LTS Git.Git`
- Linux (Debian/Ubuntu): Node from [nodejs.org/en/download](https://nodejs.org/en/download), then `sudo apt install -y git`

Don't proceed until `node --version` reports v20+.

## Step 3 — Get into a project

Act on the context from Step 1. You're not a TTY, so always pass `-y` to `npx` (bare
`npm create` can mishandle piped stdin and strip flags).

- **Already in a Rayfin project:** don't scaffold; they may have run this by mistake.
  Confirm they mean to work here (else ask for an empty target dir for a new project),
  then go to Step 4.
- **Existing non-Rayfin app here:** confirm, then add Rayfin in place with
  `npx -y rayfin init` (no template). Then Step 4.
- **Empty directory:** scaffold a new child project. Map the Step 1 answer to a
  template, then list the live set and pick the closest fit:

  ```bash
  npx -y @microsoft/create-rayfin@latest --list-templates   # JSON of gallery templates
  ```

  If unavailable, fall back to these built-in slugs (default `dataapp` for Fabric, or
  `todoapp` if self-contained / no Fabric workspace):

  - **`dataapp`** _(default)_: Microsoft Fabric data analytics app.
  - **`todoapp`**: full app (auth, entities, frontend); best to learn Rayfin end-to-end.
  - **`gettingstartedauth`**: minimal app with auth wired up; add your own data model.
  - **`blankapp`**: bare scaffolding (auth + data services, no entities/UI).

  For more options, including user-contributed ones, see the community gallery linked
  at the end.

  Prefer a template matching their domain over a blank one. Propose a kebab-case
  project name, confirm it, then:

  ```bash
  npx -y @microsoft/create-rayfin@latest --project-name <name> --template <slug>
  ```

The scaffolder (or `init`) creates the project, installs dependencies, and writes
agent rules + an MCP config, so don't redo that work. `cd` into the new `<name>/`
child dir (`rayfin init` works in place, so you're already there). If `npx` errors,
Node may be missing; see Step 2.

## Step 4 — Load the in-project skill, then plan & customize

Before writing any Rayfin-specific code, hand off to the project's authoritative,
version-locked sources:

1. Load `.agents/skills/rayfin/SKILL.md` and follow it; if your tooling supports it,
   reload tools to bring the `rayfin` MCP online.
2. Look up version-matched APIs via `rayfin docs` and the `rayfin` MCP instead of
   guessing. The skill file and `rayfin docs` work as soon as the project exists, so
   don't block waiting on the MCP reload.

Then enter plan mode and outline the first changes for what they described in Step 1:
entities under `rayfin/data/`, views under `src/`, and packages to install. Confirm
with the user before writing code.

Don't start the backend or frontend; the user runs the app themselves when ready (see
the project's `README.md`).

## Useful links

- Docs: <http://aka.ms/rayfin/docs>
- Scaffolder: <https://www.npmjs.com/package/@microsoft/create-rayfin>
- Community template gallery: <https://github.com/microsoft/awesome-rayfin>
