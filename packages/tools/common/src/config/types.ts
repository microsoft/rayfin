/** Data-path dialects. Mirrors DatabaseDialects in Microsoft.Rayfin.Common. */
export const DatabaseDialect = {
  MsSql: 'mssql',
  PostgreSql: 'postgresql',
} as const;

export type Dialect = (typeof DatabaseDialect)[keyof typeof DatabaseDialect];

/**
 * Connector-only analyzer dialects. Kept separate from `DatabaseDialect` so
 * the data path stays narrowly typed. Both entries share Fabric Warehouse
 * engine semantics today; separate values leave room for future divergence.
 */
export const ConnectorDialect = {
  FabricWarehouse: 'fabric-warehouse',
  FabricSqlAnalytics: 'fabric-sqlanalytics',
} as const;

export type ConnectorDialectType =
  (typeof ConnectorDialect)[keyof typeof ConnectorDialect];

/** Union accepted by the analyzer (data + connector dialects). */
export type AnalyzerDialect = Dialect | ConnectorDialectType;

/**
 * Magic link configuration settings for passwordless authentication.
 */
export interface MagicLinkConfig {
  enabled: boolean;
  expiryMinutes?: number;
}

/**
 * SMS OTP configuration settings for passwordless authentication.
 */
export interface SmsOtpConfig {
  enabled: boolean;
}

/**
 * Passwordless authentication configuration settings.
 */
export interface PasswordlessConfig {
  magicLink?: MagicLinkConfig;
  smsOtp?: SmsOtpConfig;
}

/**
 * Password-based authentication configuration settings.
 */
export interface PasswordConfig {
  enabled: boolean;
}

/**
 * Fabric brokered authentication configuration settings (Entra SSO).
 */
export interface FabricConfig {
  enabled: boolean;
  /**
   * Whether external delegated Entra token exchange is enabled for this project.
   *
   * When true, callers holding a delegated Entra token (an agent, CLI, or a third-party
   * host embedding the app) may exchange it for a Rayfin session via the workload's
   * external brokered endpoints, subject to item-level Fabric permissions. This is an
   * additive opt-in on top of `enabled` that widens the set of accepted callers, so it
   * defaults to `false` and must be enabled explicitly.
   */
  externalEntraExchange?: boolean;
}

/**
 * Available authentication methods.
 */
export type AuthMethod = 'email-password' | 'magic-link' | 'fabric';

/** Supported values for `services.staticHosting.assetAccess`. */
export const STATIC_HOSTING_ASSET_ACCESS_VALUES = [
  'protected',
  'public',
] as const;

/** Who can load a static-hosted app's assets. */
export type StaticHostingAssetAccess =
  (typeof STATIC_HOSTING_ASSET_ACCESS_VALUES)[number];

/**
 * Static hosting configuration for serving frontend content.
 */
export interface StaticHostingConfig {
  enabled: boolean;
  /**
   * Path to the frontend package directory, relative to the Rayfin project
   * root (the directory containing `rayfin/rayfin.yml`). When set, the CLI
   * resolves the build command working directory and output folder relative
   * to this path instead of the project root. Omit to preserve the existing
   * single-package behaviour.
   */
  path?: string;
  /**
   * Root directory of the frontend project, relative to `path` (or the
   * project root when `path` is omitted). Absolute and parent-traversing
   * values are invalid.
   */
  root?: string;
  /**
   * Output folder containing built static files, relative to `root`.
   * Absolute and parent-traversing values are invalid.
   */
  folder: string;
  /** Build command to execute before serving/deploying. */
  buildCommand?: string;
  /** Default index document name. */
  indexDocument?: string;
  /**
   * Who can load the app's hosted assets.
   *
   * Left `undefined` when the Builder has not chosen an access mode. Absence
   * is meaningful: `rayfin up` requires an explicit selection instead of
   * changing access implicitly.
   */
  assetAccess?: StaticHostingAssetAccess;
  /** Embedded-hosting knobs (`services.staticHosting.embedded`). */
  embedded?: EmbeddedHostingConfig;
}

/**
 * Embedded static-hosting settings.
 */
export interface EmbeddedHostingConfig {
  /**
   * Whether the app loads only inside the Fabric portal (no standalone URL).
   *
   * Left `undefined` when the Builder has not chosen a posture.
   */
  only?: boolean;
}

