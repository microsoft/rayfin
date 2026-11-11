# functions-auth-config Specification

## Purpose

Defines the application-only authoring policy enforced by current Rayfin tooling for Functions generic connections.
The policy does not change app-user sign-in, function invocation authorization, connector authentication, or the service-side contract used by older clients.

## Requirements

### Requirement: Functions support an artifact-level authentication type

Enabled Functions SHALL require an explicit `services.functions.auth.type: application`.
The missing-auth requirement SHALL use the same `enabled` truthiness as execution and deployment, without coercing the authored value.
The only supported authored value in current tooling SHALL be the canonical string `application`.
Disabled Functions MAY omit auth, but any supplied auth SHALL also specify application.
The `auth` block SHALL be a mapping.
Validation SHALL reject any other value or shape with an actionable error that identifies the invalid field and explains how to configure application auth.
Disabling or excluding Functions SHALL NOT permit an explicitly invalid auth value.

#### Scenario: Builder selects delegated authentication

- **WHEN** `services.functions.auth.type` is `delegated`
- **THEN** current tooling SHALL reject the configuration
- **AND** the error SHALL instruct the Builder to set `services.functions.auth.type` to `application`

#### Scenario: Builder selects application authentication

- **WHEN** `services.functions.auth.type` is `application`
- **THEN** validation SHALL accept and preserve the authored value without a feature flag

#### Scenario: Non-boolean enablement cannot bypass required auth

- **WHEN** YAML supplies a truthy non-boolean `enabled` value, such as `"true"`, `"false"`, `yes`, `on`, or `1`
- **AND** Functions auth is omitted
- **THEN** validation SHALL reject the missing auth because downstream execution and deployment also treat that value as enabled

#### Scenario: Builder supplies an unsupported authentication type

- **WHEN** `services.functions.auth.type` contains a value other than `application`
- **THEN** `rayfin up` validation SHALL fail with an actionable validation error
- **AND** the error SHALL identify `services.functions.auth.type` and the required `application` value
- **AND** deployment SHALL NOT silently default or migrate the value

#### Scenario: Dry-run validates the authentication type

- **WHEN** a builder runs `rayfin up --dry-run` with an unsupported functions authentication type or shape
- **THEN** local validation SHALL fail before authentication or network access
- **AND** the command SHALL return the same actionable functions configuration error as a deployment

#### Scenario: Builder supplies a non-mapping authentication block

- **WHEN** `services.functions.auth` is a scalar or a sequence rather than a mapping
- **THEN** `rayfin up` validation SHALL fail with an actionable validation error
- **AND** the error SHALL identify `services.functions.auth` and the required application-auth mapping
- **AND** the malformed block SHALL NOT be sent to the workload

#### Scenario: Explicit null is not omission

- **WHEN** `services.functions.auth` or its `type` field is explicitly null, including YAML `null`, `~`, or a blank value
- **THEN** validation SHALL reject the value and identify the corresponding field
- **AND** validation SHALL NOT treat it as an omitted setting or silently default it
- **AND** an empty mapping `auth: {}` SHALL also be rejected because the type is missing

### Requirement: Application-only validation is unconditional and precedes side effects

The application-auth feature flag and capability option SHALL NOT be required or resolved by current tooling.
Setting an old feature-flag value SHALL NOT permit another auth mode or bypass validation.
The shared `validateFunctionsConfig` contract SHALL apply to legacy and v2 CLI `up` and both Fabric-backed and Docker-backed CLI `dev`.
Normal CLI `dev` SHALL validate for both providers because Fabric writes the declared services through the workload client and Docker posts them to its local `/api/projectRuntimeSettings` endpoint.
CLI `dev functions apply`, `up functions deploy`, and `up staticapp deploy` SHALL NOT validate local Functions auth because they do not apply that setting.
Applicable commands SHALL reject invalid configuration before authentication, prerequisite installation, builds, packaging, runtime launch, or upload.
Docker-backed development SHALL NOT acquire a new login requirement.
CLI `up --dry-run` SHALL enforce the same authoring policy before authentication or network access.

Direct callers of the shared up workflow SHALL receive `invalid-functions-config` before workspace resolution, item creation, project mutation, or deployment.
Validation at the runtime-settings boundary SHALL remain in place.
Environment loading required for unrelated flags and settings SHALL remain unchanged.
This tooling policy SHALL NOT be interpreted as backend readiness, a change to older clients, or service-side enforcement against direct API callers.

