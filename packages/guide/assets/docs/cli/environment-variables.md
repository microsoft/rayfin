# Environment variables

This page is the single reference for every environment variable that Rayfin tooling reads or writes.
Variables are grouped by purpose and lifecycle.

## Frontend-visible variables (`RAYFIN_PUBLIC_*`)

These variables live in `rayfin/.env` and are the **only** variables exposed to frontend builds.
The `rayfin env` command (or the auto-emit built into `rayfin up`) maps them to framework-specific names in `.env.local`.

| Variable | Description | Populated by |
| --- | --- | --- |
| `RAYFIN_PUBLIC_API_URL` | Rayfin backend URL selected for the development or deployed environment. | `rayfin dev` / `rayfin up` |
| `RAYFIN_PUBLIC_PUBLISHABLE_KEY` | Public key for Rayfin SDK initialization. | `rayfin dev` / `rayfin up` |
| `RAYFIN_PUBLIC_FUNCTIONS_URL` | URL of the local Functions host started by `rayfin dev`. Removed when functions are disabled so local clients do not retain a stale host. | `rayfin dev` |
| `RAYFIN_PUBLIC_ITEM_ID` | Fabric AppBackend item ID. Used for Fabric brokered auth. | `rayfin up` |
| `RAYFIN_PUBLIC_WORKSPACE_ID` | Fabric workspace ID. Used for Fabric brokered auth. | `rayfin up` |
| `RAYFIN_PUBLIC_TENANT_ID` | Entra ID tenant for workspace disambiguation. | `rayfin up` |
| `RAYFIN_PUBLIC_PORTAL_URL` | Fabric Portal base URL (for example, `https://app.fabric.microsoft.com/`). | `rayfin up` |
| `RAYFIN_PUBLIC_SERVICE_MODE` | `rayfin` (real backend) or `mock` (local testing). | User-set in `rayfin/.env` |
| `RAYFIN_PUBLIC_FRONTEND_PORT` | Stable per-project frontend dev-server port. Reused while available and automatically replaced when occupied so the frontend and backend allow-list stay aligned. | `rayfin dev` / `rayfin up` |

### Framework mapping

`rayfin env --framework <fw>` maps each `RAYFIN_PUBLIC_*` variable to a framework-specific name:

| Source (`rayfin/.env`) | Vite (`.env.local`) | Next.js (`.env.local`) | Plain (`.env.local`) |
| --- | --- | --- | --- |
| `RAYFIN_PUBLIC_API_URL` | `VITE_RAYFIN_API_URL` | `NEXT_PUBLIC_RAYFIN_API_URL` | `API_URL` |
| `RAYFIN_PUBLIC_PUBLISHABLE_KEY` | `VITE_RAYFIN_PUBLISHABLE_KEY` | `NEXT_PUBLIC_RAYFIN_PUBLISHABLE_KEY` | `PUBLISHABLE_KEY` |
| `RAYFIN_PUBLIC_FUNCTIONS_URL` | `VITE_RAYFIN_FUNCTIONS_URL` | `NEXT_PUBLIC_RAYFIN_FUNCTIONS_URL` | `FUNCTIONS_URL` |
| `RAYFIN_PUBLIC_ITEM_ID` | `VITE_FABRIC_ITEM_ID` | `NEXT_PUBLIC_FABRIC_ITEM_ID` | `ITEM_ID` |
| `RAYFIN_PUBLIC_WORKSPACE_ID` | `VITE_FABRIC_WORKSPACE_ID` | `NEXT_PUBLIC_FABRIC_WORKSPACE_ID` | `WORKSPACE_ID` |
| `RAYFIN_PUBLIC_TENANT_ID` | `VITE_FABRIC_TENANT_ID` | `NEXT_PUBLIC_FABRIC_TENANT_ID` | `TENANT_ID` |
| `RAYFIN_PUBLIC_PORTAL_URL` | `VITE_FABRIC_PORTAL_URL` | `NEXT_PUBLIC_FABRIC_PORTAL_URL` | `PORTAL_URL` |
| `RAYFIN_PUBLIC_SERVICE_MODE` | `VITE_SERVICE_MODE` | `NEXT_PUBLIC_SERVICE_MODE` | `SERVICE_MODE` |
| `RAYFIN_PUBLIC_FRONTEND_PORT` | `VITE_PORT` | `PORT` | `FRONTEND_PORT` |

