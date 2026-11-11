---
sidebar_position: 3
---

# Project templates

Templates let Rayfin builders scaffold a project from a known starting point: a built-in starter, a local directory, a git repository your team maintains, or a registered third-party source.

This page covers using templates and authoring your own.

## Where templates come from

Every `npm create @microsoft/rayfin@latest` or `npx rayfin init` invocation can pull from any of these sources:

- **Built-in templates** ship inside `@microsoft/rayfin-cli` and work offline.
- **Local template directories** let you test or reuse a template on disk.
- **External git repositories** are cloned on demand from any HTTPS, SSH, or `git@` URL.
- **Template registries** are YAML files that name git URLs you (or your team) want to surface alongside the built-ins.

External and local template sources are discovered through `rayfin-template.yml` manifests inside the selected source directory.
Built-in templates are packaged with the CLI and appear in `--list-templates` automatically.

> **Universal App is available as the built-in `blankapp` template.**
> The visible `blankapp` entry appears in the CLI's `--list-templates` output.
> Its canonical `universal-app` name remains hidden to avoid a duplicate listing, but plugin automation can still select it explicitly with `--template universal-app`.
> Both names scaffold the same committed workspace template.
> This does not change support for ordinary local directories, git repositories, or registered templates.

## List available templates

Use `--list-templates` to see every template the CLI can scaffold from in your current directory:

```bash
npx rayfin init --list-templates
```

The output is a JSON document on stdout, suitable for piping to a script or AI agent.
The shape is versioned by `schemaVersion`:

```json
{
  "schemaVersion": 1,
  "bundled": [
    {
      "name": "todoapp",
      "displayName": "Basic Todo App",
      "description": "End-to-end Fabric-authenticated todo CRUD with a Rayfin data model and per-user row-level security",
      "source": "built-in"
    }
  ],
  "registry": [
    {
      "name": "team-templates",
      "displayName": "Team Templates",
      "description": "Our team's starter collection",
      "url": "https://github.com/example-org/rayfin-templates.git",
      "ref": "v1.2.0",
      "path": "catalogs/official",
      "source": "C:\\Users\\you\\.rayfin\\template-registries.yml"
    }
  ]
}
```

If any registry file fails to load or contains conflicts, a `warnings` array is appended to the output.
The list does **not** include arbitrary git URLs — it shows only built-ins plus what is registered through `template-registries.yml` files.
Template names in examples can change over time; run `--list-templates` for the current copy/paste-ready names.

## Scaffold from a built-in template

The default flow prompts you to pick a template interactively:

```bash
npm create @microsoft/rayfin@latest my-app
```

To skip the prompt, pass `-t`/`--template <name>` using one of the names from `--list-templates`:

```bash
npm create @microsoft/rayfin@latest my-app -- --template todoapp
```

> **Windows PowerShell:** some npm/Node.js versions drop the `--` separator, so `--template` is read by npm itself instead of being forwarded to Rayfin.
> Use `npm.cmd` instead of `npm` to avoid the issue on every Node.js version:
>
> ```powershell
> npm.cmd create @microsoft/rayfin@latest my-app -- --template todoapp
> ```

## Scaffold from an external git repository

Pass any git URL to `-t`/`--template`:

```bash
npx rayfin init my-app -t https://github.com/example-org/my-template.git
```

Supported URL formats are HTTPS, SSH, `git@host:org/repo.git`, and `file://`.
The CLI does a shallow clone into a temp directory, scaffolds, then deletes the clone.

To pin to a specific branch, tag, or commit, append `#<ref>` to the URL:

```bash
npx rayfin init my-app -t https://github.com/example-org/my-template.git#v1.2.0
npx rayfin init my-app -t https://github.com/example-org/my-template.git#main
```

