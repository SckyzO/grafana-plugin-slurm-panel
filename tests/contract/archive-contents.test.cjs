const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIST = path.resolve(__dirname, '..', '..', 'plugins', 'nodegrid-panel', 'dist');

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [path.relative(DIST, full)];
  });

// The scaffold's webpack config copies every JSON file under src/ into the
// build, for the plugin.json files a multi-plugin app nests there. This
// plugin has one, so any other JSON in the build is something that was never
// meant to ship: the engine's test fixtures did, the first time they sat
// under src/.
test('the only JSON file the build ships is plugin.json', () => {
  const json = walk(DIST).filter((file) => file.endsWith('.json'));
  assert.deepEqual(json, ['plugin.json']);
});
