const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// tests/contract has no Jest runtime — see value-mappings.test.cjs, which
// runs on node:test's own API. This shim gives the same file Jest-style
// assertions on top of node:test, implementing only the matchers this file
// uses, so the test bodies below read the same as they would under Jest.
function expect(actual) {
  return {
    toContain: (expected) => assert.ok(
      actual.includes(expected),
      `expected ${JSON.stringify(actual)} to contain ${JSON.stringify(expected)}`
    ),
    toBe: (expected) => assert.strictEqual(actual, expected),
    toEqual: (expected) => assert.deepStrictEqual(actual, expected),
    not: {
      toMatch: (expected) => assert.doesNotMatch(actual, expected),
    },
  };
}

const ROOT = path.resolve(__dirname, '..', '..');
const GENERATE = path.join(ROOT, 'dev', 'relabel', 'generate.mjs');
const TABLE = path.join(ROOT, 'dev', 'relabel', 'racks.txt');
const CORE = pathToFileURL(path.join(ROOT, 'packages', 'core', 'dist', 'index.js')).href;

const run = () =>
  execFileSync('node', [GENERATE, TABLE, 'slurm_exporter', 'synthetic-exporter:9341'], { encoding: 'utf8' });

describe('the generated relabel config', () => {
  it('emits one rule per declared group', () => {
    const out = run();
    expect(out).toContain('metric_relabel_configs');
    expect(out).toContain('target_label: rack');
  });

  it('agrees with the panel about every node', async () => {
    // The whole reason the generator exists. A table has two destinations, and
    // the claim only holds if both classify a node the same way. This fails if
    // emission mis-escapes a character or drops a zero padding.
    const { parseRangeTable } = await import(CORE);
    const table = parseRangeTable(fs.readFileSync(TABLE, 'utf8'));

    const rules = [...run().matchAll(/regex:\s*(\S+)[\s\S]*?replacement:\s*(\S+)/g)].map(
      ([, regex, replacement]) => ({ regex: new RegExp(`^(?:${regex})$`), group: replacement })
    );

    expect(rules.length).toBe(table.groups.length);

    for (const [node, group] of table.index) {
      const matched = rules.filter((rule) => rule.regex.test(node));
      expect(matched.map((m) => m.group)).toEqual([group]);
    }
  });

  it('writes a regex Prometheus reads the same way, not a hostlist', () => {
    // c[1-40] in RE2 means "c then one of 1, 2, 3, 4, 0" - right by accident on
    // c[1-5] and silently wrong from c[1-10] on. Expanded alternation is the
    // only correct emission.
    expect(run()).not.toMatch(/regex:.*\[\d+-\d+\]/);
  });
});
