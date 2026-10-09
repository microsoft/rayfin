import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { test } from 'vitest';

import { getSdkEditUrl, getSiteSettings } from './site-settings';

const cases = [
  { name: 'local defaults', env: {}, publicSite: false },
  {
    name: 'local checkout of public repo',
    env: { GITHUB_REPOSITORY: 'microsoft/rayfin' },
    publicSite: false,
  },
  {
    name: 'private CI',
    env: {
      GITHUB_ACTIONS: 'true',
      GITHUB_REPOSITORY: 'microsoft/project-rayfin',
    },
    publicSite: false,
  },
  {
    name: 'exact public CI',
    env: { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'microsoft/rayfin' },
    publicSite: true,
  },
  {
    name: 'fork CI',
    env: { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'someone/rayfin' },
    publicSite: false,
  },
  {
    name: 'nonexact Actions value',
    env: { GITHUB_ACTIONS: '1', GITHUB_REPOSITORY: 'microsoft/rayfin' },
    publicSite: false,
  },
  {
    name: 'nonexact repository case',
    env: { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'Microsoft/rayfin' },
    publicSite: false,
  },
  {
    name: 'explicit local opt-in',
    env: { DOCUSAURUS_PUBLIC_SITE: 'true' },
    publicSite: true,
  },
  {
    name: 'nonexact opt-in',
    env: { DOCUSAURUS_PUBLIC_SITE: '1' },
    publicSite: false,
  },
  {
    name: 'false opt-in does not override public CI',
    env: {
      GITHUB_ACTIONS: 'true',
      GITHUB_REPOSITORY: 'microsoft/rayfin',
      DOCUSAURUS_PUBLIC_SITE: 'false',
    },
    publicSite: true,
  },
];

for (const { name, env, publicSite } of cases) {
  test(name, () => {
    const settings = getSiteSettings(env);
    const repository = publicSite ? 'rayfin' : 'project-rayfin';
    const baseUrl = publicSite ? '/rayfin/' : '/';
    const githubUrl = `https://github.com/microsoft/${repository}`;
    assert.equal(
      settings.url,
      publicSite
        ? 'https://microsoft.github.io'
        : 'https://cautious-chainsaw-l1y4rgq.pages.github.io/'
    );
    assert.equal(settings.baseUrl, baseUrl);
    assert.equal(settings.githubUrl, githubUrl);
    assert.equal(settings.organizationName, 'Microsoft');
    assert.equal(
      settings.projectName,
      publicSite ? 'rayfin' : 'Project Rayfin'
    );
    assert.equal(
      settings.editUrl('packages/guide/assets/docs', 'quickstart.md'),
      `${githubUrl}/tree/main/packages/guide/assets/docs/quickstart.md`
    );

    const paths = new Map([
      ['rayfin-core', 'packages/typescript-sdk/core/assets/docs'],
    ]);
    assert.equal(
      getSdkEditUrl(settings, 'rayfin-core/nested/page.md', paths, new Set()),
      `${githubUrl}/tree/main/packages/typescript-sdk/core/assets/docs/nested/page.md`
    );
    assert.equal(
      getSdkEditUrl(
        settings,
        'rayfin-core/index.md',
        paths,
        new Set(['rayfin-core'])
      ),
      undefined
    );
    assert.equal(
      getSdkEditUrl(settings, 'unknown/index.md', paths, new Set()),
      undefined
    );

    const active = new RegExp(settings.tsSdkActiveBaseRegex);
    assert.ok(active.test(`${baseUrl}docs/ts-sdk`));
    assert.ok(active.test(`${baseUrl}docs/ts-sdk/rayfin-core/classes/Entity`));
    assert.ok(!active.test(`${baseUrl}docs/guide`));
    assert.ok(!active.test(`${baseUrl}docs/ts-sdk-other`));
    assert.ok(
      !active.test(`${publicSite ? '/' : '/rayfin/'}docs/ts-sdk/rayfin-core`)
    );
  });
}

test('Rush build cache varies with every deployment-selection variable', () => {
  const config = JSON.parse(
    readFileSync(new URL('./config/rush-project.json', import.meta.url), 'utf8')
  );
  const build = config.operationSettings.find(
    (operation: { operationName: string }) =>
      operation.operationName === 'build'
  );
  assert.deepEqual(
    [...build.dependsOnEnvVars].sort(),
    ['GITHUB_ACTIONS', 'GITHUB_REPOSITORY', 'DOCUSAURUS_PUBLIC_SITE'].sort()
  );
});
