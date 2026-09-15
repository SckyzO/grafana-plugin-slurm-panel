const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');
const GENERATE = path.join(ROOT, 'dev', 'relabel', 'generate.mjs');
const TABLE = path.join(ROOT, 'dev', 'relabel', 'racks.txt');
const CORE = pathToFileURL(path.join(ROOT, 'packages', 'core', 'dist', 'index.js')).href;

const run = () =>
  execFileSync('node', [GENERATE, TABLE, 'slurm_exporter', 'synthetic-exporter:9341'], { encoding: 'utf8' });

test('the generated relabel config emits one rule per declared group', () => {
  const out = run();
  assert.match(out, /metric_relabel_configs/);
  assert.match(out, /target_label: rack/);
});

test('the generated relabel config agrees with the panel about every node', async () => {
  // The whole reason the generator exists. A table has two destinations, and
  // the claim only holds if both classify a node the same way. This fails if
  // emission mis-escapes a character or drops a zero padding.
  const { parseRangeTable } = await import(CORE);
  const table = parseRangeTable(fs.readFileSync(TABLE, 'utf8'));

  const rules = [...run().matchAll(/regex:\s*(\S+)[\s\S]*?replacement:\s*(\S+)/g)].map(
    ([, regex, replacement]) => ({ regex: new RegExp(`^(?:${regex})$`), group: replacement })
  );

  assert.equal(rules.length, table.groups.length);

  for (const [node, group] of table.index) {
    const matched = rules.filter((rule) => rule.regex.test(node));
    assert.deepEqual(matched.map((m) => m.group), [group]);
  }
});

test('the generated relabel config writes a regex Prometheus reads the same way, not a hostlist', () => {
  // c[1-40] in RE2 means "c then one of 1, 2, 3, 4, 0" - right by accident on
  // c[1-5] and silently wrong from c[1-10] on. Expanded alternation is the
  // only correct emission.
  assert.doesNotMatch(run(), /regex:.*\[\d+-\d+\]/);
});
