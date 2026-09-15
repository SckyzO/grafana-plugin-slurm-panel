const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');
const GENERATE = path.join(ROOT, 'dev', 'relabel', 'generate.mjs');
const TABLE = path.join(ROOT, 'dev', 'relabel', 'racks.txt');
const CORE = pathToFileURL(path.join(ROOT, 'packages', 'core', 'dist', 'index.js')).href;

const runOn = (tableFile) =>
  execFileSync('node', [GENERATE, tableFile, 'slurm_exporter', 'synthetic-exporter:9341'], { encoding: 'utf8' });
const run = () => runOn(TABLE);

// The extraction below reads `regex:` and `replacement:` back out of the
// generator's plain-text output. `replacement` used to be captured with
// `(\S+)`, which truncates a group name containing a space — a shape the
// spec explicitly allows — before that name ever reaches the assertion.
// `(.+)` reads the rest of the line instead.
const rulesFrom = (output) =>
  [...output.matchAll(/regex:\s*(\S+)[\s\S]*?replacement:\s*(.+)/g)].map(([, regex, replacement]) => ({
    regex: new RegExp(`^(?:${regex})$`),
    group: replacement,
  }));

test('the generated relabel config emits one rule per declared group', () => {
  const out = run();
  assert.match(out, /metric_relabel_configs/);
  assert.match(out, /target_label: rack/);
});

test('the generated relabel config agrees with the panel about every node', async () => {
  // The whole reason the generator exists. A table has two destinations, and
  // the claim only holds if both classify a node the same way. This fixture —
  // dev/relabel/racks.txt — is all c1..c160 and g1..g80, so it cannot exercise
  // a mis-escaped character or a dropped zero padding; the fixture below does.
  const { parseRangeTable } = await import(CORE);
  const table = parseRangeTable(fs.readFileSync(TABLE, 'utf8'));

  const rules = rulesFrom(run());

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

// dev/relabel/racks.txt alone cannot prove the generator handles a zero-padded
// range or a member carrying a regex metacharacter, because it has neither.
// This second fixture is built specifically to need both, plus a group name
// with a space, which the spec explicitly allows.
const SCRATCH_DIR = path.join(__dirname, '.tmp');
const SCRATCH_TABLE = path.join(SCRATCH_DIR, 'mixed-shapes.txt');
fs.mkdirSync(SCRATCH_DIR, { recursive: true });
fs.writeFileSync(
  SCRATCH_TABLE,
  [
    'padded: n[001-003]',
    'dotted: a.b1',
    // Same length as `a.b1`, differing only where the dot sits. An
    // unescaped "." in the dotted group's emitted regex is a wildcard, so
    // this node is exactly what that mistake would also match.
    'confusable: axb1',
    'spaced group: c[1-2]',
    '',
  ].join('\n')
);
after(() => fs.rmSync(SCRATCH_DIR, { recursive: true, force: true }));

test('the generated relabel config survives padding, a regex metacharacter and a spaced group name', async () => {
  const { parseRangeTable } = await import(CORE);
  const table = parseRangeTable(fs.readFileSync(SCRATCH_TABLE, 'utf8'));

  // Ground truth, written by hand rather than re-derived from the parser:
  // a bug shared by the parser and the generator — both call the same
  // expandHostlist — would agree with itself and this test would stay green
  // testing them against each other. Comparing against a hardcoded
  // expectation is what lets each mutation below actually turn this red.
  const EXPECTED = {
    n001: 'padded',
    n002: 'padded',
    n003: 'padded',
    'a.b1': 'dotted',
    axb1: 'confusable',
    c1: 'spaced group',
    c2: 'spaced group',
  };

  // The parser itself classified every node the way this test expects —
  // catches a bug in expandHostlist (padding, a metachar item) directly.
  assert.deepEqual(Object.fromEntries(table.index), EXPECTED);

  const rules = rulesFrom(runOn(SCRATCH_TABLE));
  assert.equal(rules.length, table.groups.length);

  // The generated regex agrees with that same ground truth — catches a bug
  // in generate.mjs's own emission (a dropped escape, a mis-joined
  // alternation) even when the parser it calls is correct.
  for (const [node, group] of Object.entries(EXPECTED)) {
    const matched = rules.filter((rule) => rule.regex.test(node));
    assert.deepEqual(matched.map((m) => m.group), [group], `node ${node}`);
  }
});
