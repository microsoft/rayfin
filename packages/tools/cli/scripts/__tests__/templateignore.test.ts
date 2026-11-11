import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  createTemplateIgnoreMatcher,
  readTemplateIgnoreFile,
  type TemplateIgnoreSource,
} from '../templateignore';

function makeMatcher(root: string, patterns: string[]) {
  const sources: TemplateIgnoreSource[] = [{ source: 'test', patterns }];
  return createTemplateIgnoreMatcher(root, sources);
}

describe('createTemplateIgnoreMatcher — adversarial patterns', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'tplign-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('matches simple file pattern', () => {
    const matcher = makeMatcher(root, ['*.log']);
    expect(matcher.shouldExclude(join(root, 'foo.log'), false)).toBe(true);
    expect(matcher.shouldExclude(join(root, 'foo.txt'), false)).toBe(false);
    expect(matcher.warnings).toHaveLength(0);
  });

  it('matches directory by name', () => {
    const matcher = makeMatcher(root, ['node_modules']);
    expect(matcher.shouldExclude(join(root, 'node_modules'), true)).toBe(true);
  });

  it('matches directory with trailing slash pattern', () => {
    const matcher = makeMatcher(root, ['node_modules/']);
    expect(matcher.shouldExclude(join(root, 'node_modules'), true)).toBe(true);
  });

  it('matches dotfiles by default (dot: true option)', () => {
    const matcher = makeMatcher(root, ['*']);
    expect(matcher.shouldExclude(join(root, '.env'), false)).toBe(true);
    expect(matcher.shouldExclude(join(root, '.gitignore'), false)).toBe(true);
  });

  it('matches nested paths with **', () => {
    const matcher = makeMatcher(root, ['**/*.log']);
    expect(matcher.shouldExclude(join(root, 'a', 'b', 'c.log'), false)).toBe(
      true
    );
  });

  it('does not exclude paths outside root', () => {
    const matcher = makeMatcher(root, ['*']);
    const outside = join(root, '..', 'sibling', 'file.txt');
    expect(matcher.shouldExclude(outside, false)).toBe(false);
  });

  it('does not exclude root itself (empty rel path)', () => {
    const matcher = makeMatcher(root, ['*']);
    expect(matcher.shouldExclude(root, true)).toBe(false);
  });

  it('warns on unbalanced [ ] in pattern and skips it', () => {
    const matcher = makeMatcher(root, ['[unbalanced', '*.txt']);
    expect(matcher.warnings).toHaveLength(1);
    expect(matcher.warnings[0]).toContain('unbalanced glob tokens');
    expect(matcher.shouldExclude(join(root, 'a.txt'), false)).toBe(true);
  });

  it('warns on unbalanced { } in pattern', () => {
    const matcher = makeMatcher(root, ['{a,b']);
    expect(matcher.warnings).toHaveLength(1);
    expect(matcher.warnings[0]).toContain('unbalanced glob tokens');
  });

  it('warns on unbalanced ( ) in pattern', () => {
    const matcher = makeMatcher(root, ['@(a|b']);
    expect(matcher.warnings).toHaveLength(1);
    expect(matcher.warnings[0]).toContain('unbalanced glob tokens');
  });

  it('accepts balanced [ ] character class', () => {
    const matcher = makeMatcher(root, ['*.[jt]s']);
    expect(matcher.shouldExclude(join(root, 'a.js'), false)).toBe(true);
    expect(matcher.shouldExclude(join(root, 'a.ts'), false)).toBe(true);
    expect(matcher.shouldExclude(join(root, 'a.cs'), false)).toBe(false);
    expect(matcher.warnings).toHaveLength(0);
  });

  it('accepts balanced { } alternation', () => {
    const matcher = makeMatcher(root, ['*.{md,txt}']);
    expect(matcher.shouldExclude(join(root, 'a.md'), false)).toBe(true);
    expect(matcher.shouldExclude(join(root, 'a.txt'), false)).toBe(true);
    expect(matcher.shouldExclude(join(root, 'a.js'), false)).toBe(false);
  });

  it('handles empty patterns list (no exclusions)', () => {
    const matcher = makeMatcher(root, []);
    expect(matcher.shouldExclude(join(root, 'anything'), false)).toBe(false);
    expect(matcher.warnings).toHaveLength(0);
  });

  it('skips empty/whitespace-only patterns silently', () => {
    const matcher = makeMatcher(root, ['', '   ', '\t']);
    expect(matcher.warnings).toHaveLength(0);
    expect(matcher.shouldExclude(join(root, 'foo'), false)).toBe(false);
  });

  it('matches across multiple sources (union semantics)', () => {
    const sources: TemplateIgnoreSource[] = [
      { source: 'global', patterns: ['*.log'] },
      { source: 'template', patterns: ['secret.txt'] },
    ];
    const matcher = createTemplateIgnoreMatcher(root, sources);
    expect(matcher.shouldExclude(join(root, 'a.log'), false)).toBe(true);
    expect(matcher.shouldExclude(join(root, 'secret.txt'), false)).toBe(true);
    expect(matcher.shouldExclude(join(root, 'keep.txt'), false)).toBe(false);
  });

  it('normalizes Windows-style separators in candidate paths', () => {
    const matcher = makeMatcher(root, ['a/b/*.log']);
    const winPath = join(root, 'a', 'b', 'c.log');
    expect(matcher.shouldExclude(winPath, false)).toBe(true);
  });

  it('does not partial-match basenames (anchored matching)', () => {
    const matcher = makeMatcher(root, ['env']);
    expect(matcher.shouldExclude(join(root, '.env'), false)).toBe(false);
    expect(matcher.shouldExclude(join(root, 'environment'), false)).toBe(false);
    expect(matcher.shouldExclude(join(root, 'env'), false)).toBe(true);
  });

  it('handles patterns with leading ** correctly', () => {
    const matcher = makeMatcher(root, ['**/dist']);
    expect(matcher.shouldExclude(join(root, 'pkg', 'dist'), true)).toBe(true);
    expect(matcher.shouldExclude(join(root, 'dist'), true)).toBe(true);
  });
});

