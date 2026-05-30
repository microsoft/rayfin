<!-- markdownlint-disable MD033 MD041 -->

<div align="center">

  <h1>🐟 Rayfin</h1>
  <p>A modern Backend-as-a-Service (BaaS) platform built for the agentic era.<br>
  Define your data model with TypeScript decorators — Rayfin handles the rest.</p>

  <a href="https://aka.ms/rayfin/docs">Docs</a> •
  <a href="https://aka.ms/rayfin">Website</a> •
  <a href="https://github.com/microsoft/awesome-rayfin">Templates</a> •
  <a href="https://github.com/microsoft/rayfin/issues">Issues</a> •
  <a href="https://reddit.com/r/rayfin">Reddit</a>
</div>

---

## Getting Started

```bash
npm create @microsoft/rayfin@latest
```

This scaffolds a new Rayfin project with everything you need — data models, auth, and a ready-to-deploy app.

## What is Rayfin?

Rayfin is a **Backend-as-a-Service** platform that lets teams build and ship applications faster. Define your data model with TypeScript decorators and Rayfin handles auth, data APIs, storage, and hosting.

```bash
npm create @microsoft/rayfin@latest    # scaffold a new project
npx rayfin up                          # deploy and run
```

### Key Features

- **Decorator-Based Data Modeling** — Define entities with `@entity()`, `@text()`, `@boolean()`, `@date()`, and other decorators from `@microsoft/rayfin-core`
- **Authentication** — Fabric Entra SSO in production, mock email/password locally
- **Typed Data Access** — Schema-driven GraphQL client with compile-time type checking
- **Static Hosting** — Deploy frontends with `rayfin up staticapp deploy`

## Local Development (Experimental)

Rayfin supports a pure local development experience — no cloud resources required. This is currently experimental and great for trying out Rayfin or building offline.

