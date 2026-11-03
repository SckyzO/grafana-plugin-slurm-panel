import { defineConfig } from 'eslint/config';
import baseConfig from './.config/eslint.config.mjs';

export default defineConfig([
  {
    ignores: [
      '**/logs',
      '**/*.log',
      '**/npm-debug.log*',
      '**/yarn-debug.log*',
      '**/yarn-error.log*',
      '**/.pnpm-debug.log*',
      '**/node_modules/',
      '.yarn/cache',
      '.yarn/unplugged',
      '.yarn/build-state.yml',
      '.yarn/install-state.gz',
      '**/.pnp.*',
      '**/pids',
      '**/*.pid',
      '**/*.seed',
      '**/*.pid.lock',
      '**/lib-cov',
      '**/coverage',
      '**/dist/',
      '**/artifacts/',
      '**/work/',
      '**/ci/',
      'test-results/',
      'playwright-report/',
      'blob-report/',
      'playwright/.cache/',
      'playwright/.auth/',
      '**/.idea',
      '**/.eslintcache',
    ],
  },
  ...baseConfig,
  {
    // This repository keeps value and type imports from one module on two
    // lines, `import { a } from 'm'` and `import type { B } from 'm'`, and the
    // rule as configured upstream treats that pair as a duplicate. Two value
    // imports, or two type imports, from one module are still an error.
    rules: {
      'no-duplicate-imports': ['error', { allowSeparateTypeImports: true }],
    },
  },
  {
    // The engine under src/core imports nothing from Grafana. It is tested
    // under plain Node with no DOM (the `core` project in jest.config.js), and
    // @grafana/data throws "window is not defined" the moment it is imported
    // outside a browser. Keeping that boundary is what keeps the engine
    // testable without a browser, and it is enforced here rather than left to
    // review.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@grafana/*', '@grafana'],
              message:
                'src/core must not import @grafana/*: it is the engine, tested under plain Node with no DOM, and @grafana/data throws "window is not defined" on import outside a browser.',
            },
          ],
        },
      ],
    },
  },
]);
