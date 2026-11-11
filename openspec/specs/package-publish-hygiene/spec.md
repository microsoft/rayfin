# Package hygeine

## ADDED Requirements

### Requirement: Every publishable package SHALL have an explicit files field

Every `package.json` under `packages/` that is not marked `"private": true` SHALL include an explicit `files` array.

#### Scenario: SDK package with no files field

- **WHEN** a publishable SDK package (e.g., `@microsoft/rayfin-auth`) has no `files` field in its `package.json`
- **THEN** a `files` field SHALL be added containing `["dist/**/*.js", "dist/**/*.d.ts", "!dist/**/__tests__/**"]`

#### Scenario: Private package is skipped

- **WHEN** a package has `"private": true` (e.g., `@rayfin/docgen`)
- **THEN** its `package.json` SHALL NOT be modified by this change

### Requirement: Published packages SHALL NOT contain source map files

No publishable package SHALL include `.js.map` or `.d.ts.map` files in its `files` field.
These files leak internal source paths and TypeScript source code.

#### Scenario: Package with existing files field including dist directory

- **WHEN** a package has `"files": ["dist"]` (which includes all files in `dist/`, including `.js.map` and `.d.ts.map`)
- **THEN** the `files` field SHALL be changed to `["dist/**/*.js", "dist/**/*.d.ts", "!dist/**/__tests__/**"]` to exclude map files and test files

#### Scenario: Verifying published tarball contents

- **WHEN** `npm pack --dry-run` is run in a publishable package directory
- **THEN** the output SHALL NOT list any `.js.map` or `.d.ts.map` files

### Requirement: Published packages SHALL NOT contain compiled test files

No publishable package SHALL include compiled test files (`__tests__/` directories) in its published tarball.
These files are development artifacts that inflate package size.

#### Scenario: Package with `__tests__` directory in dist

- **WHEN** a package's `dist/` directory contains a `__tests__/` subdirectory with compiled test files
- **THEN** the `files` field SHALL include `"!dist/**/__tests__/**"` to exclude them

#### Scenario: Verifying no test files in tarball

- **WHEN** `npm pack --dry-run` is run in a publishable package directory
- **THEN** the output SHALL NOT list any files matching `__tests__`

### Requirement: Packages with runtime assets SHALL include them in the files field

Packages that require non-JS resources at runtime (assets, templates, scripts) SHALL include those directories in their `files` field alongside the dist globs.

#### Scenario: CLI package with assets and scripts

- **WHEN** the package is `@microsoft/rayfin-cli`
- **THEN** the `files` field SHALL be `["dist/**/*.js", "dist/**/*.d.ts", "dist/**/*.json", "!dist/**/__tests__/**", "assets", "scripts"]`

#### Scenario: MCP package with assets and scripts

- **WHEN** the package is `@microsoft/rayfin-mcp`
- **THEN** the `files` field SHALL be `["dist/**/*.js", "dist/**/*.d.ts", "dist/**/*.json", "!dist/**/__tests__/**", "assets", "scripts"]`

#### Scenario: Create-rayfin package with templates

- **WHEN** the package is `@microsoft/create-rayfin`
- **THEN** the `files` field SHALL be `["dist/**/*.js", "dist/**/*.d.ts", "!dist/**/__tests__/**", "templates", "README.md"]`

### Requirement: Every package.json SHALL declare MIT license

Every `package.json` under `packages/` (excluding files inside `templates/` directories) SHALL have `"license": "MIT"`.

#### Scenario: Package with ISC license

- **WHEN** a package has `"license": "ISC"` in its `package.json`
- **THEN** the `license` field SHALL be changed to `"MIT"`

#### Scenario: Package with no license field

- **WHEN** a package has no `license` field in its `package.json`
- **THEN** a `"license": "MIT"` field SHALL be added

#### Scenario: Package already using MIT

- **WHEN** a package already has `"license": "MIT"` in its `package.json`
- **THEN** the field SHALL remain unchanged

#### Scenario: Template package.json is excluded

- **WHEN** a `package.json` is inside a `templates/` directory (e.g., `packages/tools/create-rayfin/templates/*/package.json`)
- **THEN** it SHALL NOT be modified by this change

### Requirement: Every package directory SHALL contain the root LICENSE file

Every package directory under `packages/` (excluding `templates/` subdirectories) SHALL contain a `LICENSE` file that is an exact copy of the repository root `LICENSE` file.

#### Scenario: Package missing LICENSE file

- **WHEN** a package directory does not contain a `LICENSE` file
- **THEN** the root `LICENSE` file SHALL be copied into that directory

#### Scenario: Package with existing LICENSE file

- **WHEN** a package directory already contains a `LICENSE` file
- **THEN** it SHALL be overwritten with the root `LICENSE` file to ensure consistency

#### Scenario: Template directory is excluded

- **WHEN** a directory is inside a `templates/` subdirectory
- **THEN** no `LICENSE` file SHALL be copied there

### Requirement: Published packages SHALL include LICENSE in the files field

Every publishable package that uses an explicit `files` array SHALL include `"LICENSE"` in that array to ensure the license file is distributed in the npm tarball.

#### Scenario: Publishable package with files array missing LICENSE

- **WHEN** a publishable package has a `files` array that does not include `"LICENSE"`
- **THEN** `"LICENSE"` SHALL be appended to the `files` array

#### Scenario: Package with no files array

- **WHEN** a package has no `files` array (e.g., a private package)
- **THEN** no `files` array SHALL be added solely for LICENSE inclusion

#### Scenario: Verifying LICENSE in published tarball

- **WHEN** `npm pack --dry-run` is run in a publishable package directory
- **THEN** the output SHALL list the `LICENSE` file

### Requirement: Published packages SHALL include only allowed file types

The `files` field for each publishable package SHALL use explicit positive glob patterns (allowlist).
The allowed patterns are:

- `dist/**/*.js` — compiled JavaScript
- `dist/**/*.d.ts` — TypeScript type declarations
- `dist/**/*.json` — build metadata (only for packages that produce JSON output)
- `assets` — runtime asset directories (only for packages that need them)
- `scripts` — executable entry-point scripts (only for CLI packages)
- `templates` — project templates (only for `create-rayfin`)
- `README.md` — package documentation (only when explicitly needed beyond npm auto-include)
- `LICENSE` — license file (all publishable packages)

#### Scenario: New file type added to build output

- **WHEN** a future build change introduces a new file type in `dist/` (e.g., `.wasm`)
- **THEN** the file SHALL NOT be published until the `files` field is explicitly updated to include it
