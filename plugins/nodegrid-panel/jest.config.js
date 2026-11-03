// force timezone to UTC to allow tests to work regardless of local timezone
// generally used by snapshots, but can affect specific tests
process.env.TZ = 'UTC';

const base = require('./.config/jest.config');

module.exports = {
  projects: [
    {
      // Jest configuration provided by Grafana scaffolding, for the panel:
      // React components under jsdom.
      ...base,
      displayName: 'panel',
      rootDir: __dirname,
      testPathIgnorePatterns: ['/node_modules/', '<rootDir>/src/core/'],
    },
    {
      // The engine under src/core is tested under plain Node: no DOM, no
      // jsdom and none of the scaffold's browser setup. A test there that
      // reaches for `window` or `document` fails instead of passing on a
      // browser stand-in, which is how the engine stays free of the browser
      // as well as of Grafana.
      displayName: 'core',
      rootDir: __dirname,
      testEnvironment: 'node',
      testMatch: ['<rootDir>/src/core/**/*.test.ts'],
      transform: base.transform,
    },
  ],
};
