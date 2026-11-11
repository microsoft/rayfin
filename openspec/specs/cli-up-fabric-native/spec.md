# Spec: CLI Up Fabric Native

## Purpose

Define the `rayfin up` command behavior for deploying Rayfin projects as native Fabric workload items (`AppBackend`), replacing the previous Azure Container Apps deployment model.
The command authenticates via Entra ID, creates or reuses a Rayfin item in a Fabric workspace, applies runtime settings and database configuration through workload management endpoints, and persists deployment metadata for subsequent operations.

## Requirements

### Requirement: Command Signature

The `rayfin up` command SHALL accept an optional `--workspace-id` flag for targeting a specific Fabric workspace, replacing the Azure subscription ID argument and ACA-specific flags.

#### Scenario: Workspace ID provided via flag

- **WHEN** the user runs `rayfin up --workspace-id <workspace-id>`
- **THEN** the CLI SHALL validate the workspace exists via the Fabric API
- **AND** the CLI SHALL use that workspace for creating the Rayfin item
- **AND** the CLI SHALL NOT prompt for workspace selection

#### Scenario: No workspace ID — prompt or fail closed

- **WHEN** the user runs `rayfin up` without `--workspace-id` and no prior deployment context exists
- **THEN** the CLI SHALL NOT default to the user's "My Workspace"
- **AND** the CLI SHALL prompt the user to select a workspace when running interactively
- **AND** the CLI SHALL fail with an actionable targeting error when running non-interactively

#### Scenario: Dry-run mode

- **WHEN** the user runs `rayfin up --dry-run`
- **THEN** the CLI SHALL display planned operations (workspace selection, item creation, config apply) without making API calls
- **AND** the CLI SHALL exit after displaying the plan

#### Scenario: Retained flags

- **WHEN** the command is invoked
- **AND** the `--verbose` flag SHALL remain for detailed output
- **AND** the `--dry-run` flag SHALL remain for operation preview
- **AND** the `--force` flag SHALL be available to allow destructive data schema changes

#### Scenario: Removed arguments and flags

- **WHEN** the command is invoked
- **THEN** the `[azure-subscription-id]` positional argument SHALL NOT exist
- **AND** the `--force-container` flag SHALL NOT exist
- **AND** the `--environment` flag SHALL NOT exist

### Requirement: Authentication

The CLI SHALL authenticate the user with Fabric using Entra ID before performing any deployment operations.

#### Scenario: User is authenticated

- **WHEN** the user has valid Entra ID credentials via Azure CLI
- **THEN** the CLI SHALL acquire a Fabric token for `https://api.fabric.microsoft.com/.default`
- **AND** the CLI SHALL proceed with the deployment flow

#### Scenario: User is not authenticated

- **WHEN** the user does not have valid credentials
- **THEN** the CLI SHALL display a message directing them to sign in
- **AND** the CLI SHALL exit with instructions to run `az login`

### Requirement: Rayfin Item Creation

The CLI SHALL create a Rayfin item in the target Fabric workspace using the Fabric Items API.

#### Scenario: Create new Rayfin item

- **WHEN** no Rayfin item with the project name (from `rayfin.yml`) exists in the target workspace
- **THEN** the CLI SHALL call `POST https://api.fabric.microsoft.com/v1/workspaces/{workspaceId}/items` with `{ "type": "AppBackend", "displayName": "<project-name>" }`
- **AND** the `displayName` SHALL be the project name from `rayfin.yml`
- **AND** the request SHALL NOT include a definition payload (the workload ignores it)
- **AND** the response SHALL be synchronous (HTTP 201) returning item metadata including `id`, `type`, `displayName`, `workspaceId`

#### Scenario: Rayfin item already exists — first deploy

- **WHEN** a Rayfin item with the same project name exists in the workspace
- **AND** `rayfin.yml` does NOT contain a `deployment.rayfinItemId`
- **THEN** the CLI SHALL prompt the user to confirm overwrite
- **AND** if confirmed, the CLI SHALL use the existing item (configuration is updated via dedicated endpoints, not definition upload)
- **AND** if declined, the CLI SHALL exit without changes

#### Scenario: Rayfin item already exists — redeployment

