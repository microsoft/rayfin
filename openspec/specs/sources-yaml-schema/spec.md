# Sources YAML Schema

## ADDED Requirements

### Requirement: Sources Top-Level Configuration Key

The `rayfin.yml` configuration file SHALL support a `connectors` top-level key that contains named data source entries for external data integration.

**ID**: `SOURCES-YAML-001`

#### Scenario: Valid sources section with a Fabric connector

- **WHEN** `rayfin.yml` contains:

  ```yaml
  sources:
    inventory:
      connector: fabric-sqlanalytics
      config:
        workspaceId: ${INVENTORY_WS_ID}
        itemId: ${INVENTORY_ITEM_ID}
  ```

- **THEN** the config parser SHALL parse the `connectors` section into a map of source entries keyed by name
- **AND** each entry SHALL have `connector` as a required field
- **AND** Fabric connector-specific fields (`workspaceId`, `itemId`) SHALL be nested under `config`

#### Scenario: Sources section is optional

- **WHEN** `rayfin.yml` does not contain a `connectors` key
- **THEN** the config parser SHALL treat the sources map as empty
- **AND** SHALL NOT produce a validation error

### Requirement: Source Entry Validation

Each entry under `connectors` SHALL be validated against connector-specific rules during config loading.

**ID**: `SOURCES-YAML-002`

#### Scenario: Reject entry missing connector field

- **WHEN** `rayfin.yml` contains a source entry without `connector`:

  ```yaml
  sources:
    inventory:
      config:
        workspaceId: abc
  ```

- **THEN** the CLI SHALL exit with a non-zero code
- **AND** SHALL print: `Source "inventory" is missing required field "connector".`

#### Scenario: Reject fabric connector missing config.workspaceId

- **WHEN** `rayfin.yml` contains:

  ```yaml
  sources:
    inventory:
      connector: fabric-sqlanalytics
      config:
        itemId: abc
  ```

- **THEN** the CLI SHALL exit with a non-zero code
- **AND** SHALL print: `Source "inventory" (fabric-sqlanalytics) requires "config.workspaceId".`

#### Scenario: Reject fabric connector missing config.itemId

- **WHEN** `rayfin.yml` contains:

  ```yaml
  sources:
    inventory:
      connector: fabric-sqlanalytics
      config:
        workspaceId: abc
  ```

- **THEN** the CLI SHALL exit with a non-zero code
- **AND** SHALL print: `Source "inventory" (fabric-sqlanalytics) requires "config.itemId".`

#### Scenario: Reject fabric connector missing config entirely

- **WHEN** `rayfin.yml` contains:

  ```yaml
  sources:
    inventory:
      connector: fabric-warehouse
  ```

- **THEN** the CLI SHALL exit with a non-zero code
- **AND** SHALL print: `Source "inventory" (fabric-warehouse) requires "config.workspaceId".`

#### Scenario: Reject unsupported connector type in YAML

- **WHEN** `rayfin.yml` contains:

  ```yaml
  sources:
    foo:
      connector: unsupported-thing
  ```

- **THEN** the CLI SHALL exit with a non-zero code
- **AND** SHALL print an error listing supported connector types

### Requirement: Source Entry Auth Model

All Fabric connectors use delegated (on-behalf-of) authentication. The auth type defaults to `delegated` and does not need to be explicitly specified.

**ID**: `SOURCES-YAML-003`

#### Scenario: Delegated auth is the default

- **WHEN** a source entry omits the `auth` field entirely
- **THEN** the config parser SHALL treat the auth type as `delegated`
- **AND** SHALL accept the entry as valid

#### Scenario: Explicit delegated auth

- **WHEN** a source entry contains `auth.type: delegated`
- **THEN** no additional auth fields SHALL be required
- **AND** the config parser SHALL accept the entry as valid

### Requirement: Environment Variable Interpolation in Sources

Source entry values SHALL support the same `${VAR}` and `${VAR:-default}` interpolation syntax used elsewhere in `rayfin.yml`, consistent with the `rayfin-config-env-interpolation` spec.

**ID**: `SOURCES-YAML-004`

#### Scenario: Interpolate config.workspaceId and config.itemId

- **WHEN** `rayfin.yml` contains `config.workspaceId: ${WS_ID}` and `.env` defines `WS_ID=abc-123`
- **THEN** the resolved config SHALL have `config.workspaceId: "abc-123"`

#### Scenario: Unresolved variable without default produces error

