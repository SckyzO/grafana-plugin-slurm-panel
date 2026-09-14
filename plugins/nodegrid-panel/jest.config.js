// force timezone to UTC to allow tests to work regardless of local timezone
// generally used by snapshots, but can affect specific tests
process.env.TZ = 'UTC';

const base = require('./.config/jest.config');

module.exports = {
  // Jest configuration provided by Grafana scaffolding
  ...base,
  moduleNameMapper: {
    ...base.moduleNameMapper,
    // @slurm-views/core's "main" points straight at its TS source, which
    // uses ESM-style ".js" specifiers for sibling ".ts" files (the same
    // convention packages/core/jest.config.js already strips for its own
    // tests). Jest's default CJS resolver does not understand that
    // convention, so any test that pulls in @slurm-views/core needs it too.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