Custom `RAYFIN_PUBLIC_*` variables you add follow a generic pattern: `RAYFIN_PUBLIC_FOO` becomes `VITE_RAYFIN_FOO` (Vite), `NEXT_PUBLIC_RAYFIN_FOO` (Next.js), or `FOO` (plain).

`RAYFIN_PUBLIC_FRONTEND_PORT` maps to the port variable each dev server reads (`VITE_PORT` for Vite, `PORT` for Next.js).
Before local frontend wiring, Rayfin checks whether the persisted port is available.
If it is occupied, Rayfin selects the next available port, updates `rayfin/.env`, and registers the replacement origin in the deployed redirect allow-list when authentication is enabled.
Rayfin temporarily retains an occupied prior port in `RAYFIN_FRONTEND_DEV_PORT_ALIASES` so an already-running frontend keeps authenticating; the alias is removed after the port becomes available.
This managed variable is not exposed to frontend builds and should not be edited manually.
The sample `vite.config.ts` files use `strictPort` so Vite cannot silently drift from that persisted, allow-listed origin.
To prefer a different port, set `RAYFIN_PUBLIC_FRONTEND_PORT` in `rayfin/.env`, then run `rayfin dev` or `rayfin up` to validate and project it into `.env.local`.

### Bare development runtime wiring

`npx rayfin dev` runs the local frontend against the Fabric backend by default.
Use `npx rayfin dev --provider fabric` to select the same provider explicitly.
The CLI reuses a registered deployment or provisions and records a missing AppBackend.
Set `RAYFIN_WORKSPACE_ID` to target a specific workspace; otherwise the active registered deployment or My workspace is used.

The CLI starts `npm run dev:frontend` when that script exists and falls back to `npm run dev` for existing projects.
This lets bundled templates expose `npm run dev` as the complete session without recursively starting the CLI.
When migrating an existing project to `"dev": "rayfin dev"`, also add a non-recursive child such as `"dev:frontend": "vite"`; otherwise the CLI fails with an actionable recursion error.
Scripts are resolved from `services.staticHosting.path` when configured, otherwise from the project root.
For a nested frontend package, declare `dev:frontend` (or the legacy `dev` fallback) in that package's `package.json`.

When `services.functions.enabled` is `true`, the same command builds and starts the configured functions package with Azure Functions Core Tools.
The CLI reserves the nearest available Functions port starting at `7071` and writes its URL to `RAYFIN_PUBLIC_FUNCTIONS_URL` before starting the frontend.
When functions are disabled, the CLI removes any stale `RAYFIN_PUBLIC_FUNCTIONS_URL` from `rayfin/.env` and regenerates the framework environment file without it.

Bundled Vite templates use `@microsoft/rayfin-local-dev` to keep local function calls on the frontend origin.
During `vite serve`, the client calls `/.rayfin/api/<name>` and the Vite adapter forwards that request to the exact Functions URL selected by `rayfin dev`.
If the local Functions host becomes unavailable, the adapter returns HTTP 502 and does not invoke deployed function code.
Production builds leave `functionsBaseUrl` unset, so function calls use the deployed Rayfin backend route.
Non-Vite projects can continue to pass their framework-mapped Functions URL directly to `RayfinClient` during development.
The proxy is reachable wherever the Vite dev server is reachable, so keep Vite bound to loopback or restrict its `host` and `allowedHosts` settings to the trusted development network.

The local functions setup makes these workspace changes:

- Merges backend coordinates and the Node inspector argument into the configured functions package's `local.settings.json`.
- Adds a `Functions: Attach` configuration to the root `.vscode/launch.json` after the Functions host becomes ready. If the entry already exists and the inspector moved to another port, only its `port` is updated.
- Leaves JSON-with-comments launch files unchanged and reports that the attach configuration must be added manually.
- Patches recognized existing `src/services/rayfinClient.ts` and `src/services/bootstrap.ts` files once so non-adapter projects read `VITE_RAYFIN_FUNCTIONS_URL` only during Vite development.
- Regenerates the framework `.env.local` file unless `--no-emit-env` is set.

