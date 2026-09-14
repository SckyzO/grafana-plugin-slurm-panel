'use strict';

const { defineConfig, globalIgnores } = require('eslint/config');
const tseslint = require('typescript-eslint');

module.exports = defineConfig(
  globalIgnores(['**/dist/**', '**/node_modules/**', '**/coverage/**', '.superpowers/**']),
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [tseslint.configs.recommended],
  },
  {
    // packages/core must stay verifiable under plain Node with no DOM (see its
    // jest.config.js, which pins testEnvironment: 'node'). @grafana/data throws
    // "window is not defined" the moment it is imported outside a browser or
    // jsdom context, and every other @grafana/* package assumes a running
    // Grafana host. This turns that boundary into a lint failure instead of
    // relying on review discipline to catch a stray import.
    files: ['packages/core/**/*.ts', 'packages/core/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@grafana/*', '@grafana'],
              message:
                'packages/core must not import @grafana/*: it is verified under plain Node with no DOM, and @grafana/data throws "window is not defined" on import outside a browser context.',
            },
          ],
        },
      ],
    },
  },
);
