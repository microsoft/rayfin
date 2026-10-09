import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { test } from 'vitest';

import { getSiteSettings } from './site-settings';

const settings = getSiteSettings(process.env);
const outDir = join(import.meta.dirname, 'build');
const generatedDir = join(import.meta.dirname, '.docusaurus');
const read = (path: string) => readFileSync(path, 'utf8');
const home = read(join(outDir, 'index.html'));
const guide = read(join(outDir, 'docs/guide/index.html'));
const origin = settings.url.replace(/\/$/, '');

function attribute(tag: string, name: string): string | undefined {
  return tag
    .match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
    ?.slice(1)
    .find((value) => value !== undefined);
}

function assetTags(html: string): string[] {
  return [...html.matchAll(/<(?:script|link|img)\b[^>]*>/gi)].map(
    ([tag]) => tag
  );
}

function canonicalUrl(html: string): string | undefined {
  const tag = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map(([tag]) => tag)
    .find((tag) => attribute(tag, 'rel')?.toLowerCase() === 'canonical');
  return tag === undefined ? undefined : attribute(tag, 'href');
}

test('artifact matching recognizes uppercase tags and compares hostnames literally', () => {
  assert.deepEqual(
    assetTags(
      '<SCRIPT SRC="/main.js"></SCRIPT><LiNk HREF="/style.css"><IMG SRC="/logo.png">'
    ),
    [
      '<SCRIPT SRC="/main.js">',
      '<LiNk HREF="/style.css">',
      '<IMG SRC="/logo.png">',
    ]
  );
  assert.equal(attribute('<SCRIPT SRC="/main.js">', 'src'), '/main.js');
  const expected = `${origin}${settings.baseUrl}`;
  assert.equal(
    canonicalUrl(`<LINK REL="CANONICAL" HREF="${expected}">`),
    expected
  );
  const wrongHost = expected.replace('github.io', 'githubXio');
  assert.notEqual(
    canonicalUrl(`<link rel=canonical href="${wrongHost}">`),
    expected
  );
});

function filesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesIn(path) : [path];
  });
}

function assertAssetExists(url: string) {
  assert.ok(url.startsWith(settings.baseUrl), `Asset outside baseUrl: ${url}`);
  assert.ok(
    existsSync(join(outDir, url.slice(settings.baseUrl.length))),
    `Missing generated asset: ${url}`
  );
}

test('generated HTML uses the selected canonical origin and base path', () => {
  const htmlFiles = filesIn(outDir).filter((path) => path.endsWith('.html'));
  assert.ok(htmlFiles.length > 10, 'Expected a complete docs build');
  for (const path of htmlFiles) {
    const html = read(path);
    const canonical = canonicalUrl(html);
    assert.ok(canonical, `Missing canonical URL in ${path}`);
    assert.ok(
      canonical.startsWith(`${origin}${settings.baseUrl}`),
      `Wrong canonical URL in ${path}`
    );
    for (const tag of assetTags(html)) {
      const url = attribute(tag, 'src') ?? attribute(tag, 'href');
      if (url?.startsWith('/') && !url.startsWith('//')) {
        assertAssetExists(url);
      }
    }
  }
  assert.equal(canonicalUrl(home), `${origin}${settings.baseUrl}`);
});

test('navbar, homepage CTAs, logo and guide edit links share the target', () => {
  const links = [...home.matchAll(/<a\b[^>]*>/gi)].map(([tag]) =>
    attribute(tag, 'href')
  );
  assert.equal(links.filter((href) => href === settings.githubUrl).length, 2);
  assert.ok(links.includes(`${settings.baseUrl}docs/guide`));
  assert.ok(links.includes(`${settings.baseUrl}docs/ts-sdk/rayfin-core`));
  assert.ok(
    [...home.matchAll(/<img\b[^>]*>/gi)].every(
      ([tag]) => attribute(tag, 'src') === `${settings.baseUrl}img/rayfin.png`
    )
  );
  assert.ok(
    guide.includes(settings.editUrl('packages/guide/assets/docs', 'index.md'))
  );
  const sdk = read(join(outDir, 'docs/ts-sdk/rayfin-core/index.html'));
  assert.ok(
    !sdk.includes('/tree/main/'),
    'Generated SDK pages must not have edit links'
  );
  const handwrittenSdk = read(
    join(outDir, 'docs/ts-sdk/rayfin-local-dev/index.html')
  );
  assert.ok(
    handwrittenSdk.includes(
      settings.editUrl('packages/tools/local-dev/assets/docs', 'index.md')
    )
  );
  const sdkLink = [...sdk.matchAll(/<a\b[^>]*>/gi)].find(
    ([tag]) =>
      attribute(tag, 'href') === `${settings.baseUrl}docs/ts-sdk/rayfin-core`
  );
  assert.ok(
    sdkLink && attribute(sdkLink[0], 'class')?.includes('navbar__link--active')
  );
});

test('bundled CSS inlines GitHub icons and uses base-prefixed asset URLs', () => {
  const cssFiles = filesIn(join(outDir, 'assets/css')).filter((path) =>
    path.endsWith('.css')
  );
  assert.ok(cssFiles.length > 0);
  const css = cssFiles.map(read).join('\n');
  for (const name of ['gh-mark-black.svg', 'gh-mark-white.svg']) {
    const icon = readFileSync(join(import.meta.dirname, 'static/img', name));
    assert.ok(
      css.includes(`data:image/svg+xml;base64,${icon.toString('base64')}`)
    );
  }
  const localUrls = cssFiles.flatMap((path) =>
    [...read(path).matchAll(/url\(["']?(\/[^"')]+)["']?\)/g)].map(
      (match) => match[1]
    )
  );
  for (const url of localUrls) {
    assertAssetExists(url);
  }
});

test('search indexes and client configuration use the selected base path', async () => {
  // Read the serialized build config, not the source config that stages docs.
  const configPath = join(generatedDir, 'docusaurus.config.mjs');
  const { default: config } = await import(configPath);
  assert.equal(config.url, origin);
  assert.equal(config.baseUrl, settings.baseUrl);
  assert.equal(config.customFields.githubUrl, settings.githubUrl);
  assert.equal(
    config.themeConfig.navbar.items.find(
      (item: { label?: string }) => item.label === 'SDK Reference'
    ).activeBaseRegex,
    settings.tsSdkActiveBaseRegex
  );
  assert.ok(
    config.plugins.some(
      (plugin: unknown) =>
        Array.isArray(plugin) &&
        String(plugin[0]).includes('docusaurus-lunr-search') &&
        plugin[1].assetUrl === undefined
    ),
    'Search should inherit site baseUrl rather than overriding it'
  );

  const globalData = JSON.parse(read(join(generatedDir, 'globalData.json')));
  const { fileNames } = globalData['docusaurus-lunr-search'].default;
  for (const name of [fileNames.searchDoc, fileNames.lunrIndex]) {
    assertAssetExists(`${settings.baseUrl}${name}`);
  }
  const { searchDocs } = JSON.parse(read(join(outDir, fileNames.searchDoc)));
  assert.ok(searchDocs.length > 100, 'Expected populated search results');
  assert.ok(
    searchDocs.every((doc: { url: string }) =>
      doc.url.startsWith(`${settings.baseUrl}docs/`)
    )
  );
  assert.ok(
    searchDocs.some((doc: { url: string }) =>
      doc.url.startsWith(`${settings.baseUrl}docs/guide/`)
    )
  );
  assert.ok(
    searchDocs.some((doc: { url: string }) =>
      doc.url.startsWith(`${settings.baseUrl}docs/ts-sdk/rayfin-core/`)
    )
  );
});
