import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonicalManifestPath = '.plugin/plugin.json';

const pluginManifestPaths = [
  '.claude-plugin/plugin.json',
  '.codex-plugin/plugin.json',
  '.cursor-plugin/plugin.json',
  '.github/plugin/plugin.json',
  '.grok-plugin/plugin.json',
  '.kimi-plugin/plugin.json',
  '.plugin/plugin.json',
  'gemini-extension.json',
];

const marketplaceManifestPaths = [
  '.agents/plugins/marketplace.json',
  '.claude-plugin/marketplace.json',
  '.github/plugin/marketplace.json',
  'kimi-marketplace.json',
];

const schemaCases = [
  {
    manifestPath: canonicalManifestPath,
    schemaUrl: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    draft: '2020-12',
  },
  {
    manifestPath: '.claude-plugin/plugin.json',
    schemaUrl:
      'https://raw.githubusercontent.com/SchemaStore/schemastore/d6c59e8a9b85aa0bd5f8cad136c68e81d267fd70/src/schemas/json/claude-code-plugin-manifest.json',
    draft: 'draft-07',
  },
  {
    manifestPath: '.claude-plugin/marketplace.json',
    schemaUrl:
      'https://raw.githubusercontent.com/SchemaStore/schemastore/d6c59e8a9b85aa0bd5f8cad136c68e81d267fd70/src/schemas/json/claude-code-marketplace.json',
    draft: 'draft-07',
  },
  {
    manifestPath: '.cursor-plugin/plugin.json',
    schemaUrl:
      'https://raw.githubusercontent.com/cursor/plugins/070189284e702e8a4d2e3cc8913994b204c5337a/schemas/plugin.schema.json',
    draft: 'draft-07',
  },
];

async function readJson(relativePath) {
  const contents = await readFile(path.join(root, relativePath), 'utf8');
  return JSON.parse(contents);
}

async function fetchSchema(url) {
  const response = await fetch(url);
  assert.equal(response.ok, true, `Failed to fetch schema ${url}`);
  return response.json();
}

function createValidator(draft) {
  const ajv =
    draft === '2020-12'
      ? new Ajv2020({ allErrors: true, strict: false })
      : new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

function formatErrors(errors) {
  return errors
    ?.map(
      ({ instancePath, message, params }) =>
        `${instancePath || '/'} ${message} ${JSON.stringify(params)}`,
    )
    .join('\n');
}

for (const { manifestPath, schemaUrl, draft } of schemaCases) {
  test(`${manifestPath} matches its published schema`, async () => {
    const [manifest, schema] = await Promise.all([
      readJson(manifestPath),
      fetchSchema(schemaUrl),
    ]);
    const validate = createValidator(draft).compile(schema);

    assert.equal(validate(manifest), true, formatErrors(validate.errors));
  });
}

test('all plugin manifests stay aligned', async () => {
  const canonical = await readJson(canonicalManifestPath);

  for (const manifestPath of pluginManifestPaths) {
    const manifest = await readJson(manifestPath);
    assert.equal(manifest.name, canonical.name, `${manifestPath} name`);
    assert.equal(manifest.version, canonical.version, `${manifestPath} version`);
    assert.equal(
      typeof manifest.description,
      'string',
      `${manifestPath} description`,
    );
    assert.ok(manifest.description.length > 0, `${manifestPath} description`);

    const skillPaths = Array.isArray(manifest.skills)
      ? manifest.skills
      : manifest.skills
        ? [manifest.skills]
        : [];

    for (const skillPath of skillPaths) {
      const resolvedPath = path.resolve(root, skillPath);
      assert.ok(
        resolvedPath.startsWith(`${root}${path.sep}`),
        `${manifestPath} skill path escapes the repository`,
      );
      await assert.doesNotReject(
        readFile(path.join(resolvedPath, 'rayfin-getting-started', 'SKILL.md')),
        `${manifestPath} references a missing skill directory`,
      );
    }
  }
});

test('all marketplace entries target the canonical plugin', async () => {
  const canonical = await readJson(canonicalManifestPath);

  for (const manifestPath of marketplaceManifestPaths) {
    const marketplace = await readJson(manifestPath);
    assert.ok(
      Array.isArray(marketplace.plugins) && marketplace.plugins.length > 0,
      `${manifestPath} must contain plugins`,
    );

    for (const plugin of marketplace.plugins) {
      assert.equal(
        plugin.name ?? plugin.id,
        canonical.name,
        `${manifestPath} name`,
      );
      if (plugin.version) {
        assert.equal(plugin.version, canonical.version, `${manifestPath} version`);
      }
    }
  }
});