/**
 * Supported frontend frameworks for the `rayfin env` command.
 *
 * `vite`, `nextjs` — emit framework-prefixed variables.
 * `plain`          — emit variables with no prefix (strip `RAYFIN_PUBLIC_`).
 */
export type FrontendFrameworkConfig = 'vite' | 'nextjs' | 'plain';

/**
 * Frontend integration configuration.
 *
 * @deprecated As of CLI 1.17, the frontend framework is auto-detected at
 * runtime from `vite.config.*` / `next.config.*` / `package.json`. This
 * type is retained for backward compatibility with `rayfin.yml` files that
 * still carry a `frontend:` section, but new projects should not set it.
 */
export interface FrontendConfig {
  /** Target frontend framework. */
  framework?: FrontendFrameworkConfig;
  /** Directory (relative to project root) where `.env.local` is written. */
  outputDir?: string;
}

/**
 * Functions configuration for serverless TypeScript User Data Functions.
 *
 * Source folder is always `rayfin/functions/`.
 */
export interface FunctionsConfig {
  enabled: boolean;
  /** Generic-connection authentication. Required when Functions are enabled. */
  auth?: FunctionsAuthConfig;
  /**
   * Path to the functions package directory, relative to the Rayfin project
   * root. When set, the CLI resolves the functions source folder and
   * `tsconfig.json` relative to this path. Omit to use the project root.
   */
  path?: string;
  /** Build command to execute before deploying (e.g. `npm run build`). */
  buildCommand?: string;
}

/**
 * Supported artifact-level authentication type for Rayfin Functions tooling.
 * Only explicit application authentication is supported.
 */
export type FunctionsAuthType = 'application';

/** Artifact-level authentication configuration for Rayfin Functions. */
export interface FunctionsAuthConfig {
  /** Explicit authentication type; no default is applied. */
  type: FunctionsAuthType;
}

/**
 * The full Rayfin project configuration as defined in `rayfin/rayfin.yml`.
 *
 * Shared across the CLI and other consumers.
 */
export interface RayfinConfig {
  id: string;
  name: string;
  version: string;
  services: {
    auth: {
      enabled: boolean;
      expiryInMinutes?: number;
      customClaims?: Record<string, string>;
      scopes?: string[];
      refreshToken?: {
        lifetimeInDays?: number;
      };
      password?: PasswordConfig;
      email?: {
        enabled: boolean;
        provider: string;
        senderName: string;
        verificationTokenExpirationHours: number;
        passwordResetTokenExpirationMinutes: number;
        smtp?: {
          host: string;
          port: number;
          senderEmail: string;
          username?: string;
          password?: string;
          useSsl?: boolean;
          useStartTls?: boolean;
          webPort?: number;
        };
      };
      passwordless?: PasswordlessConfig;
      fabric?: FabricConfig;
      allowedRedirectUris?: string[];
    };
    data: {
      enabled: boolean;
      dialect?: Dialect;
      /**
       * Whether GraphQL introspection (`__schema` / `__type` queries) is enabled
       * for this project. Defaults to `false` so the schema is not exposed to
       * clients holding only a publishable key. Set to `true` to opt in (for
       * example, when using local GraphQL tooling against the dev artifact).
       */
      allowIntrospection?: boolean;
      /**
       * Path to the data package directory, relative to the Rayfin project
       * root. When set, the CLI resolves entity definitions and TypeScript
       * compilation relative to this path. Omit to use the project root.
       */
      path?: string;
      /** Build command to execute before entity compilation (e.g. `npm run build`). */
      buildCommand?: string;
    };
    storage?: {
      enabled: boolean;
      /**
       * Path to the storage package directory, relative to the Rayfin project
       * root. When set, the CLI resolves storage-related file references
       * relative to this path. Omit to use the project root.
       */
      path?: string;
    };
    staticHosting?: StaticHostingConfig;
    functions?: FunctionsConfig;
    /**
     * @deprecated No-op. Connectors are generally available and the
     * `rayfin connector ...` command group is always registered, so there is
     * nothing left to opt into. Retained so existing `rayfin.yml` files keep
     * parsing; the value is no longer read.
     */
    connectors?: {
      enabled: boolean;
    };
  };
  /**
   * @deprecated Frontend framework is now auto-detected at runtime.
   * Retained for backward compatibility with existing `rayfin.yml` files.
   */
  frontend?: FrontendConfig;
  /**
   * External data connectors. In `rayfin.yml` this is a top-level array
   * (sibling of `services`); each entry self-describes via `name` and
   * `type`. Reading also tolerates the legacy map shape (keyed by name);
   * see `parseRayfinYaml` for the normalization.
   */
  connectors?: ConnectorEntry[];
}

