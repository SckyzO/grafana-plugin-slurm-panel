const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const PANEL = path.join(ROOT, 'plugins', 'nodegrid-panel');
const { version } = JSON.parse(fs.readFileSync(path.join(PANEL, 'package.json'), 'utf8'));

// The catalogue shows, for each version, the README and links inside that
// version's archive. Pointed at `main`, they change under a published
// release every time main moves: a screenshot regenerated for 0.2.0 turns up
// in the page for 0.1.0. Pinned at build to the version's tag, they show
// what shipped. The CI badge is left on main on purpose: it is a live
// status, not a record.
for (const file of ['README.md', 'plugin.json']) {
  test(`${file} in the build points at v${version}, not at main`, () => {
    const text = fs.readFileSync(path.join(PANEL, 'dist', file), 'utf8');
    assert.doesNotMatch(text, /grafana-plugin-slurm-panel\/(blob\/)?main\//);
    assert.match(text, new RegExp(`grafana-plugin-slurm-panel/(blob/)?v${version.replace(/\./g, '\\.')}/`));
  });
}
