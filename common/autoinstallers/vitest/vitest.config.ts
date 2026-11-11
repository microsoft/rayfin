import { defineConfig } from 'vitest/config';

const IS_VSCODE = !!process.env.VITEST_VSCODE;

let resolve: object | undefined = {
  alias: {
    '@vitest/coverage-v8':
      'common/autoinstallers/vitest/node_modules/@vitest/coverage-v8',
  },
};

if (IS_VSCODE) {
  // When running in VSCode, change the working directory to the monorepo root
  // When rush runs it, it does this automatically
  console.log('Running VS Code, changing working directory to monorepo root');
  process.chdir('../../..');
  const currentDir = process.cwd();
  console.log('Current working directory:', currentDir);

  resolve = undefined;
}

export default defineConfig({
  resolve,
  test: {
    projects: [
      'packages/typescript-sdk/**/vitest.config.ts',
      'packages/tools/**/vitest.config.ts',
      'packages/tools/**/vitest.config.mts',
      '!packages/tools/cli-e2e/vitest.config.ts',
      // Match sample root configs but exclude subdirectories
      // nested tests are included via each sample's own config using `extends`
      'samples/*/vitest.config.ts',
      '!samples/**/e2e/**/vitest.config.ts',
      '!packages/tools/cli/templates/**/vitest.config.ts',
      '!packages/tools/create-rayfin/templates/**/vitest.config.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'cobertura'],
      reportsDirectory: './coverage',
      exclude: [
        'node_modules/',
        'common/temp/',
        'dist/',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/__tests__/**',
        'src/__tests__/setup.ts',
      ],
    },
    reporters: process.env.CI ? ['verbose', 'junit'] : ['verbose'],
    outputFile: {
      junit: './test-results/typescript-results.xml',
    },
  },
});