👉 See the [Todo Local Experimental template](https://github.com/microsoft/awesome-rayfin/tree/main/templates/todo-local-experimental) to get started.

## Packages

| Package | Version | Description |
|---------|---------|-------------|
| [`@microsoft/create-rayfin`](https://www.npmjs.com/package/@microsoft/create-rayfin) | [![npm](https://img.shields.io/npm/v/@microsoft/create-rayfin)](https://www.npmjs.com/package/@microsoft/create-rayfin) | Scaffold a Rayfin project with `npm create @microsoft/rayfin@latest` |
| [`@microsoft/rayfin-cli`](https://www.npmjs.com/package/@microsoft/rayfin-cli) | [![npm](https://img.shields.io/npm/v/@microsoft/rayfin-cli)](https://www.npmjs.com/package/@microsoft/rayfin-cli) | CLI for scaffolding, deploying, and managing Rayfin apps |
| [`@microsoft/rayfin-core`](https://www.npmjs.com/package/@microsoft/rayfin-core) | [![npm](https://img.shields.io/npm/v/@microsoft/rayfin-core)](https://www.npmjs.com/package/@microsoft/rayfin-core) | Entity decorators, schema definitions, and core types |
| [`@microsoft/rayfin-client`](https://www.npmjs.com/package/@microsoft/rayfin-client) | [![npm](https://img.shields.io/npm/v/@microsoft/rayfin-client)](https://www.npmjs.com/package/@microsoft/rayfin-client) | Main client SDK for Rayfin services |
| [`@microsoft/rayfin-data`](https://www.npmjs.com/package/@microsoft/rayfin-data) | [![npm](https://img.shields.io/npm/v/@microsoft/rayfin-data)](https://www.npmjs.com/package/@microsoft/rayfin-data) | Type-safe client library for Data API Builder endpoints |
| [`@microsoft/rayfin-auth`](https://www.npmjs.com/package/@microsoft/rayfin-auth) | [![npm](https://img.shields.io/npm/v/@microsoft/rayfin-auth)](https://www.npmjs.com/package/@microsoft/rayfin-auth) | Authentication utilities for Rayfin SDK |
| [`@microsoft/rayfin-auth-provider-fabric`](https://www.npmjs.com/package/@microsoft/rayfin-auth-provider-fabric) | [![npm](https://img.shields.io/npm/v/@microsoft/rayfin-auth-provider-fabric)](https://www.npmjs.com/package/@microsoft/rayfin-auth-provider-fabric) | Fabric brokered authentication provider for Rayfin SDK |
| [`@microsoft/rayfin-functions`](https://www.npmjs.com/package/@microsoft/rayfin-functions) | [![npm](https://img.shields.io/npm/v/@microsoft/rayfin-functions)](https://www.npmjs.com/package/@microsoft/rayfin-functions) | Rayfin functions runtime |
| [`@microsoft/rayfin-storage`](https://www.npmjs.com/package/@microsoft/rayfin-storage) | [![npm](https://img.shields.io/npm/v/@microsoft/rayfin-storage)](https://www.npmjs.com/package/@microsoft/rayfin-storage) | Type-safe client library for Rayfin storage operations |
| [`@microsoft/rayfin-lib`](https://www.npmjs.com/package/@microsoft/rayfin-lib) | [![npm](https://img.shields.io/npm/v/@microsoft/rayfin-lib)](https://www.npmjs.com/package/@microsoft/rayfin-lib) | Shared library utilities and HTTP client foundation |
| [`@microsoft/rayfin-tools-common`](https://www.npmjs.com/package/@microsoft/rayfin-tools-common) | [![npm](https://img.shields.io/npm/v/@microsoft/rayfin-tools-common)](https://www.npmjs.com/package/@microsoft/rayfin-tools-common) | Shared utilities for Rayfin tools packages |
| [`@microsoft/rayfin-docs`](https://www.npmjs.com/package/@microsoft/rayfin-docs) | [![npm](https://img.shields.io/npm/v/@microsoft/rayfin-docs)](https://www.npmjs.com/package/@microsoft/rayfin-docs) | Rayfin docs indexing and search library |
| [`@microsoft/rayfin-guide`](https://www.npmjs.com/package/@microsoft/rayfin-guide) | [![npm](https://img.shields.io/npm/v/@microsoft/rayfin-guide)](https://www.npmjs.com/package/@microsoft/rayfin-guide) | Cross-cutting builder guides for the Rayfin platform |
| [`@microsoft/rayfin-mcp`](https://www.npmjs.com/package/@microsoft/rayfin-mcp) | [![npm](https://img.shields.io/npm/v/@microsoft/rayfin-mcp)](https://www.npmjs.com/package/@microsoft/rayfin-mcp) | Rayfin Model Context Protocol tooling |
| [`@microsoft/fabric-embedded-host`](https://www.npmjs.com/package/@microsoft/fabric-embedded-host) | [![npm](https://img.shields.io/npm/v/@microsoft/fabric-embedded-host)](https://www.npmjs.com/package/@microsoft/fabric-embedded-host) | PostMessage bridge and embedded mode detection for Fabric iframes |

## Related Repositories

| Repository | Description |
|-----------|-------------|
| [microsoft/awesome-rayfin](https://github.com/microsoft/awesome-rayfin) | Community templates and resources gallery |
| [microsoft/fabric-apps-analytic-templates](https://github.com/microsoft/fabric-apps-analytic-templates) | Build data analytics apps based on your data in Fabric |

## Community

- 📖 [Documentation](https://aka.ms/rayfin/docs)
- 🐛 [Report a Bug](https://github.com/microsoft/rayfin/issues/new?template=bug.yml)
- 💡 [Request a Feature](https://github.com/microsoft/rayfin/issues/new?template=feature-request.yml)
- 🐟 [Reddit](https://reddit.com/r/rayfin)
- 🤝 [Contributing Guide](CONTRIBUTING.md)

## Trademarks

This project may contain trademarks or logos for projects, products, or services.
Authorized use of Microsoft trademarks or logos must follow the [Microsoft Trademark and Brand Guidelines](https://www.microsoft.com/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos is subject to those third parties' policies.

## License

[MIT](LICENSE)
