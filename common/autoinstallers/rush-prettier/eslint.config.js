import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';
import tsdoc from 'eslint-plugin-tsdoc';
import js from '@eslint/js';

export default [
  // Base JavaScript config
  js.configs.recommended,

  // TypeScript files
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: false, // Disable project-wide type checking for better performance
      },
      globals: {
        // Node.js globals
        console: 'readonly',
        process: 'readonly',
        global: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        crypto: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',

        // Ambient TypeScript namespaces contributed by @types/node and the
        // React JSX runtime.  They only exist in type position, so ESLint's
        // scope analysis cannot see them without being told.
        NodeJS: 'readonly',
        JSX: 'readonly',

        // Browser globals
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        Headers: 'readonly',
        Response: 'readonly',
        Request: 'readonly',

        // Fetch API types
        HeadersInit: 'readonly',
        RequestInit: 'readonly',
        ResponseInit: 'readonly',
        BodyInit: 'readonly',

        // Web API globals (available in Node.js 18+)
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        Blob: 'readonly',
        ReadableStream: 'readonly',
        WritableStream: 'readonly',
        TransformStream: 'readonly',
        CompressionStream: 'readonly',
        DecompressionStream: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        FormData: 'readonly',
        File: 'readonly',
        FileReader: 'readonly',

        // DOM types
        HTMLElement: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLImageElement: 'readonly',
        HTMLInputElement: 'readonly',
        MouseEvent: 'readonly',
        MessageEvent: 'readonly',
        MediaQueryList: 'readonly',
        MediaQueryListEvent: 'readonly',
        MutationObserver: 'readonly',
        Event: 'readonly',
        EventListener: 'readonly',
        CustomEvent: 'readonly',
        Node: 'readonly',
        Window: 'readonly',
        BroadcastChannel: 'readonly',
        getComputedStyle: 'readonly',

        // React globals
        React: 'readonly',

        // Encoding/utility
        atob: 'readonly',
        btoa: 'readonly',
        structuredClone: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      import: importPlugin,
      tsdoc,
    },
    rules: {
      // TypeScript specific rules
      '@typescript-eslint/no-unused-vars': ['off', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off', // Disabled for now - too many explicit any types in codebase
      '@typescript-eslint/no-inferrable-types': 'error',

      // TSDoc syntax — validate that doc comments parse as TypeDoc-compatible
      // TSDoc.  This is the ESLint-side counterpart to TypeDoc's renderer: it
      // catches malformed `{@link}` tags, unknown block tags, etc., so that
      // generated reference docs render correctly.  See
      // https://typedoc.org/guides/doccomments/ and
      // https://github.com/microsoft/tsdoc.
      'tsdoc/syntax': 'error',

      // Import rules - relaxed for now
      'import/order': [
        'warn',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
          ],
          'newlines-between': 'always',
          alphabetize: { order: 'asc' },
        },
      ],
      'import/no-unresolved': 'off', // TypeScript handles this

      // General rules
      'no-console': 'off', // Disabled for now - too many console statements in codebase
      'prefer-const': 'error',
      'no-var': 'error',
      'no-undef': 'error',
      'no-unused-vars': ['off', { argsIgnorePattern: '^_' }], // Disabled for now - too many unused variables in codebase
    },
  },

  // JavaScript files
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        // Node.js globals
        console: 'readonly',
        process: 'readonly',
        global: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',

        // Browser globals
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        fetch: 'readonly',

        // Web API globals (available in Node.js 18+)
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        Blob: 'readonly',
        ReadableStream: 'readonly',
        WritableStream: 'readonly',
        TransformStream: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        FormData: 'readonly',
        File: 'readonly',
        FileReader: 'readonly',

        // DOM types (JS context)
        Event: 'readonly',
        EventListener: 'readonly',
        CustomEvent: 'readonly',
        HTMLImageElement: 'readonly',

        // Encoding/utility
        btoa: 'readonly',
        structuredClone: 'readonly',
      },
    },
    plugins: {
      import: importPlugin,
    },
    rules: {
      'no-unused-vars': ['off', { argsIgnorePattern: '^_' }], // Disabled for now - too many unused variables in codebase
      'no-console': 'off', // Disabled for now - too many console statements in codebase
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  // Test files - more relaxed rules
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off',
    },
  },

  // Interface files - allow unused parameters (they're just type definitions)
  {
    files: ['**/interfaces/**/*.ts', '**/types/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off',
    },
  },

  // Configuration files - more relaxed rules
  {
    files: [
      '**/vite.config.*',
      '**/vitest.config.*',
      '**/eslint.config.*',
      '**/tailwind.config.*',
      '**/postcss.config.*',
    ],
    rules: {
      'no-console': 'off',
      'import/order': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off',
    },
  },

  // Ignore patterns
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/*.d.ts',
      '**/bin/**',
      '**/obj/**',
      '**/assets/templates/**', // Ignore template files in create-rayfin
      'packages/tools/cli/templates/**', // Build output: bundled from samples/ by scripts/bundle-templates.ts
      '**/.vscode/**',
      '**/.git/**',
      // Skill material, not app code.  `.agents` carries documentation and kit
      // files that a skill copies into an app's src/ on demand; they are never
      // compiled from where they live, so linting them reports errors against
      // a toolchain that does not apply.
      '**/.agents/**',
      '**/*.gen.ts',
      '**/.venv/**',
      'common',
      '**/scripts/install-*.js',
      '**/.temp/**', // Ignore all files in .temp directories (including compiled JS)
    ],
  },
];
