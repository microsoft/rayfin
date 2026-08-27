import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonicalManifestPath = 'plugin.json';

const pluginManifestPaths = [
  canonicalManifestPath,
  '.claude-plugin/plugin.json',
  '.codex-plugin/plugin.json',
  '.cursor-plugin/plugin.json',
  '.grok-plugin/plugin.json',
  '.kimi-plugin/plugin.json',
  'gemini-extension.json',
];

const shadowManifestPaths = [
  '.github/plugin/plugin.json',
  '.plugin/plugin.json',
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

test('canonical manifest cannot be shadowed by a legacy manifest', async () => {
  for (const manifestPath of shadowManifestPaths) {
    await assert.rejects(
      access(path.join(root, manifestPath)),
      { code: 'ENOENT' },
      `${manifestPath} shadows ${canonicalManifestPath} during plugin intake`,
    );
  }
});

test('canonical manifest meets Awesome Copilot submission policy', async () => {
  const canonical = await readJson(canonicalManifestPath);

  assert.equal(typeof canonical.license, 'string');
  assert.ok(canonical.license.length > 0, 'license must not be empty');
  assert.ok(Array.isArray(canonical.keywords), 'keywords must be an array');
  assert.ok(canonical.keywords.length <= 10, 'keywords must contain at most 10 entries');

  for (const keyword of canonical.keywords) {
    assert.match(keyword, /^[a-z0-9-]+$/, `invalid keyword: ${keyword}`);
    assert.ok(keyword.length < 30, `keyword must be under 30 characters: ${keyword}`);
  }
});

test('skill metadata version matches the canonical manifest', async () => {
  const [canonical, skill] = await Promise.all([
    readJson(canonicalManifestPath),
    readFile(
      path.join(root, 'skills/rayfin-getting-started/SKILL.md'),
      'utf8',
    ),
  ]);
  const version = skill.match(
    /^metadata:\r?\n(?:^[ \t]+.*\r?\n)*?^[ \t]+version:[ \t]+["']?([^"'\r\n]+)["']?[ \t]*$/m,
  )?.[1];

  assert.ok(version, 'SKILL.md metadata.version is required');
  assert.equal(version, canonical.version);
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