The Node inspector defaults to port `9229` and slides to the nearest available port when needed.
Use the `Functions: Attach` launch configuration after the host is ready to debug local function code.

To run the managed backend locally instead, enable the Docker preview and use `npx rayfin dev --provider docker`.
Frontend and functions code still run as local processes; only the managed Rayfin backend moves from Fabric to Docker.

## Tooling overrides

These variables configure CLI and extension behavior.
They are not exposed to the frontend (no `PUBLIC_` infix).
Set them in `rayfin/.env` or as shell environment variables.

| Variable | Description | Default |
| --- | --- | --- |
| `RAYFIN_FABRIC_API_URL` | Fabric REST API base URL the CLI calls. For canonical Fabric hosts (`*.fabric.microsoft.com`) accepts a bare origin (e.g. `https://api.fabric.microsoft.com`) or an `<origin>/v1` URL — extra path segments are stripped to maintain back-compat. For non-Fabric hosts (proxies, custom envs) accepts an origin plus path prefix (e.g. `https://my-proxy.example.com/cli-proxy/fabric/<id>`); the path prefix is preserved verbatim and `/v1` is appended only when the resolved path does not already end in `/v1`. Independent — set on its own, with `RAYFIN_FABRIC_PORTAL_URL`, or with the full authentication group. | `https://api.fabric.microsoft.com/v1` |
| `RAYFIN_FABRIC_PORTAL_URL` | Fabric portal base URL used for deep links and `RAYFIN_PUBLIC_PORTAL_URL`. Independent — set on its own, with `RAYFIN_FABRIC_API_URL`, or with the full authentication group. | `https://app.fabric.microsoft.com/` |
| `RAYFIN_ENV_FILE` | Path to an alternate `.env` file. Equivalent to `--env-file`. | `rayfin/.env` |

When set on their own, the two Fabric endpoint variables apply only to the current process and are **not** persisted.
Subsequent CLI invocations need the same shell or `rayfin/.env` value to keep using the override.

Resolution precedence per variable: shell env var > value in `rayfin/.env` > persisted `environmentConfig` in `~/.rayfin/auth.json` > built-in default.

### Routing through a credential proxy

`RAYFIN_FABRIC_API_URL` accepts a non-Fabric origin with a path prefix on top, which lets you route the CLI's REST calls through a host that mounts the Fabric API under a sub-path (for example, a credential proxy that handles auth on the user's behalf).

```sh
export RAYFIN_FABRIC_API_URL="https://my-proxy.example.com/cli-proxy/fabric/<conn_id>"
```

For non-Fabric hosts, the CLI strips a trailing slash and appends `/v1` only when the resolved path does not already end in `/v1`, then composes the full request URL by appending `/workspaces/...` (and similar) to it.
With the example above, a workspaces lookup goes to `https://my-proxy.example.com/cli-proxy/fabric/<conn_id>/v1/workspaces/...`.

For canonical Fabric hosts (`*.fabric.microsoft.com`) the behavior is different: only the origin is honored and the path is replaced with `/v1`. This preserves the historical normalization for shapes like `https://api.fabric.microsoft.com/v1/workspaces/<id>` (which gets truncated back to `<origin>/v1` rather than producing a double-pathed result).

The portal URL is **not** auto-derived from a non-`*.fabric.microsoft.com` host, so when you target a proxy you typically also want to set `RAYFIN_FABRIC_PORTAL_URL` to the portal you want deep links and `RAYFIN_PUBLIC_PORTAL_URL` to point at — usually production:

```sh
export RAYFIN_FABRIC_PORTAL_URL="https://app.fabric.microsoft.com/"
```

If your proxy also fronts the portal, point it there instead.