- **WHEN** `rayfin.yml` contains a `deployment.rayfinItemId` matching an item in the workspace
- **THEN** the CLI SHALL skip item creation
- **AND** the CLI SHALL proceed directly to configuration apply (runtime settings, DAB config)
- **AND** no `updateItemDefinition` call is needed (configuration is applied via dedicated endpoints)

#### Scenario: Child item provisioning is workload-managed

- **WHEN** a Rayfin item is created
- **THEN** child items (SQL Database) SHALL be provisioned by the Rayfin workload when project runtime settings are applied with the data module enabled
- **AND** the CLI SHALL NOT create child items directly
- **AND** the workload SHALL create a `SQLDbNative` artifact as a child item with name `sqldb_{artifactId}`

### Requirement: Item Definition Generation

The CLI SHALL NOT upload an item definition payload. The `AppBackend` item type does not support CICD/ALM, so definition upload is unnecessary and unsupported. Configuration is applied via dedicated management endpoints after item creation.

#### Scenario: No definition in create request

- **WHEN** the CLI creates a Rayfin item
- **THEN** the create request SHALL contain only `type` and `displayName`
- **AND** no `definition`, `creationPayload`, or `parts` field SHALL be included
- **AND** all project configuration SHALL be applied after creation via `projectRuntimeSettings` and `applyconfig` endpoints
- **AND** no `updateItemDefinition` call SHALL be made at any point (the item type does not support it)

### Requirement: Configuration Apply

After item creation, the CLI SHALL apply configuration to the Rayfin workload's management endpoints, proxied through the Fabric platform.

#### Scenario: Construct workload endpoint URL

- **WHEN** the CLI needs to call management endpoints
- **THEN** the CLI SHALL construct a workload endpoint base URL using a private (MWC) API base URL plus the workspace and artifact IDs
- **AND** the private base URL SHALL be derived from the MWC token exchange response (`TargetUriHost`) and the target workspace capacity ID
- **AND** the resulting endpoint base URL SHALL match this shape:

```text
https://<host>/webapi/capacities/<capacity-id>/workloads/BaaS/BaaSService/automatic/v1/workspaces/<workspace-id>/appbackends/<artifact-id>
```

- **AND** standard Fabric REST API calls SHALL use `Bearer <AAD token>` for the `https://api.fabric.microsoft.com/.default` audience
- **AND** workload management endpoint calls SHALL use `MwcToken <token>` obtained via the MWC token exchange

#### Scenario: Retrieve publishable key

- **WHEN** item creation completes
- **THEN** the CLI SHALL call `GET {endpoint}/api/publishable-key` to retrieve the auto-generated publishable key
- **AND** the CLI SHALL retry publishable key retrieval with exponential backoff on transient failures
- **AND** the publishable key SHALL be persisted in the deployments registry and `.env.production` (it is no longer written to `rayfin.yml`; the runtime Fabric fetch in `publishable-key-utils.ts` is the source of truth)

#### Scenario: No dedicated health check in top-level up

- **WHEN** the CLI is about to apply configuration
- **THEN** the CLI SHALL NOT call a dedicated `{endpoint}/health` endpoint in top-level `rayfin up`
- **AND** readiness SHALL be inferred from publishable key retrieval retries

#### Scenario: Runtime settings sync (triggers child provisioning)

- **WHEN** the Rayfin item endpoint is available
- **THEN** the CLI SHALL POST the `services` section from `rayfin.yml` to `{endpoint}/api/projectRuntimeSettings`
- **AND** this SHALL trigger the workload's `ModuleBootstrapperRunner` to provision child items (e.g., SQL Database via `FabricMsSqlDatabaseProvisioner`)
- **AND** the CLI SHALL use MWC token authorization for workload management calls
- **AND** the CLI SHALL retry with exponential backoff on transient failures

#### Scenario: Database configuration apply

- **WHEN** `services.data.enabled` is `true` in `rayfin.yml`
- **THEN** the CLI SHALL generate DAB config from TypeScript decorators via `generateDabConfig()`
- **AND** the CLI SHALL POST the config to `{endpoint}/api/applyconfig`
- **AND** if the schema diff contains destructive changes (dropping columns, removing tables, changing column types that would lose data), the apply SHALL fail by default
- **AND** the CLI SHALL display the specific destructive operations detected
- **AND** the CLI SHALL print guidance: `Use --force to apply destructive changes. This may result in data loss.`
- **AND** if `--force` is provided, the CLI SHALL proceed with the apply and display a warning that destructive changes are being applied
- **AND** if the schema diff contains only non-destructive changes (adding columns, adding tables, adding entities), the apply SHALL proceed without requiring `--force`