#### Scenario: Direct workflow caller supplies invalid Functions auth

- **WHEN** a direct up-workflow request has invalid Functions auth
- **THEN** it SHALL fail before resolving or creating cloud resources or changing local project files
- **AND** disabling or excluding Functions SHALL NOT bypass the authoring policy

#### Scenario: Docker development supplies valid application auth

- **WHEN** Docker-backed development receives valid Functions configuration
- **THEN** application auth SHALL pass local validation without a feature flag
- **AND** the auth-policy check SHALL NOT cause a developer login

#### Scenario: Standalone local Functions apply does not deploy project settings

- **WHEN** `rayfin dev functions apply` runs against an existing deployment
- **THEN** it SHALL retain its existing service-enabled, prerequisite, build, and runtime checks without adding local Functions-auth validation
- **AND** it SHALL NOT apply project runtime settings or rewrite the authored Functions auth value

#### Scenario: CLI failures preserve output conventions

- **WHEN** legacy or v2 CLI `up` rejects Functions authentication during deployment or dry-run
- **THEN** JSON mode SHALL emit exactly one structured error with code `invalid-functions-config`
- **AND** non-JSON mode SHALL surface the validation message
- **AND** recovery guidance SHALL require application auth rather than describe an opt-in flag

### Requirement: Scaffolding authors defaults but parsing does not migrate configuration

New first-party Functions scaffolds and newly enabled first-party Functions configuration SHALL author application auth when the auth block is absent.
This includes base initialization, Functions initialization, template service selection, and the bundled Universal App Functions pack.
Explicit invalid auth SHALL fail rather than be overwritten, including during forced scaffolding.
Ordinary initializer re-runs SHALL preserve existing source and configuration rather than silently migrate missing auth.
Configuration parsing SHALL preserve authored auth values, including missing or malformed values, for validation.

#### Scenario: Functions auth block is omitted

- **WHEN** a project enables `services.functions` without an `auth` block
- **THEN** full settings deployment or normal `rayfin dev` validation SHALL fail
- **AND** configuration parsing SHALL NOT add an `auth` block to the parsed configuration

#### Scenario: Functions auth type is omitted

- **WHEN** a project declares a mapping `services.functions.auth` without a `type` field, such as `auth: {}`
- **THEN** validation SHALL reject the missing type, even when Functions is disabled
- **AND** configuration parsing SHALL NOT add a `type` field to the parsed configuration

#### Scenario: Functions are disabled

- **WHEN** a project leaves Functions disabled without auth, or omits the Functions block entirely
- **THEN** validation SHALL succeed without requiring or inserting auth

#### Scenario: Fresh Functions scaffolding authors an explicit authentication type

- **WHEN** a first-party path creates or newly enables Functions without an auth block
- **THEN** the generated configuration SHALL contain `auth.type: application`
- **AND** authored paths and unrelated settings SHALL be preserved according to the initializer's existing contract

#### Scenario: Settings persisted before the default was materialized

- **WHEN** stored runtime settings for enabled functions contain no `auth` block or `type` field
- **THEN** this tooling change SHALL NOT migrate those stored settings or change the workload's existing legacy resolution behavior
- **AND** full settings deployment preflight SHALL still require explicit application auth in the local configuration

### Requirement: Shared runtime settings expose the functions authentication type

The published Rayfin runtime settings contract SHALL expose the configured value through `ServiceSettings.Functions.Auth.Type`.
The shared DTO SHALL preserve omitted auth and type as null rather than materializing a delegated value.
The exposed type SHALL preserve the `delegated` and `application` wire values so workload consumers can read the setting without defining a parallel contract.
The existing project runtime settings write SHALL preserve the functions `auth` block without requiring a second field in the functions deployment payload.

#### Scenario: Workload reads application authentication from shared settings

- **WHEN** runtime settings containing `functions.auth.type: application` are deserialized through the published Rayfin settings contract
- **THEN** `ServiceSettings.Functions.Auth.Type` SHALL resolve to `application`

#### Scenario: Workload reads delegated authentication from shared settings

- **WHEN** runtime settings containing `functions.auth.type: delegated` are deserialized through the published Rayfin settings contract
- **THEN** `ServiceSettings.Functions.Auth.Type` SHALL resolve to `delegated`