> **Security: bearer token forwarding.** When `RAYFIN_FABRIC_API_URL` points at a non-`*.fabric.microsoft.com` host, the CLI sends the Fabric `Bearer <token>` it acquired (whether for the production scope or a custom `RAYFIN_FABRIC_SCOPE`) to that host on every REST call. Only set this to a host you trust to handle those tokens responsibly — typically a first-party credential proxy you operate. There is currently no startup warning or trusted-host allowlist; that is a known follow-up.
>
> **Known limitation: long-running operations.** Operations that return a `202` with a `Location` header are a known limitation in proxy mode. The CLI follows the absolute URL in `Location`, which usually points back at the upstream Fabric host and bypasses your proxy. End-to-end proxy support for these polled operations needs the proxy to rewrite `Location` headers (or the CLI to grow a host-rewrite pass on the polling target). Track the follow-up before relying on proxy mode for long-running ops.

## Runtime port variables

Written to `rayfin/.env` by `rayfin up` during port allocation.
Each port starts at its default value and increments until a free port is found, so multiple projects can run side by side without conflict.
Read via `${VAR:-default}` interpolation in the generated container configuration.

| Variable | Default | Service | Docker profile |
| --- | --- | --- | --- |
| `RAYFIN_WEBSERVICE_HTTP_PORT` | 5168 | Rayfin WebService (HTTP) | always |
| `RAYFIN_WEBSERVICE_HTTPS_PORT` | 7126 | Rayfin WebService (HTTPS) | always |
| `RAYFIN_POSTGRES_PORT` | 5432 | PostgreSQL (admin database) | always |
| `RAYFIN_POSTGRES_DATAAPI_PORT` | 5433 | PostgreSQL (Data API backend) | `data-api-postgresql` |
| `RAYFIN_SQLSERVER_PORT` | 1433 | SQL Server (Data API backend) | `data-api-mssql` |
| `RAYFIN_MAILDEV_SMTP_PORT` | 1025 | MailDev SMTP | `email` |
| `RAYFIN_MAILDEV_WEB_PORT` | 1080 | MailDev web UI | `email` |
| `RAYFIN_AZURITE_BLOB_PORT` | 10000 | Azurite Blob | `storage` |
| `RAYFIN_AZURITE_QUEUE_PORT` | 10001 | Azurite Queue | `storage` |
| `RAYFIN_AZURITE_TABLE_PORT` | 10002 | Azurite Table | `storage` |
| `RAYFIN_FUNCTIONS_PORT` | 7071 | Azure Functions | `function` |
| `RAYFIN_ASPIRE_UI_PORT` | 18888 | Aspire Dashboard UI | `telemetry` |
| `RAYFIN_ASPIRE_OTLP_PORT` | 4317 | Aspire OTLP (gRPC) | `telemetry` |

Port variables are cleaned up from `rayfin/.env` when `rayfin up` shuts down.

## Database passwords

Written to `rayfin/.env` by `rayfin up`.
Passwords are generated on first run and preserved on subsequent runs so existing database volumes keep working.
Never exposed to the frontend.

| Variable | Default | Service |
| --- | --- | --- |
| `RAYFIN_POSTGRES_PASSWORD` | `YourStrong!Passw0rd` | PostgreSQL (admin database) |
| `RAYFIN_SQLSERVER_PASSWORD` | `YourStrong!Passw0rd` | SQL Server |
| `RAYFIN_POSTGRES_DATAAPI_PASSWORD` | `YourStrong!Passw0rd` | PostgreSQL (Data API backend) |

## Service configuration flags

Written to `rayfin/.env` by `rayfin up` based on `rayfin.yml` settings.
Read by the Rayfin WebService container via the ASP.NET Core configuration system.

| Variable | Source (`rayfin.yml`) | Values |
| --- | --- | --- |
| `Auth__Enabled` | `services.auth.enabled` | `true` / `false` |
| `Data__Enabled` | `services.data.enabled` | `true` / `false` |

The following signing-key variables are set to dev-mode defaults by `rayfin up` and are not typically edited:

- `Auth__AsymmetricKeys__Provider` — `local-file`
- `Auth__AsymmetricKeys__Algorithm` — `ES256`
- `Auth__AsymmetricKeys__KeySize` — `256`
- `Auth__AsymmetricKeys__LocalFile__AutoGenerateKeys` — `true`

## Shell-only variables

These variables are read from the shell environment and are never written to files.

| Variable | Description |
| --- | --- |
| `RAYFIN_TOKEN` | Pre-acquired Bearer token for headless or non-interactive usage. Bypasses interactive Entra ID login. Prefer `rayfin login --service-principal` which handles token acquisition automatically. Use `RAYFIN_TOKEN` when a token is already available from an external source (for example, `az account get-access-token`). |
| `RAYFIN_WORKSPACE_ID` | Fabric workspace ID for non-interactive setup. Used with `RAYFIN_TOKEN`. |
| `RAYFIN_TENANT_ID` | Entra ID tenant used by `rayfin up` for portal URLs and the `ctid` query parameter. Equivalent to the `-t, --tenant <id>` flag (precedence: flag > env var > signed-in tenant). |
| `RAYFIN_ENCRYPTION_FALLBACK_ENABLED` | Set to `true` to allow plaintext token cache on systems without OS credential storage. Development only. |
| `RAYFIN_FEATURE_FLAGS` | Comma-separated list of experimental feature names to enable (case-insensitive). Recognized public values include `docker-local-dev`, `postgresql`, and `storage`. |
| `RAYFIN_WEBSERVICE_IMAGE_NAME` | **Experimental.** Override the webservice container image used by `rayfin dev --provider docker` and Docker Compose. Defaults to `ghcr.io/microsoft/project-rayfin/webservice:cli-<version>`. |
| `RAYFIN_APPINSIGHTS_CONNECTION_STRING` | Override the telemetry endpoint for the CLI. |
| `RAYFIN_TELEMETRY_ENV` | Override the CLI and `create-rayfin` telemetry environment label. Values are trimmed and lowercased. Known labels include `github-actions`, `azure-pipelines`, `gitlab-ci`, `jenkins`, `codespaces`, `devcontainer`, `local`, and `other`; custom labels may contain 1–64 ASCII letters, digits, hyphens, or underscores. Invalid non-empty values map to `other`, while an empty value uses automatic detection. Do not include identifying or sensitive values. |

### Recognized `RAYFIN_FEATURE_FLAGS` values

| Flag | Effect |
| --- | --- |
| `docker-local-dev` | Allows `rayfin dev --provider docker` and the Docker maintenance commands. Bare `rayfin dev` remains available without this flag and defaults to Fabric. |
| `postgresql` | Adds PostgreSQL as a selectable dialect during `rayfin init` and `rayfin init` with bundled templates. |
| `storage` | Enables the preview Storage service when declared in `rayfin.yml` or opted in from the shell. |

## File locations

| Path | Purpose | Committed |
| --- | --- | --- |
| `rayfin/.env` | All runtime and deployment values. | No (gitignored) |
| `rayfin/.env.example` | Documents expected variables with placeholder values. | Yes |
| `rayfin/.deployments.json` | Multi-deployment registry (item IDs, API URLs, workspace IDs). | No (gitignored) |
| `rayfin/rayfin.yml` | Project configuration, service toggles, frontend framework. | Yes |
| `.env.local` | Framework-specific frontend variables, auto-generated by `rayfin env`. | No (gitignored) |
| `~/.rayfin/auth-state.json` | CLI authentication state (tenant, account hints). | N/A (user home) |
| `~/.rayfin/token-cache.json` | Encrypted token cache (OS-backed encryption). | N/A (user home) |
| `~/.rayfin/dev-device-id` | Random anonymous identifier correlating telemetry from this installation. Not written when telemetry is off; delete it to reset. | N/A (user home) |

## Resolution priority

When the same variable is defined in multiple places, the value is resolved in this order (highest priority first):

1. Shell environment variable.
1. `--env-file <path>` CLI flag (or `RAYFIN_ENV_FILE`).
1. `rayfin/.env` file.
1. Default value (hardcoded or from `rayfin.yml` interpolation).