describe('readTemplateIgnoreFile', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'tplign-read-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns empty result when file does not exist', () => {
    const result = readTemplateIgnoreFile(join(root, 'missing'));
    expect(result.exists).toBe(false);
    expect(result.patterns).toEqual([]);
  });

  it('strips comments and blank lines', () => {
    const file = join(root, '.templateignore');
    writeFileSync(
      file,
      [
        '# leading comment',
        '',
        '*.log',
        '   ',
        'node_modules/ # trailing comment',
        '\t# tabbed comment',
      ].join('\n')
    );
    const result = readTemplateIgnoreFile(file);
    expect(result.exists).toBe(true);
    expect(result.patterns).toEqual(['*.log', 'node_modules/']);
  });

  it('handles CRLF line endings', () => {
    const file = join(root, '.templateignore');
    writeFileSync(file, '*.log\r\nnode_modules/\r\n');
    const result = readTemplateIgnoreFile(file);
    expect(result.patterns).toEqual(['*.log', 'node_modules/']);
  });

  it('treats # at any position as start of comment', () => {
    const file = join(root, '.templateignore');
    writeFileSync(file, 'foo#bar\n');
    const result = readTemplateIgnoreFile(file);
    expect(result.patterns).toEqual(['foo']);
  });
});

describe('global template ignore policy', () => {
  const templateRoot = join(tmpdir(), 'rayfin-template-root');

  function globalMatcher() {
    const globalIgnore = readTemplateIgnoreFile(
      join(import.meta.dirname, '..', '.templateignore')
    );
    return createTemplateIgnoreMatcher(templateRoot, [
      {
        source: globalIgnore.source,
        patterns: globalIgnore.patterns,
      },
    ]);
  }

  it('excludes the Rayfin deployment registry', () => {
    expect(
      globalMatcher().shouldExclude(
        join(templateRoot, 'rayfin', '.deployments.json'),
        false
      )
    ).toBe(true);
  });

  it('excludes the functions state a developer leaves behind', () => {
    const matcher = globalMatcher();

    for (const directory of [
      ['rayfin', 'functions'],
      ['packages', 'functions'],
    ]) {
      for (const name of ['local.settings.json', 'deploymentdata.json']) {
        expect(
          matcher.shouldExclude(join(templateRoot, ...directory, name), false),
          [...directory, name].join('/')
        ).toBe(true);
      }
    }
  });

  it('keeps the functions capability kit seed of the same name', () => {
    // The exclusion above has to stay a path rather than a name. This file is
    // source: it is what the capability copies in when someone turns functions
    // on, and dropping it leaves the scaffolded app unable to run them.
    expect(
      globalMatcher().shouldExclude(
        join(
          templateRoot,
          '.agents',
          'skills',
          'functions-capability',
          'kit',
          'functions',
          'local.settings.json'
        ),
        false
      )
    ).toBe(false);
  });

  it('excludes .npmrc at the root and at depth', () => {
    // Registry credentials can be present after authenticating to a private feed.
    const matcher = globalMatcher();

    for (const segments of [['.npmrc'], ['packages', 'api', '.npmrc']]) {
      expect(
        matcher.shouldExclude(join(templateRoot, ...segments), false),
        segments.join('/')
      ).toBe(true);
    }
  });

  it('excludes build-tool caches at the root and at depth', () => {
    // Trailing-slash patterns match directories, not files of the same name.
    const matcher = globalMatcher();

    for (const name of ['.vite', '.cache', '.tmp', '.temp']) {
      for (const segments of [[name], ['packages', 'api', name]]) {
        expect(
          matcher.shouldExclude(join(templateRoot, ...segments), true),
          segments.join('/')
        ).toBe(true);
      }
    }

    // `.temp` used to be listed as `rayfin/.temp/` alone, so it only held
    // under that one parent. Moving it to `**/.temp/` has to keep covering
    // the original path, not just trade one gap for another.
    expect(
      matcher.shouldExclude(join(templateRoot, 'rayfin', '.temp'), true),
      'rayfin/.temp'
    ).toBe(true);
  });
});