Use a branch name, tag name, or **full** 40-character commit SHA.
Abbreviated SHAs are rejected because `git clone --branch` would treat them ambiguously.
For repeated use, register the repo in a `template-registries.yml` so the `ref` is kept in configuration (see [Add a template registry](#add-a-template-registry)) — then `-t <registry-name>` clones the pinned ref automatically.

## Scaffold from a local template directory

Pass a relative or absolute path to `-t`/`--template` when the template is already on disk:

```bash
npx rayfin init my-app -t ./my-template
```

Local templates use the same `rayfin-template.yml` file format as git-backed templates, including grouped entries for nested navigation.

> **Bare names resolve as template names, not paths.**
> Use `./`, `../`, or an absolute path when pointing at a local directory:
>
> POSIX shells:
>
> ```bash
> npx rayfin init my-app -t ./my-templates       # local relative path
> npx rayfin init my-app -t ../shared/templates  # parent directory
> npx rayfin init my-app -t /opt/templates/web   # POSIX absolute
> ```
>
> PowerShell:
>
> ```powershell
> npx rayfin init my-app -t C:\templates\web     # Windows absolute
> ```
>
> A bare value like `-t my-templates` is treated as a template name and looked up against the built-ins and registries.

### Authentication for private repositories

The CLI uses your existing git credentials — SSH keys, Git Credential Manager, GitHub CLI auth, or whatever your environment already provides.
No credentials are stored or managed by Rayfin.

Interactive credential prompts are disabled, so a misconfigured environment fails fast instead of hanging.
For GitHub repos, run `gh auth setup-git` to wire credentials through Git Credential Manager.

### Multi-template repositories

A single repository can publish multiple templates via the `entries` array in its `rayfin-template.yml` manifest (see [Author a template](#author-a-template)).

When you scaffold from a multi-template source interactively, the CLI shows a picker.
For non-interactive flows, pass `--template-name` with the entry's `name` or `path`:

```bash
npx rayfin init my-app \
  -t https://github.com/example-org/templates.git \
  --template-name api-service \
  --yes
```

`--template-name` requires `--template`/`-t` pointing at a multi-template source — passing it on its own is an error.
The value must match one of the source's entry `name` or `path` values; against a built-in template name it has no effect.

## Add a template registry

A registry is a YAML file that lists template repositories you want to surface in `--list-templates` and the interactive picker.
Edit a `template-registries.yml` file at one of these locations:

| Tier | Path | When to use |
| --- | --- | --- |
| **User-global** | `~/.rayfin/template-registries.yml` | Templates you use across many projects on this machine |
| **Project-local** | `<projectDir>/.rayfin/template-registries.yml` | Templates pinned to a specific project (commit alongside the repo) |

Both files are optional — the CLI also loads a bundled registry that ships with `@microsoft/rayfin-cli` itself.
The bundled registry that ships with current CLI releases may be empty.
Some templates the CLI ships with are protected and can't be overridden by a user or project entry that reuses their `name`; the rest can (see [Conflict handling](#conflict-handling) below).

> **Manage registries by hand-editing the YAML files.** There is no CLI command to add or remove registry entries.

### Registry file format

```yaml
registries:
  - name: team-templates
    displayName: Team Templates
    description: Our team's reusable starters
    url: https://github.com/example-org/rayfin-templates.git
    ref: v1.2.0
    alphaRef: v1.3.0-alpha
    betaRef: v1.3.0-beta
    path: catalogs/official
```

Each entry supports the following fields:

| Field | Required | Description |
| --- | --- | --- |
| `name` | Yes | Unique identifier for this entry |
| `url` | Yes | Git URL of the template repository (HTTPS, SSH, `git@`, or `file://`) |
| `displayName` | No | Human-readable label (defaults to `name`) |
| `description` | No | Short description shown in pickers and `--list-templates` |
| `ref` | No | Stable/default Git tag, branch, or full commit SHA to pin to (defaults to the repository's default branch) |
| `alphaRef` | No | Git ref used by alpha CLI versions; falls back to `ref` |
| `betaRef` | No | Git ref used by beta CLI versions; falls back to `ref` |
| `path` | No | Subdirectory inside the repo where the manifest lives |
| `templateName` | No | For a multi-template repo, the entry `name` or `path` to pre-select so consumers skip the picker |

The running CLI's package version selects the ref. Stable releases use `ref`,
versions such as `1.2.0-alpha.3` use `alphaRef`, and versions such as
`1.2.0-beta.2` use `betaRef`. If the matching channel ref is omitted, the CLI
uses `ref`. Other prerelease labels also use `ref`.

### Conflict handling

The CLI loads registries in tier order (bundled → user-global → project-local).
The first occurrence of any `name` wins; later tiers with the same name are skipped and listed under `warnings` in `--list-templates` output.
A few templates the CLI ships with are protected: a user or project entry that reuses their `name` is ignored and gets a dedicated warning.
Other name conflicts still resolve by tier order; rename one of the conflicting entries to resolve.

## Author a template

A template is a directory with a `rayfin-template.yml` manifest at its root.
Template files are copied into the target directory, then Rayfin applies a small fixed set of scaffold transforms.
If your template includes `package.json`, Rayfin rewrites its `name` field to the generated project slug.
If `package.json` is not valid JSON, Rayfin leaves it as-is.
If your template includes `README.md`, Rayfin replaces the supported placeholders listed below.
Other file contents are not templated.
`__projectName__` placeholders in **filenames** are replaced with the user's project name.

The user's project name comes from the `[directory]` positional (`npm create @microsoft/rayfin@latest my-app` → `my-app`) unless they pass `--project-name` to override.

### Minimal template

```text
my-template/
├── rayfin-template.yml
└── template/
    ├── package.json
    ├── README.md
    └── src/
        └── __projectName__.config.ts
```

`rayfin-template.yml`:

```yaml
apiVersion: v1
metadata:
  name: my-starter
  displayName: My Starter
  description: A starter template for Rayfin projects
entries:
  - name: my-starter
    path: ./template
```

When scaffolded into `my-app/`, the file `src/__projectName__.config.ts` is written as `src/my-app.config.ts`.

### Publish and share an external template repository

Once your template is working, share it as a git repository so your team (or anyone else) can scaffold from it.

#### 1. Initialize a git repo for the template

From your template directory:

```bash
git init
git add .
git commit -m "Initial template"
git remote add origin https://github.com/example-org/my-template.git
git push -u origin main
```

#### 2. Tag a release

Don't ask consumers to scaffold from the moving `main` branch — pin to a tag so their scaffolds are reproducible:

```bash
git tag v1.0.0
git push origin v1.0.0
```

Bump the tag whenever you ship a meaningful change to the template.

#### 3. Share the URL

The simplest path is to hand consumers the git URL. They scaffold with:

```bash
npx rayfin init my-app -t https://github.com/example-org/my-template.git#v1.0.0
```

#### 4. (Optional) Surface it through a registry

If you want the template to appear in `rayfin init --list-templates` and the interactive picker — without consumers having to remember the URL — add it to a `template-registries.yml` file (see [Add a template registry](#add-a-template-registry)).

A team-shared `.rayfin/template-registries.yml` committed to the project root, or a personal `~/.rayfin/template-registries.yml`, both work:

```yaml
registries:
  - name: my-starter
    displayName: My Starter
    description: Our team's Rayfin starter
    url: https://github.com/example-org/my-template.git
    ref: v1.0.0
```

After that, consumers scaffold by name:

```bash
npx rayfin init my-app -t my-starter
```

When you ship a new tag, update the `ref` and (ideally) commit the registry change so everyone on the team picks it up.

### Try it locally before publishing

Test your template against a local path before pushing or tagging:

```bash
npx rayfin init test-output -t ./my-template --yes
```

### Manifest reference

```yaml
apiVersion: v1            # required, must be 'v1'
metadata:
  name: my-collection     # required, identifier for the manifest
  displayName: My Collection
  description: Optional description
  version: 1.2.0           # accepted, currently informational only
  tags: [todo, auth]       # accepted, currently informational only
entries:                   # required, at least one entry
  - name: api-service     # template entry: scaffolds files from path
    path: ./api-service
    description: REST API with Rayfin data layer
```

`metadata.displayName` and `metadata.description` are shown when scaffolding from this template.
`metadata.version` and `metadata.tags` are accepted by the manifest schema but are not surfaced in the CLI today.
Entry-level `description` is shown in the local multi-template picker.
For git-backed nested navigation, group descriptions are shown; template entry descriptions are not.

### Single-entry vs multi-entry manifests

A single-entry manifest auto-selects with no picker:

```yaml
entries:
  - name: my-starter
    path: .
```

A multi-entry manifest shows an interactive picker (or requires `--template-name` for non-interactive flows):

```yaml
entries:
  - name: api-service
    path: ./templates/api-service
  - name: fullstack
    path: ./templates/fullstack
```

Local and git-backed template sources both support grouped nested navigation.

### Group entries for nested navigation

Use `group` entries to organize larger collections.
Groups can nest, and the picker walks users through the hierarchy:

```yaml
entries:
  - group:
      name: starters
      displayName: Starter Apps
      entries:
        - name: hello-world
          path: ./starters/hello-world
        - name: todo-app
          path: ./starters/todo-app
  - name: standalone-app
    path: ./standalone-app
```

### What's currently supported

Templates are intentionally minimal:

- Most file contents are copied as-is.
- `README.md` supports `{{PROJECT_NAME}}`, `{{PROJECT_NAME_KEBAB}}`, and `{{PROJECT_NAME_PASCAL}}` placeholders.
- `package.json` `name` is set to the generated project slug.
- The only filename placeholder is `__projectName__`, replaced with the user's project name and with path separators sanitized.
- Files matching `rayfin-template.yml`, `.git`, `node_modules`, `.DS_Store`, and `Thumbs.db` are skipped during scaffolding.
- Symlinks are not followed.
- After scaffolding, the CLI installs its own agent files (`mcpServers.rayfin` inside `.mcp.json`, `.agents/skills/rayfin/`) into the project. You can ship `.mcp.json` with your own MCP servers, but do not include a `mcpServers.rayfin` key because the CLI manages that key. You can also ship an `AGENTS.md`; it's a one-time install and the CLI won't overwrite a template-provided one.

## Gotchas

- `--list-templates` lists built-in and registered templates only — arbitrary git URLs you pass with `-t` are not in the list.
- The CLI clones a single ref shallowly. Tools that depend on git history or other branches won't have them at scaffold time.
- Private repositories rely on ambient git credentials. Interactive prompts are disabled, so missing credentials produce an immediate auth error.
- Non-interactive scaffolding from a multi-entry source fails unless `--template-name` is provided. The error message lists the available names.
- Bare values passed to `-t` resolve as template names. Use `./`, `../`, or an absolute path for local directories.

## Related

- [CLI Quickstart](./quickstart.md) — common scaffolding workflows
- [Environment variables](./environment-variables.md) — runtime configuration after scaffolding
