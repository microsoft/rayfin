---
name: rayfin-getting-started
description: "Use when starting or creating a NEW Rayfin app, or when a Rayfin task comes up and you are not yet inside a Rayfin project. Gets you into a project with the Rayfin CLI, then hands off to the authoritative, version-locked in-project rayfin skill/MCP/docs that own all in-project work. Triggers: build a Rayfin app, start a Rayfin project, create a new Rayfin app, create-rayfin, npm create @microsoft/rayfin, rayfin init, scaffold rayfin, rayfin CLI, rayfin template, awesome-rayfin gallery, get started with Rayfin"
metadata:
  author: microsoft
  version: "0.1.0"
---

# Rayfin (Getting Started)

Rayfin is a Backend-as-a-Service: define your data model with TypeScript decorators and
Rayfin provides auth, a typed data API, storage, and Fabric hosting.

This skill only handles *getting started* — getting you from zero into a working Rayfin
project, then handing off. The moment you're in a project, the authoritative, version-locked
skill at `.agents/skills/rayfin/SKILL.md` — alongside the `rayfin` MCP and `rayfin docs` —
owns everything else: schema, auth, storage, querying, deployment. Load it and stop using
this one.

## Route, don't improvise

Rayfin's specifics are version-locked per project — schema/decorator syntax, the typed data
API and client queries, auth, storage, and deployment all live in the project's own skill,
MCP, and `rayfin docs`. Never answer them from memory; remembered Rayfin APIs are routinely
wrong against the installed version. Get into a project, read `.agents/skills/rayfin/SKILL.md`,
then follow it for version-matched signatures. The in-project skill **file** and the
`rayfin docs` CLI are available the moment a project exists — including right after you
scaffold one, in the same session. The `rayfin` MCP is an extra convenience that may only
come online once the tool reloads the new project, so don't wait on it: lean on the
in-project skill file plus `rayfin docs`.

Being blocked does not unlock memory. Only treat yourself as blocked if you can reach **none**
of the version-matched sources — you can't read `.agents/skills/rayfin/SKILL.md` *and* can't
run `rayfin docs` (e.g. tool permissions denied). The `rayfin` MCP simply not being loaded yet
is **not** a blocker. When genuinely blocked, say you need those sources to answer accurately
and stop there — don't offer a "general approach" or example code "in the meantime"; that
stopgap is exactly the fabrication this skill exists to prevent.

## Already in a Rayfin project?

Check this first — before scaffolding anything, even when the user says "build" or "set up a
new app". A directory is a Rayfin project if it has `rayfin/rayfin.yml` or a `package.json`
depending on `@microsoft/rayfin-*`. Environment signals alone are enough: if the workspace
context shows either — even when you can't open the files yet — treat it as an existing
project and continue in place. Never stand up a nested or sibling project.

- **Already in one →** load `.agents/skills/rayfin/SKILL.md` and use the `rayfin` MCP /
  `rayfin docs`. Stop using this skill.
- **Existing non-Rayfin app here →** add Rayfin in place with `npx rayfin init` (don't
  scaffold a separate project), then load the in-project skill.
- **Empty directory →** scaffold (below), then load the in-project skill from the project root.

## Scaffold a new project

`npm create @microsoft/rayfin@latest` is a thin wrapper around `rayfin init`. As an agent you
run non-interactively (stdin isn't a TTY), so use the `npx -y` form — `npm create` can
mishandle piped stdin and strip flags, and `--project-name` is **required** non-interactively.

```bash
# List built-in gallery templates (JSON), then create from the closest fit
npx -y @microsoft/create-rayfin@latest --list-templates

# Create non-interactively — --project-name required; --template takes a slug
# (e.g. dataapp, gettingstartedauth), not a display name
npx -y @microsoft/create-rayfin@latest --project-name <app-name> --template <slug>

# Or add Rayfin into an existing/empty directory
npx rayfin init [directory]
```

Prefer a gallery template matching the user's domain (events, field service, todo, CRUD) over
an empty project — it ships a working data model, auth, and UI. Mind the project root before
loading the in-project skill: `create-rayfin` creates a child project directory (named from
`--project-name`, slugified), so `cd` into it; an in-place `rayfin init` scaffolds in the
current directory, so you're already there. Once at the project root, load its
`.agents/skills/rayfin/SKILL.md`.