#### Scenario: Storage configuration is deferred in top-level up

- **WHEN** `services.storage.enabled` is `true` in `rayfin.yml`
- **THEN** top-level `rayfin up` SHALL NOT apply storage config to the workload endpoint
- **AND** storage config SHALL NOT be applied during top-level `rayfin up` (remote storage operations are not supported at this time)

### Requirement: Deployment Persistence

After successful deployment, the CLI SHALL persist deployment metadata to `rayfin.yml` and write environment files.

### Requirement: Idempotent Deployment

The `rayfin up` command SHALL be idempotent. Running the command multiple times against the same workspace and project SHALL produce the same end state without side effects.

#### Scenario: Re-run with existing item

- **WHEN** `rayfin up` is run and `deployment.rayfinItemId` exists in `rayfin.yml`
- **AND** the item still exists in the target workspace
- **THEN** the CLI SHALL skip item creation
- **AND** the CLI SHALL proceed directly to configuration apply
- **AND** the CLI SHALL NOT prompt for overwrite confirmation

#### Scenario: Re-run applies config as upserts

- **WHEN** `rayfin up` is re-run against an existing deployment
- **THEN** runtime settings SHALL be re-posted (the workload treats it as an upsert)
- **AND** DAB config SHALL be re-generated and re-posted (the workload replaces atomically)
- **AND** deployment metadata in `rayfin.yml` and `.env.production` SHALL be overwritten with current values

#### Scenario: Workspace reuse

- **WHEN** `rayfin up` is run and the target workspace already exists
- **THEN** the CLI SHALL reuse the existing workspace
- **AND** the CLI SHALL NOT attempt to create a duplicate workspace

#### Scenario: Update rayfin.yml

- **WHEN** the deployment completes successfully
- **THEN** the CLI SHALL write the following to `rayfin.yml`:
  - `deployment.rayfinItemId` — the Fabric item ID
  - `deployment.rayfinItemEndpoint` — the constructed workload endpoint URL
  - `deployment.fabricWorkspaceId` — the workspace ID
  - `deployment.fabricDeepLink` — URL to the item in the Fabric portal
  - `deployment.publishableKey` — the auto-generated publishable key
- **AND** the CLI SHALL remove any legacy fields (`deployment.containerAppEndpoint`, `deployment.environment`)

#### Scenario: Write .env.production

- **WHEN** the deployment completes successfully
- **THEN** the CLI SHALL create `.env.production` with:
  - `VITE_RAYFIN_API_URL={itemEndpoint}`
  - `VITE_RAYFIN_PUBLISHABLE_KEY={publishableKey}`

#### Scenario: Display success output

- **WHEN** the deployment completes successfully
- **THEN** the output SHALL include the Rayfin item endpoint URL
- **AND** the output SHALL include a deep link to the item in the Fabric portal
- **AND** the output SHALL include next steps guidance for deploying the frontend

### Requirement: RayfinItemManager Service

A new Fabric service SHALL be created to encapsulate Rayfin item lifecycle operations.

#### Scenario: Service location and pattern

- **WHEN** the service is created
- **THEN** it SHALL be located at `packages/tools/cli/src/services/fabric/rayfin-item.ts`
- **AND** it SHALL extend `FabricApiClient`
- **AND** it SHALL NOT include an `updateItemDefinition` method (the `AppBackend` item type does not support CICD/definition uploads)

#### Scenario: Create item

- **WHEN** `createRayfinItem(workspaceId, displayName)` is called
- **THEN** it SHALL send `POST /v1/workspaces/{workspaceId}/items` with `{ "type": "AppBackend", "displayName": "..." }`
- **AND** it SHALL expect a synchronous HTTP 201 response
- **AND** it SHALL return the item metadata including `id` and `workspaceId`

#### Scenario: Get or create item

- **WHEN** `getOrCreateRayfinItem(workspaceId, displayName)` is called
- **AND** an item with that name already exists
- **THEN** it SHALL prompt the user to confirm overwrite
- **AND** if confirmed, it SHALL return the existing item (configuration is updated via separate endpoints); if declined, it SHALL throw