- **WHEN** `rayfin.yml` contains `config.workspaceId: ${MISSING_VAR}` and no env var or default is defined
- **THEN** the CLI SHALL exit with a non-zero code
- **AND** SHALL print: `Unresolved environment variable: MISSING_VAR (in connectors.inventory.config.workspaceId)`

### Requirement: Connector name Constraints

Connector names (keys under `connectors`) SHALL follow naming constraints to ensure they are valid as file system directory names and identifiers across the stack.

**ID**: `SOURCES-YAML-005`

#### Scenario: Valid Connector name

- **WHEN** `rayfin.yml` contains a Connector named `inventory`, `my-source`, `reports_v2`, or `myDataSource01`
- **THEN** the config parser SHALL accept the name

#### Scenario: Invalid Connector name with special characters

- **WHEN** `rayfin.yml` contains a Connector named `my source!` or `data@source`
- **THEN** the CLI SHALL exit with a non-zero code
- **AND** SHALL print: `Connector name "my source!" contains invalid characters. Only alphanumeric characters, hyphens, and underscores are allowed.`

#### Scenario: Connector name exceeds maximum length

- **WHEN** `rayfin.yml` contains a Connector name longer than 256 characters
- **THEN** the CLI SHALL exit with a non-zero code
- **AND** SHALL print: `Connector name "..." exceeds maximum length of 256 characters.`

#### Scenario: Connector name pattern

- **WHEN** validating a Connector name
- **THEN** it SHALL match the pattern `^[a-zA-Z0-9\-_]+$`
- **AND** SHALL not exceed 256 characters

### Requirement: TypeScript ConnectorType string union

The `@microsoft/rayfin-tools-common` package SHALL export a `ConnectorType` string union type that enumerates all supported connector types. The union values SHALL use kebab-case identifiers matching the YAML representation.

The `SourceEntry.connector` field type SHALL change from `string` to `ConnectorType`.
This is the known validation set, not the current authoring set; authorability is controlled by the live connector catalog's `authoring` policy.

```typescript
type ConnectorType =
  | 'fabric-sqldatabase'
  | 'fabric-warehouse'
  | 'fabric-sqlanalytics'
  | 'fabric-semanticmodel'
  | 'kusto';
```

**ID**: `SOURCES-YAML-006`

#### Scenario: SourceEntry uses ConnectorType union

- **WHEN** a developer defines a `SourceEntry` in TypeScript
- **THEN** the `connector` field SHALL only accept values from the `ConnectorType` union
- **AND** the TypeScript compiler SHALL reject invalid connector strings at compile time

#### Scenario: ConnectorType values match YAML identifiers

- **WHEN** a `ConnectorType` value is serialized to YAML
- **THEN** the value SHALL be the exact kebab-case string (e.g., `'fabric-sqlanalytics'`)
- **AND** no transformation SHALL be needed between the type value and the YAML representation

### Requirement: KNOWN_CONNECTOR_TYPES derived from ConnectorType

The `KNOWN_CONNECTOR_TYPES` array in `validateSources.ts` SHALL be derived from the `ConnectorType` union values. The array SHALL satisfy `readonly ConnectorType[]` to ensure it stays in sync with the union.

**ID**: `SOURCES-YAML-007`

#### Scenario: KNOWN_CONNECTOR_TYPES matches ConnectorType

- **WHEN** a new value is added to the `ConnectorType` union
- **AND** `KNOWN_CONNECTOR_TYPES` does not include the new value
- **THEN** the TypeScript compiler SHALL produce a type error

#### Scenario: validateSources uses typed array

- **WHEN** `validateSources` checks connector membership
- **THEN** it SHALL check against `KNOWN_CONNECTOR_TYPES` typed as `readonly ConnectorType[]`

### Requirement: C# ConnectorType enum (handled by PR #1186)

> **Note:** The C# `ConnectorType` enum in `Microsoft.Rayfin.Common.Models` is defined and tested in PR #1186 (`connector-model` branch). This spec documents the contract for compatibility; implementation is not needed here.

The enum uses `EnumMemberJsonConverter<ConnectorType>` with kebab-case serialization. Unrecognized connector strings SHALL throw a `JsonException` (no `Unknown` sentinel — fail fast).

```csharp
[JsonConverter(typeof(EnumMemberJsonConverter<ConnectorType>))]
public enum ConnectorType
{
    [EnumMember(Value = "fabric-sqlanalytics")]
    FabricSqlAnalytics,

    [EnumMember(Value = "fabric-warehouse")]
    FabricWarehouse,

    [EnumMember(Value = "fabric-sqldatabase")]
    FabricSqlDatabase,

    [EnumMember(Value = "fabric-semanticmodel")]
    FabricSemanticModel,

    [EnumMember(Value = "kusto")]
    Kusto,

    [EnumMember(Value = "office365users")]
    Office365Users,
}
```