/**
 * Runtime connector-type constants (single source of truth).
 * Values use kebab-case matching the YAML/JSON representation.
 *
 * Prefer `Connector.FabricSql` over the raw string literal so callers
 * stay in sync with the {@link ConnectorType} union.
 */
export type ConnectorType =
  | 'fabric-sqlanalytics'
  | 'fabric-warehouse'
  | 'fabric-sqldatabase'
  | 'fabric-semanticmodel'
  | 'kusto';

export const Connector = {
  FabricSqlAnalytics: 'fabric-sqlanalytics',
  FabricWarehouse: 'fabric-warehouse',
  FabricSql: 'fabric-sqldatabase',
  FabricSemanticModel: 'fabric-semanticmodel',
  Kusto: 'kusto',
} as const;

/**
 * Supported authentication types for external connectors.
 * Category A connectors default to `application`; Category B connectors
 * default to `delegated` (on-behalf-of) when added by the CLI.
 * Mirrors the host `ConnectorAuthType` enum.
 */
export type ConnectorAuthType = 'delegated' | 'application';

/**
 * Authentication block for a single connector entry.
 */
export interface ConnectorAuthSettings {
  type: ConnectorAuthType;
}

/**
 * Operation identifiers supported by the Lakehouse SQL Analytics endpoint
 * (`fabric-sqlanalytics`). Read-only — the SQL endpoint over Lakehouse is
 * a query surface, not a write surface. Declared as an `as const` tuple
 * so the type and the runtime list cannot drift.
 */
export const LAKEHOUSE_CONNECTOR_OPERATIONS = ['read'] as const;

/**
 * Operation types supported by the Lakehouse SQL Analytics endpoint.
 */
export type LakehouseConnectorOperationType =
  (typeof LAKEHOUSE_CONNECTOR_OPERATIONS)[number];

/**
 * Operation identifiers supported by Fabric SQL / Warehouse connectors
 * (Category A — direct-database CRUD). Declared once as an `as const`
 * tuple so the type and the runtime list cannot drift.
 */
export const FABRIC_SQL_CONNECTOR_OPERATIONS = [
  'read',
  'create',
  'update',
  'delete',
] as const;

/**
 * Operation types supported by Fabric SQL / Warehouse connectors
 * (Category A — direct-database CRUD).
 */
export type FabricSqlConnectorOperationType =
  (typeof FABRIC_SQL_CONNECTOR_OPERATIONS)[number];

/**
 * Operation identifiers supported by Fabric semantic model connectors
 * (Category B — function-bridge / DAX query execution). Declared once as
 * an `as const` tuple so the type and the runtime list cannot drift.
 */
export const FABRIC_SEMANTIC_MODEL_CONNECTOR_OPERATIONS = [
  'executeQuery',
] as const;

/**
 * Operation types supported by Fabric semantic model connectors
 * (Category B — function-bridge / DAX query execution).
 */
export type FabricSemanticModelConnectorOperationType =
  (typeof FABRIC_SEMANTIC_MODEL_CONNECTOR_OPERATIONS)[number];

/**
 * Operation identifiers supported by Kusto connectors
 * (Category B — function-bridge / KQL execution).
 *
 * - `executeQuery` — KQL query via the cluster `/v1/rest/query` endpoint.
 * - `executeCommand` — Kusto management (control) command via `/v1/rest/mgmt`.
 */
export const KUSTO_CONNECTOR_OPERATIONS = [
  'executeQuery',
  'executeCommand',
] as const;

/**
 * Operation types supported by Kusto connectors.
 */
export type KustoConnectorOperationType =
  (typeof KUSTO_CONNECTOR_OPERATIONS)[number];

/**
 * Supported operation types for connectors.
 * Values match the `EnumMember` strings on the host `ConnectorOperationType`
 * enum. Composed from the per-connector operation unions so each connector
 * type can be reasoned about independently while still sharing one wire
 * vocabulary.
 */
export type ConnectorOperationType =
  | LakehouseConnectorOperationType
  | FabricSqlConnectorOperationType
  | FabricSemanticModelConnectorOperationType
  | KustoConnectorOperationType;

