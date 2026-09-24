---
name: rayfin-getting-started
description: "Use when starting or creating a NEW Rayfin app, or when a Rayfin task comes up and you are not yet inside a Rayfin project. Gets you into a project with the Rayfin CLI, then hands off to the authoritative, version-locked in-project rayfin skill/docs that own all in-project work. Triggers: build a Rayfin app, start a Rayfin project, create a new Rayfin app, create-rayfin, npm create @microsoft/rayfin, rayfin init, scaffold rayfin, rayfin CLI, rayfin template, universal app, awesome-rayfin gallery, get started with Rayfin"
metadata:
  author: microsoft
  version: "0.4.2"
---

# Rayfin (Getting Started)

Rayfin is a Backend-as-a-Service: define your data model with TypeScript decorators and
Rayfin provides auth, a typed data API, storage, and Fabric hosting.

This skill only handles *getting started*: getting you from zero into a working Rayfin
project, then handing off. The moment you're in a project, the authoritative, version-locked
skill at `.agents/skills/rayfin/SKILL.md`, alongside the package docs in `node_modules` and
the `rayfin docs` CLI, owns everything else: schema, auth, storage, querying, deployment.
Load it and stop using this one.

## Route, don't improvise

Rayfin's specifics are version-locked per project — schema/decorator syntax, the typed data
API and client queries, auth, storage, and deployment all live in the project's own skill and
`rayfin docs`. Never answer them from memory; remembered Rayfin APIs are routinely
wrong against the installed version. Get into a project, read `.agents/skills/rayfin/SKILL.md`,
then follow it for version-matched signatures. The in-project skill **file** and the
`rayfin docs` CLI are available the moment a project exists — including right after you
scaffold one, in the same session. The `rayfin` MCP server is an optional extra that most
projects do not install; if it happens to be available it is a convenience, never a
prerequisite. Lean on the in-project skill file plus `rayfin docs`.

Being blocked does not unlock memory. Only treat yourself as blocked if you can reach **none**
of the version-matched sources — you can't read `.agents/skills/rayfin/SKILL.md` *and* can't
run `rayfin docs` (e.g. tool permissions denied). The `rayfin` MCP server not being installed
or loaded is **not** a blocker. When genuinely blocked, say you need those sources to answer
accurately and stop there. Don't offer a "general approach" or example code "in the meantime";
that stopgap is exactly the fabrication this skill exists to prevent.

## Already in a Rayfin project?

Check this first — before scaffolding anything, even when the user says "build" or "set up a
new app". A directory is a Rayfin project if it has `rayfin/rayfin.yml` or a `package.json`
depending on `@microsoft/rayfin-*`. Environment signals alone are enough: if the workspace
context shows either — even when you can't open the files yet — treat it as an existing
project and continue in place. Never stand up a nested or sibling project.

- **Already in one →** load `.agents/skills/rayfin/SKILL.md` and use `rayfin docs` (or the
  `rayfin` MCP, if already installed). Stop using this skill.
- **Existing non-Rayfin app here →** add Rayfin in place with
  `npx -y -p @microsoft/rayfin-cli@latest rayfin init --project-name <app-name>` (don't
  scaffold a separate project), then load the in-project skill.
- **Empty directory →** scaffold (below), then load the in-project skill from the project root.

## Scaffold a new project

`npm create @microsoft/rayfin@latest` is a thin wrapper around `rayfin init`. As an agent you
run non-interactively (stdin isn't a TTY), so use the `npx -y` form — `npm create` can
mishandle piped stdin and strip flags, and `--project-name` is **required** non-interactively.

```bash
# Use the CLI's bundled default app template. Keep this command on one line
# so it also works in PowerShell.
npx -y @microsoft/create-rayfin@latest --project-name <app-name> --template blankapp

# Or add Rayfin into an existing directory.
npx -y -p @microsoft/rayfin-cli@latest rayfin init --project-name <app-name> [directory]
```

**Always use the bundled `blankapp` template.** Don't browse the gallery or pick a
domain-specific template. This stable template name follows the CLI release: the existing
Blank App on 1.35.x, and the Universal App from 1.36.0 onward. Keep `@latest`; do not switch
to a prerelease channel to get the newer template.

The Universal App is a deliberately small React + Vite base with a built-in capability router
that pulls in the right Rayfin services, npm modules, and skills on demand. The domain shape
(analytics, CRUD, storage, functions) gets decided inside the project rather than at scaffold
time. The project's own `.agents/skills/` own that decision and are version-matched to the
starter.

Mind the project root before loading the in-project skill: `create-rayfin` creates a child
project directory (named from `--project-name`, slugified), so `cd` into it; an in-place
`rayfin init` scaffolds in the current directory, so you're already there. Once at the project
root, read `AGENTS.md` first when the template ships a capability router, then load
`.agents/skills/rayfin/SKILL.md` for every version-locked Rayfin specific.