The live TypeScript catalog and host enum are authoritative if this documented compatibility set changes.
Known types can be held from new authoring without becoming invalid for existing projects.

**ID**: `SOURCES-YAML-008`

#### Scenario: SourceSettings.Connector uses ConnectorType enum

- **WHEN** `SourceSettings` is deserialized from JSON
- **THEN** the `Connector` field SHALL deserialize `"fabric-sqlanalytics"` to `ConnectorType.FabricSqlAnalytics`

#### Scenario: Unknown connector throws on deserialization

- **WHEN** `SourceSettings` is deserialized from JSON containing an unrecognized connector string
- **THEN** deserialization SHALL throw a `JsonException`
- **AND** the error SHALL be caught and reported as a validation failure

#### Scenario: Serialization round-trip preserves kebab-case

- **WHEN** a `SourceSettings` object with `Connector = ConnectorType.FabricSqlAnalytics` is serialized to JSON
- **THEN** the output SHALL contain `"connector": "fabric-sqlanalytics"`
- **AND** deserializing that JSON back SHALL produce `ConnectorType.FabricSqlAnalytics`

### Requirement: SourceSettings uses nested config (handled by PR #1186)

> **Note:** The `SourceConfigSettings` class (with `workspaceId` and `itemId` under `config`) is defined in PR #1186. This spec documents the contract for compatibility.

`SourceSettings` SHALL have a `Config` property of type `SourceConfigSettings` containing connector-specific configuration. Fabric connectors require `config.workspaceId` and `config.itemId`.

**ID**: `SOURCES-YAML-009`

#### Scenario: Config bag structure

- **WHEN** a source entry is serialized to JSON
- **THEN** `workspaceId` and `itemId` SHALL be nested under `"config"`:

  ```json
  {
    "connector": "fabric-sqlanalytics",
    "config": { "workspaceId": "ws-1", "itemId": "item-1" }
  }
  ```

### Requirement: CLI connector catalog uses ConnectorType

The connector catalog in `packages/tools/common/src/config/connectors.ts` SHALL key its `CONNECTOR_CATALOG` map using `ConnectorType` values instead of plain strings. The catalog lives in `@microsoft/rayfin-tools-common` so it can be shared across the CLI and other consumers.

**ID**: `SOURCES-YAML-010`

#### Scenario: Catalog keys match ConnectorType

- **WHEN** a developer adds a new connector to the catalog
- **THEN** the key MUST be a valid `ConnectorType` value
- **AND** the TypeScript compiler SHALL reject non-ConnectorType keys

#### Scenario: CLI --connector flag validates against ConnectorType

- **WHEN** a user runs `rayfin connector add --connector invalid-type`
- **THEN** the CLI SHALL reject the value with an error listing valid `ConnectorType` values

### Requirement: TypeScript SourceAuthType string union

The `@microsoft/rayfin-tools-common` package SHALL export a `SourceAuthType` string union type that enumerates supported source authentication types. Initially only `delegated` is supported; the union is defined for type safety and future extensibility.

```typescript
type SourceAuthType = 'delegated';
```

**ID**: `SOURCES-YAML-011`

#### Scenario: SourceEntry auth uses SourceAuthType union

- **WHEN** a developer defines a `SourceEntry` with an `auth` block in TypeScript
- **THEN** the `auth.type` field SHALL only accept values from the `SourceAuthType` union
- **AND** the TypeScript compiler SHALL reject invalid auth type strings at compile time

### Requirement: C# SourceAuthType enum (handled by PR #1186)

> **Note:** The C# `SourceAuthType` enum is defined in PR #1186. This spec documents the contract for compatibility.

The enum uses `EnumMemberJsonConverter<SourceAuthType>` with kebab-case serialization. Only `Delegated` is supported initially.

```csharp
[JsonConverter(typeof(EnumMemberJsonConverter<SourceAuthType>))]
public enum SourceAuthType
{
    [EnumMember(Value = "delegated")]
    Delegated,
}
```

**ID**: `SOURCES-YAML-012`

#### Scenario: SourceAuthSettings.Type uses SourceAuthType enum

- **WHEN** `SourceAuthSettings` is deserialized from JSON containing `"type": "delegated"`
- **THEN** the `Type` field SHALL deserialize to `SourceAuthType.Delegated`
