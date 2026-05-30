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

## Packages

| Package | Description |
|---------|-------------|
| [`@microsoft/rayfin-cli`](https://www.npmjs.com/package/@microsoft/rayfin-cli) | CLI for scaffolding, deploying, and managing Rayfin apps |
| [`@microsoft/create-rayfin`](https://www.npmjs.com/package/@microsoft/create-rayfin) | `npm create` initializer for scaffolding new projects |
| `@microsoft/rayfin-core` | Entity decorators, schema definitions, and core types |
| `@microsoft/rayfin-client` | Typed data client for querying and mutating entities |

## Related Repositories

| Repository | Description |
|-----------|-------------|
| [microsoft/awesome-rayfin](https://github.com/microsoft/awesome-rayfin) | Community templates and resources gallery |
| [microsoft/fabric-apps-analytic-templates](https://github.com/microsoft/fabric-apps-analytic-templates) | Build data analytics apps based on your data in Fabric |

## Community

- 📖 [Documentation](https://aka.ms/rayfin/docs)
- 🐛 [Report a Bug](https://github.com/microsoft/rayfin/issues/new?template=bug.yml)
- 💡 [Request a Feature](https://github.com/microsoft/rayfin/issues/new?template=feature-request.yml)
- 🤝 [Contributing Guide](CONTRIBUTING.md)

## Trademarks

This project may contain trademarks or logos for projects, products, or services.
Authorized use of Microsoft trademarks or logos must follow the [Microsoft Trademark and Brand Guidelines](https://www.microsoft.com/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos is subject to those third parties' policies.

## License

[MIT](LICENSE)