#### Scenario: Construct endpoint URL

- **WHEN** `getRayfinItemEndpoint(workspaceId, artifactId)` is called
- **THEN** it SHALL construct the URL using the Fabric API `/v1/workspaces/{workspaceId}/appbackends/{artifactId}` pattern
- **AND** it SHALL return the full base URL for management API calls

### Requirement: Config Type Updates

The `RayfinConfig` TypeScript interface SHALL reflect the new deployment model.

#### Scenario: New deployment fields

- **WHEN** the `deployment` section is updated
- **THEN** it SHALL include `rayfinItemId`, `rayfinItemEndpoint`, `fabricWorkspaceId`, `fabricDeepLink`, `publishableKey` as optional string fields
- **AND** it SHALL NOT include `containerAppEndpoint`, `environment`, or `fabric.lakehouse`

### Requirement: ACA Code Removal

All Azure Container Apps deployment code and dependencies SHALL be removed.

#### Scenario: File removal

- **WHEN** the rework is complete
- **THEN** `services/azure/container-app-deployer.ts` SHALL be removed
- **AND** `services/azure/container-app-helper.ts` SHALL be removed
- **AND** `services/azure/api-client.ts` SHALL be removed if unused by other commands
- **AND** `utils/resource-naming.ts` SHALL be removed
- **AND** ACA-related constants SHALL be removed from `config/constants.ts`

#### Scenario: Dependency removal

- **WHEN** the rework is complete
- **THEN** the following packages SHALL be removed from `package.json`:
  - `@azure/arm-appcontainers`
  - `@azure/arm-resources`
  - `@azure/arm-containerregistry`
  - `@azure/arm-operationalinsights`
  - `@azure/arm-authorization`

### Requirement: Test Coverage

The reworked `rayfin up` command SHALL maintain unit test coverage.

#### Scenario: Updated test suite

- **WHEN** tests in `src/__tests__/up.test.ts` are updated
- **THEN** tests SHALL cover workspace selection: `--workspace-id` flag vs. default "My Workspace" fallback
- **AND** tests SHALL cover Rayfin item creation (new + existing overwrite)
- **AND** tests SHALL cover config apply via management endpoints (no definition upload)
- **AND** tests SHALL cover config apply with success and failure cases
- **AND** tests SHALL cover destructive schema protection: apply fails without `--force`, proceeds with `--force`, non-destructive changes apply freely
- **AND** tests SHALL cover idempotency: re-running `rayfin up` reuses existing item, re-applies config, produces identical output
- **AND** tests SHALL cover dry-run mode
- **AND** tests SHALL cover `rayfin.yml` persistence with new deployment fields
- **AND** tests SHALL cover error cases (auth failure, workspace not found, item creation failure)
- **AND** all ACA-related mock setups SHALL be removed

### Requirement: Redirect URI registration during static content deploy

After deploying static content, the CLI SHALL add only the bare hosting origin to `allowedRedirectUris`.
The `/auth/callback` path SHALL NOT be auto-added.

#### Scenario: Static deploy registers bare origin only

- **WHEN** static content is deployed and a hosting URL is returned
- **THEN** the deploy tool SHALL add the bare origin (e.g. `https://bold-river-a3f1bc9d02.webapp.example.com`) to `services.auth.allowedRedirectUris`
- **AND** the deploy tool SHALL NOT add a `/auth/callback` suffixed URI
- **AND** the deploy tool SHALL POST the updated services to the backend via `applyRuntimeSettings`
- **AND** the deploy tool SHALL persist the updated `allowedRedirectUris` to `rayfin.yml`

#### Scenario: Bare origin is not duplicated

- **WHEN** the bare origin already exists in `allowedRedirectUris`
- **THEN** the deploy tool SHALL NOT add a duplicate entry
- **AND** no backend POST or `rayfin.yml` write SHALL occur for redirect URIs

#### Scenario: Auth disabled does not skip origin registration

- **WHEN** `services.auth.enabled` is `false` or absent
- **THEN** the deploy tool SHALL still add the bare origin to `allowedRedirectUris`
- **AND** this is required for the Fabric/Power BI embedded postMessage handoff regardless of interactive auth state
