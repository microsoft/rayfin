# Project Context

> **Note for AI Agents**: This file provides OpenSpec-specific project context. For comprehensive repository structure, key components, and coding standards, refer to `@/.github/instructions/overview.instructions.md`.

## Purpose

**Project Rayfin** is a modern Backend-as-a-Service (BaaS) platform designed for the coding agent era, enabling teams to build and ship applications faster. The platform focuses on:

- Simplifying Data API Builder (DAB) adoption through code-first configuration
- Providing ready-to-use backend infrastructure for rapid application development
- Supporting seamless collaboration between humans and AI assistants
- Following an open-core model for self-hosting with cloud productivity features
- Delivering CLI tools for environment setup, deployment, and operations
- Enabling multi-tenant data access patterns with strong type safety

## Repository Overview

For detailed information about:

- **Repository Structure**: See `@/.github/instructions/overview.instructions.md` → Repository Structure section
- **Key Components**: See `@/.github/instructions/overview.instructions.md` → Key Components section
- **Technology Stack**: See `@/.github/instructions/overview.instructions.md` → Technology Stack section
- **Coding Standards**: See `@/.github/instructions/overview.instructions.md` → Coding Standards section

## Tech Stack

> **Note**: For the complete technology stack details, see `@/.github/instructions/overview.instructions.md` → Technology Stack section.

### Key Technologies

- **TypeScript 5.8+** with modern decorators
- **.NET 8.0** with C# and nullable reference types
- **Vitest** and **xUnit** for testing
- **Rush** monorepo with pnpm 10.17.1
- **Data API Builder (DAB)** for REST/GraphQL API generation
- Multi-dialect database support: MSSQL, PostgreSQL, MySQL, Cosmos DB

## Project Conventions

> **Note**: For comprehensive coding standards and conventions, see `@/.github/instructions/overview.instructions.md` → Coding Standards section.

### Code Style Summary

- **TypeScript**: Strict mode, single quotes, no semicolons, `importHelpers: false`, modern decorators
- **C#**: Nullable reference types, implicit usings, dotnet format on build
- **Documentation**: Comprehensive JSDoc for all public APIs

### Architecture Patterns

For detailed package descriptions and architecture, see `@/.github/instructions/overview.instructions.md` → Key Components section.

#### Core Design Patterns

- **Service container pattern** for provider abstraction (see todo-app sample)
- **Code-first configuration** via decorators
- **Type-safe API clients** with compile-time validation
- **Multi-tenant data access** patterns
- **Stateless JWT authentication** architecture

### Testing Strategy

For complete testing details, see `@/.github/instructions/overview.instructions.md`.

#### Key Testing Principles

- **TypeScript**: Vitest with v8 coverage, tests colocated with source
- **.NET**: xUnit framework with `*.Tests` naming convention
- **Mocking**: Service-based design enables easy test doubles
- **Commands**: `rush test`, `rush test:watch`, `dotnet test`

### Git Workflow

#### Branching Strategy

- **Main branch**: `main` (default branch)
- Feature branches created from main
- Follow GitHub flow for pull requests

#### Contribution Process

1. **Open an issue** before starting work (required for all contributions)
2. For large changes, propose a **PRD** in `docs/prd/`
3. Create focused, scoped pull requests
4. Include rationale and test results in PR description
5. **Disclose AI assistance** if tools were used

#### Commit Conventions

- Clear, descriptive commit messages
- Reference issue numbers when applicable
- Follow pre-commit hooks for formatting/linting

#### Pre-flight Checklist

- All tests pass (`rush test` and `dotnet test`)
- Code is formatted (`rush format` and `dotnet format`)
- Linting passes (`rush lint` and `rush lint:docs`)
- Documentation updated if needed
- AI assistance disclosed if applicable

## Domain Context

### Data API Builder (DAB)

**Data API Builder** is Microsoft's tool for auto-generating REST and GraphQL APIs from databases. Rayfin builds on DAB by providing:

- **Code-first configuration** via TypeScript decorators instead of manual JSON
- **x-schema extensions** for multi-dialect database support
- **Type-safe client libraries** that understand DAB's specific behaviors (e.g., boolean serialization, response unwrapping)

### Rayfin Platform Terminology

- **Rayfin Builder**: Developer building apps using the Rayfin platform
- **Rayfin Contributor**: Developer contributing to Rayfin itself
- **Rayfin App/Project**: Application built with Rayfin SDKs
- **Rayfin Workload**: Services hosted in Microsoft Fabric (cloud-managed)
- **Rayfin OSS Host**: Services on self-managed infrastructure (open-source)