#### Scenario: Shared settings preserve omission for workload resolution

- **WHEN** runtime settings omit the functions `auth` block or its `type` field
- **THEN** the corresponding shared DTO property SHALL remain null
- **AND** the workload resolver SHALL produce the effective authentication type `delegated`

#### Scenario: Project runtime settings carry the configured type

- **WHEN** a builder deploys a project configured with `services.functions.auth.type: application`
- **THEN** the persisted project runtime settings SHALL expose `ServiceSettings.Functions.Auth.Type` as `application`
- **AND** the functions deployment payload SHALL NOT require a duplicate authentication-type field

#### Scenario: Redirect updates preserve the authentication mode

- **WHEN** a full deployment updates redirect URIs after applying application-auth settings
- **THEN** the later settings payload SHALL retain the application-auth block
- **WHEN** a content-only deployment updates redirect URIs
- **THEN** it SHALL preserve the workload's recorded Functions settings, including legacy modes
- **AND** changing local YAML alone SHALL NOT silently migrate the recorded mode

#### Scenario: Standalone deployment remains code-only

- **WHEN** `rayfin up functions deploy` deploys code
- **THEN** missing or invalid local Functions auth SHALL NOT block the code-only operation
- **AND** existing Functions-enabled, path, build, and deployment checks SHALL remain in force
- **AND** it SHALL NOT apply or compare remote auth settings
- **AND** applying changed auth settings SHALL remain part of the full `rayfin up` path

#### Scenario: Static-content deployment ignores unrelated local Functions auth

- **WHEN** `rayfin up staticapp deploy` deploys static content
- **THEN** missing or invalid local Functions auth SHALL NOT block the content-only operation
- **AND** existing static-hosting-enabled, path, build, and deployment checks SHALL remain in force
- **AND** any redirect-URI settings update SHALL preserve recorded Functions settings rather than applying local Functions auth

### Requirement: Generic connection metadata remains unchanged

Generic connection binding metadata SHALL NOT carry a credential-mode override in this change.

#### Scenario: Generic connection metadata has no authentication override

- **WHEN** a project using application auth is deployed
- **THEN** generic connection bindings SHALL continue to carry their existing metadata
- **AND** no generic connection binding SHALL carry a credential-mode override

### Requirement: Published Functions guidance describes application identity

Current Builder guides and scaffolding instructions SHALL teach application as the only supported Functions auth type.
Bundled agent skills SHALL defer to those guides rather than duplicate the auth policy.
Worker API documentation SHALL remain auth-mode agnostic and describe audience-scoped access tokens supplied by the workload.
Enabled Functions configuration examples SHALL specify `services.functions.auth.type: application` explicitly, without an application-auth feature flag.
Guidance SHALL explain that deployed Functions' generic external connections through `ctx.Tokens` use the application identity's resource permissions rather than each caller's external resource permissions.
Local Functions development guidance SHALL identify the builder's signed-in account as the identity used for external resource tokens.
It SHALL explicitly distinguish Rayfin DB access through `ctx.getDataClient()`, which always uses the invocation's Rayfin token and the caller's identity and permissions on that database.
Setting Functions auth to application SHALL NOT be described as changing the Rayfin DB identity or permissions.
It SHALL require appropriate resource grants, keep tokens server-side, and preserve app-user sign-in and function invocation authorization.
Guidance SHALL distinguish full project settings deployment from standalone code deployment.
Authoring-time resource discovery SHALL remain tied to the developer's credentials and SHALL NOT imply that the app identity has equivalent resource access.
Connector authentication and unrelated secret-provider guidance SHALL remain unchanged.

#### Scenario: Builder configures a resource connection

- **WHEN** a Builder follows the current Functions connection guide
- **THEN** the example SHALL require explicit application auth and an audience declared in the context annotation
- **AND** the guide SHALL explain the resource permissions required by the app identity
- **AND** applying changed auth settings SHALL use full `rayfin up`, not a standalone code upload

#### Scenario: An agent adds a Fabric data-agent function

- **WHEN** an agent follows the bundled Fabric data-agent skill
- **THEN** it SHALL use the Fabric access token from `ctx.Tokens.Fabric` on the server
- **AND** it SHALL preserve the MCP request flow and function invocation authorization
- **AND** it SHALL NOT promise caller-specific downstream permissions or introduce hand-managed credentials as an auth fallback
