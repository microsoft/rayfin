# Rayfin: New Project Setup

You're helping a developer create a new Rayfin project. Rayfin is a TypeScript Backend-as-a-Service: decorate data models to get auto-generated APIs (REST + GraphQL), typed clients, auth, storage, and a local dev stack.

**Core rule:** Rayfin's specifics are version-locked per project, so once a project exists, never answer schema/API/auth/storage/deployment questions from memory: remembered Rayfin APIs are routinely wrong. Defer to the project's installed skill, `rayfin docs`, and `rayfin` MCP (Step 4).

**One question at a time:** whenever you need input from the user, ask a single question and wait for the answer before asking the next.

## Step 1: Ask what they want to build

Ask what they want to build, and confirm a kebab-case project name. Infer whether it targets Microsoft Fabric or should be self-contained, only clarifying if it's unclear. This guides the template choice in Step 3 and the customization in Step 4.

Keep it short if the working directory already looks like an existing app: Step 3 determines the exact situation and never creates a project nested inside or beside another one.

## Step 2: Check prerequisites

Before running any `npx` command: `node --version` and `git --version`. Rayfin supports Node **LTS** releases, currently v20, v22 and v24. Odd-numbered major like 21, 23 or 25 are unsupported. Install anything missing first:

- macOS: install the LTS build from [nodejs.org/en/download](https://nodejs.org/en/download), which defaults to LTS. Homebrew's `node` formula tracks Current, so avoid it here. For git, use `brew install git` or the Xcode Command Line Tools.
- Windows: `winget install -e --id OpenJS.NodeJS.LTS` then `winget install -e --id Git.Git`
- Linux (Debian/Ubuntu): `curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -` then `sudo apt install -y nodejs git`

Don't proceed until `node --version` reports an LTS release, meaning v20.x, v22.x or v24.x today. When a newer LTS line ships, prefer it, and fall back to the most recent LTS the scaffolder accepts if it rejects the brand-new one.

## Step 3: Get into a project

Don't scaffold from memory: fetch the getting-started skill and follow it. It is the canonical source for project detection, the default template, and the exact CLI commands, and it is kept up to date as those change.

Fetch and read this URL:

<https://raw.githubusercontent.com/microsoft/rayfin/main/skills/rayfin-getting-started/SKILL.md>

Then follow it to detect whether you're already in a Rayfin project, in an existing non-Rayfin app, or in an empty directory, and to run the right command for that case. Feed it what you learned in Step 1: what the user wants to build, and a kebab-case project name you've confirmed with them.

Once it has scaffolded, make sure you're at the project root before continuing: `create-rayfin` creates a child directory, while an in-place init leaves you where you are. Then continue to Step 4.

## Step 4: Load the in-project skill, then plan & customize

Before writing any Rayfin-specific code, hand off to the project's authoritative, version-locked sources:

1. Load `.agents/skills/rayfin/SKILL.md` and follow it; if your tooling supports it, reload tools to bring the `rayfin` MCP online.
2. Look up version-matched APIs via `rayfin docs` and the `rayfin` MCP instead of guessing. The skill file and `rayfin docs` work as soon as the project exists, so don't block waiting on the MCP reload.

Then plan before you build: outline the first changes for what they described in Step 1 (entities under `rayfin/data/`, views under `src/`, packages to install) and confirm that plan with the user before writing code. If your tooling has a planning mode, use it.

Don't start the backend or frontend; the user runs the app themselves when ready (see the project's `README.md`).