### Key Concepts

- **BaaS**: Backend-as-a-Service (industry standard for managed backend)
- **Multi-tenant data access**: Secure data isolation per tenant
- **Decorator-based configuration**: TypeScript decorators for entity/field mapping
- **x-schema metadata**: Custom schema extensions for database-specific features
- **Service container pattern**: Dependency injection for easy provider swapping

### Rayfin Decorators

- `@DabEntity`: Marks a class as a DAB entity
- `@DabField`: Configures field mapping and database types
- `@DabPermission`: Defines access control policies
- Located in `@microsoft/rayfin-core` package

## CLI UX Guidelines

For CLI UX changes, load `.github/skills/rayfin-cli-ux/SKILL.md` and follow its pre-flight checklist.
The skill applies to user-observable CLI changes (commands, flags, output, errors, exit codes) — not internal refactors or architecture migrations.

## Spec Task Requirements

The following sections (`## E2E Tests` and `## User-Facing Documentation`) are REQUIRED in `tasks.md` only for OpenSpec proposals that change user-observable behavior — for example: CLI commands, flags, output, error messages, or exit codes; SDK public APIs; host endpoints; sample workflows; or any Builder-visible configuration surface.

They are NOT required for proposals whose scope is entirely internal — for example: refactors that preserve observable behavior, build/tooling-only changes, internal type or naming cleanups, dependency bumps with no API delta, or test-only additions. Such proposals MUST still include a single explicit task that records the scope decision (see "Scoping the requirement" below).

### Scoping the requirement

Every `tasks.md` MUST begin its testing/docs coverage with one scope-classification task:

- [ ] **Classify change scope** — `user-observable` or `internal-only`, with a one-line justification (for example, `internal-only: rename private helper, no public API or CLI surface change`).

If `internal-only`, omit the `## E2E Tests` and `## User-Facing Documentation` sections entirely. Reviewers MUST challenge the classification if the change touches CLI handlers, exported SDK symbols, host route signatures, or any docs page.

If `user-observable`, the sections below are mandatory.

### E2E test tasks (required for user-observable changes)

For every change that adds or modifies user-observable behavior (CLI commands, SDK public APIs, host endpoints, sample workflows), `tasks.md` MUST include one or more E2E test tasks under a dedicated `## E2E Tests` section.

Each E2E task MUST specify:

1. **Test location** — the project that owns the test:
   - CLI changes → `packages/tools/cli-e2e/` (`rayfin-cli-e2e`).
   - Host endpoint changes → `packages/host/Microsoft.Rayfin.WebService.Tests/` integration suite.
   - SDK changes → sample-driven E2E in the relevant sample under `samples/` (e.g., `samples/todo-app/`).
2. **Scenario name and trigger** — the exact user action under test (for example, `rayfin up --workspace "My Workspace" --dry-run` or `POST /api/auth/refresh with expired token`).
3. **Preconditions** — required fixtures, environment, auth state, and any Docker/Fabric setup steps.
4. **Observable outcome** — the user-visible result that proves the behavior works (stdout/stderr content, exit code, HTTP status + body, file written, deployment record created).
5. **Output mode coverage (CLI only)** — for CLI features, list the test cases for `interactive`, `plain`, and `json` modes separately, plus at least one non-interactive (`--yes` / non-TTY) case and one `--dry-run` case where applicable.
6. **Failure paths** — at least one negative scenario per command/endpoint covering the worst-realistic failure (auth failure, missing config, conflicting flags, destructive op without `--force`), asserting both the error message and recovery hint.
7. **Cleanup** — explicit teardown steps (containers, deployments, temp files) so the test is repeatable.

Do NOT write "add E2E tests" as a single line. Each scenario above is its own checkbox.

### User-facing documentation tasks (required for user-observable changes)

Every proposal classified as `user-observable` MUST include a `## User-Facing Documentation` section in `tasks.md`. The first task in that section is always a documentation-impact assessment:

- [ ] **Assess documentation impact** — Decide whether this change is user-facing. A change is user-facing if a Rayfin Builder would discover, configure, or invoke it (CLI flags/commands, SDK APIs, sample patterns, hosting setup, auth setup). Internal refactors, build tooling, and Contributor-only workflows are NOT user-facing.

If the change IS user-facing, the section MUST also include tasks that:

1. **Identify the affected guide(s)** under `docs/site/docs/guide/` by exact relative path. Use the existing folder map:
   - `docs/site/docs/guide/cli/` — CLI commands, flags, output, environments.
   - `docs/site/docs/guide/getting-started/` — onboarding, first project.
   - `docs/site/docs/guide/data/` — DAB, entities, decorators.
   - `docs/site/docs/guide/auth/` — authentication setup.
   - `docs/site/docs/guide/app-backend/` — backend services and patterns.
   - `docs/site/docs/guide/hosting/` — deployment, Fabric, OSS host.
   - `docs/site/docs/guide/preview/` — preview/experimental features.
2. **Choose update vs create** — prefer updating an existing page. Only add a new page when no existing page is a reasonable owner; in that case the task MUST name the new file path and the parent category page that links to it.
3. **List the concrete edits** — each page edit is its own checkbox stating what content is added/changed (for example, "Add `--workspace-uri` flag row to the `rayfin up` flag table and add an example invocation").
4. **Update navigation/index** — if a new page is created, include a task to update `docs/site/docs/guide/index.md` and any category landing page or sidebar config so the new page is discoverable.
5. **Validate** — final task: `rush docs:lint` passes and the rendered Docusaurus build succeeds locally (`cd docs/site && rushx build`).

If the change is NOT user-facing, the section MUST contain exactly one task explicitly stating that, with a one-line justification (for example, "Not user-facing: internal refactor of `RayfinItemManager` — no public API or CLI surface change"). This makes the decision auditable rather than implicit.

### Tasks template

Every `tasks.md` MUST include the scope-classification task. For `user-observable` changes, also include the `## E2E Tests` and `## User-Facing Documentation` sections shown below. For `internal-only` changes, omit those two sections.

```markdown
## Implementation

- [ ] Classify change scope: <user-observable | internal-only — justification>
- [ ] ...feature tasks...

## E2E Tests  (omit if internal-only)

- [ ] Scenario: <name> — <command/endpoint> — covers <interactive|plain|json|non-interactive|dry-run|failure path>
  - Location: <project path>
  - Preconditions: ...
  - Observable outcome: ...
  - Cleanup: ...
- [ ] ...one task per scenario...

## User-Facing Documentation  (omit if internal-only)

- [ ] Assess documentation impact: <user-facing | not user-facing — justification>
- [ ] Update `docs/site/docs/guide/<path>` — <concrete edit>
- [ ] (If new page) Create `docs/site/docs/guide/<path>` and link from `<index/category page>`
- [ ] `rush docs:lint` passes and `cd docs/site && rushx build` succeeds
```

## Important Constraints

### TypeScript Decorator Constraint

**CRITICAL**: This project uses Modern TC39 Stage 3 decorators, NOT legacy experimental decorators.

- **Must set** `"importHelpers": false` in tsconfig files
- **Must include** `"ESNext.Decorators"` in the `lib` array
- **Must NOT use** `"experimentalDecorators": true`
- **Do NOT use** `tslib` - it will cause errors

### Node.js Version Requirements

- Supported: Node.js 20.x, 22.x, 24.x (LTS versions only)
- Pre-LTS versions not recommended for production

### .NET Version Requirements

- .NET 8.0 required
- Nullable reference types mandatory
- Implicit usings enabled

### Monorepo Constraints

- Projects must be 2-3 levels deep from repo root
- Category folders organize related projects
- Rush manages all TypeScript dependencies
- No nested node_modules (pnpm workspace)

### Build Requirements

- Both TypeScript (`rush build`) and .NET (`dotnet build`) must succeed
- Format checks enforced in CI
- Test coverage requirements enforced

### Microsoft Open Source Policies

- CLA (Contributor License Agreement) required
- Microsoft Code of Conduct applies
- Content policies enforced (no harmful/hateful content)
- Copyright compliance mandatory

## External Dependencies

### Microsoft Services

- **Data API Builder (DAB)**: Core REST/GraphQL API generation engine
- **Microsoft Fabric**: Cloud hosting platform for Rayfin workloads
- **Azure SQL/Fabric SQL**: Supported database backends
- **Azure Storage**: For storage service integration
- **GitHub Packages**: Package registry for npm and NuGet packages

### Build & Development Tools

- **Rush**: @microsoft/rush (5.158.1)
- **pnpm**: Package manager (10.17.1)
- **TypeDoc**: API documentation generation
- **Markdownlint**: Documentation linting

### Database Drivers

- Multi-dialect support via DAB
- MSSQL, PostgreSQL, MySQL, Cosmos DB drivers

### Testing & Quality

- **Vitest**: TypeScript test framework
- **xUnit**: .NET test framework
- **@vitest/coverage-v8**: Code coverage
- **ESLint/Prettier**: Code quality tools

### Authentication

- JWT (JSON Web Tokens) for stateless auth
- Integration with Azure AD/Entra ID (planned)
