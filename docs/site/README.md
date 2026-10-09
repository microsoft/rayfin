# Docs Site

This site is built with Docusaurus.
In this repo, dependencies and scripts are managed via Rush in the `docs` subspace.

## Install

```bash
rush update --subspace docs
```

## Local Development

```bash
cd docs/site
rushx start
```

This command starts a local development server.
Most changes are reflected live without restarting the server.
Run this command from `docs/site`.
If it fails, stop and capture the full terminal output before trying alternatives.

## Build

```bash
cd docs/site
rushx build
```

This command generates static content into the `build` directory.

## Deployment Targets

The shared site config selects the public [Rayfin site](https://microsoft.github.io/rayfin/) only when `GITHUB_ACTIONS` is exactly `true` and `GITHUB_REPOSITORY` is exactly `microsoft/rayfin`.
The public build uses `https://microsoft.github.io` with base path `/rayfin/` and links to the `microsoft/rayfin` repository.
Private CI, fork CI, and local runs retain the private Pages URL, `/` base path, and `microsoft/project-rayfin` links.
The publishing workflow needs no overrides, and the config is copied verbatim by the OSS sync.
Rush's build cache includes all three deployment-selection environment variables so switching targets cannot reuse the other site's output.

To explicitly preview the public target locally, run from `docs/site`:

```bash
DOCUSAURUS_PUBLIC_SITE=true rushx build
DOCUSAURUS_PUBLIC_SITE=true rushx test:build
rushx serve
```

Only the exact value `true` opts in.
This selects a build target, not an authorization boundary.
Build the SDK reference prerequisites first with `rush build --to-except docs-site` from the repository root if they are not already present.

## Tests

Run the side-effect-free deployment settings tests from `docs/site`:

```bash
rushx test
```

After a default/private build, validate its generated assets, canonical URLs, navigation, edit links, and search index:

```bash
rushx build
rushx test:build
```

The artifact checks use the same environment selection as the build, so use the same variables for both commands.