/**
 * Connector-specific configuration (e.g. workspaceId, itemId for Fabric connectors).
 *
 * This is the shared shape for *every* connector's `config:` block in
 * `rayfin.yml`, so it deliberately stays generic. Connector-type-specific
 * routing values (for example Kusto's resolved `queryServiceUri` /
 * `databaseName`) do **not** belong here — they live in the connector-owned,
 * CLI-generated `rayfin/connectors/<name>/schema.ts` `connectorConfig` (typed
 * via that connector's package, e.g. `KustoConnectorConfig`) so they never leak
 * onto other connector types or into the host contract.
 */
export interface ConnectorConfigSettings {
  workspaceId?: string;
  itemId?: string;
}

/**
 * Single entry in the `operations:` list of a `ConnectorEntry`.
 *
 * Operations are objects (not bare strings) so future operation-level
 * metadata can be added without a wire-shape break. Mirrors the host
 * `ConnectorOperation` model in `Microsoft.Rayfin.Common.Models`.
 */
export interface ConnectorOperationEntry {
  /** Operation identifier (e.g. `read`, `executeQuery`). */
  name: ConnectorOperationType;
}

/**
 * Authentication settings for a single connector entry.
 *
 * Mirrors the host `ConnectorAuthSettings` model in
 * `Microsoft.Rayfin.Common.Models`, where `auth` is a required field on
 * `ConnectorSettings`.
 */
export interface ConnectorAuthEntry {
  /** Authentication type for this connector (e.g. `delegated`, `application`). */
  type: ConnectorAuthType;
}

/**
 * Configuration for an external data connector. In `rayfin.yml` these are
 * declared as an array under the top-level `connectors:` key; the entry's
 * `name` is what `rayfin connector add/remove/list` look up. Reading also
 * tolerates the legacy map shape (keyed by name) and the legacy
 * `connector:` field name; see `parseRayfinYaml`.
 */
export interface ConnectorEntry {
  /** Builder-chosen identifier; unique within `connectors`. */
  name: string;
  /** Connector kind from `CONNECTOR_CATALOG` (e.g. `fabric-sqldatabase`). */
  type: ConnectorType;
  /**
   * Pinned adapter/protocol version. Required for function-bridge connectors
   * (e.g. `fabric-semanticmodel`); ignored for connectors that don't declare
   * `requiresVersion` in `CONNECTOR_CATALOG`. The version is at the connector
   * level (not under `config`) because different versions of the same
   * connector type may accept different `config` shapes.
   */
  version?: string;
  config?: ConnectorConfigSettings;
  /**
   * CRUD / query operations the Builder is opting in to for this connector.
   * Each entry is an object so additional per-operation metadata can be
   * added later without a breaking change.
   *
   * The host validator rejects any operation not in
   * `CONNECTOR_CATALOG[connector].allowedOperations`.
   */
  operations?: ConnectorOperationEntry[];
  /**
   * Authentication settings for this connector. Required by the host
   * (`ConnectorSettings.Auth`), which dereferences `auth.type` during
   * validation. `connector add` writes the connector type's `defaultAuth`
   * from `CONNECTOR_CATALOG`; validation rejects omitted auth.
   */
  auth?: ConnectorAuthEntry;
}

/**
 * Deployment metadata for a single Fabric workspace.
 *
 * Historically serialized to `.env.fabric-*` files; as of env-strategy v2
 * this shape is serialized into `rayfin/.deployments.json` instead.
 */
export interface DeploymentInfo {
  fabricItemId?: string;
  /** Fabric display name of the deployed Rayfin item. */
  itemName?: string;
  fabricApiUrl?: string;
  fabricWorkspaceId?: string;
  fabricDeepLink?: string;
  /**
   * Entra ID tenant the workspace lives in. Required when the user has access
   * to multiple tenants — the CLI uses it to target the correct authority for
   * token acquisition and to build tenant-scoped portal URLs (`?ctid=…`).
   */
  fabricTenantId?: string;
  publishableKey?: string;
  hostingUrl?: string;
  /** ISO-8601 timestamp of the most recent `rayfin up` for this workspace. */
  deployedAt?: string;
}

/**
 * The full deployment registry persisted to `rayfin/.deployments.json`.
 */
export interface DeploymentsRegistry {
  /** Sanitized workspace name currently selected by `rayfin up`/`up switch`. */
  active?: string;
  /** Map of sanitized workspace name → deployment metadata. */
  deployments: Record<string, DeploymentInfo>;
}
