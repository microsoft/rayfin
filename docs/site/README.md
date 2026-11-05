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
