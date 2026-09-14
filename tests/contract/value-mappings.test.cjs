const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

// @grafana/data touches window and document at import time and throws
// "window is not defined" under bare Node, so the DOM goes up first.
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  url: 'http://localhost',
});
for (const key of [
  'window', 'document', 'navigator', 'localStorage',
  'HTMLElement', 'Element', 'Node', 'getComputedStyle', 'requestAnimationFrame',
]) {
  if (globalThis[key] === undefined) {
    try {
      globalThis[key] = key === 'window' ? dom.window : dom.window[key];
    } catch {
      // Some globals are read-only on newer Node; the ones that matter are not.
    }
  }
}

const {
  createTheme, FieldType, getDisplayProcessor, MappingType, stringToJsRegex,
} = require('@grafana/data');

const rule = (pattern, text, color) => ({
  type: MappingType.RegexToText,
  options: { pattern, result: { text, color } },
});

// The plugin keeps its own copy of this list at
// plugins/nodegrid-panel/src/defaults/mappings.ts. The duplication is
// deliberate: this file pins GRAFANA's behaviour, and importing our own
// plugin here would turn a contract test into a test of ourselves.
const DEFAULTS = [
  rule('/^.*\\*$/', 'not responding', 'semi-dark-orange'),
  rule('/^.*~$/', 'powered down', 'text'),
  rule('/^idle-.*$/', 'idle, backfill', 'semi-dark-green'),
  rule('/^idle.*$/', 'idle', 'green'),
  rule('/^mixed-.*$/', 'mixed, backfill', 'semi-dark-blue'),
  rule('/^mixed.*$/', 'mixed', 'blue'),
  rule('/^alloc-.*$/', 'allocated, backfill', 'semi-dark-blue'),
  rule('/^alloc.*$/', 'allocated', 'dark-blue'),
  rule('/^drain.*$/', 'drained', 'yellow'),
  rule('/^(down|fail).*$/', 'down', 'red'),
  rule('/^maint.*$/', 'maintenance', 'purple'),
];

const displayFor = (values, mappings = DEFAULTS) =>
  getDisplayProcessor({
    field: { name: 'status', type: FieldType.string, values, config: { mappings } },
    theme: createTheme(),
  });

// The load-bearing assumption: status is a string, not a number.
test('value mappings resolve on a string field at all', () => {
  const dv = displayFor(['idle'])('idle');
  assert.equal(dv.text, 'idle');
  assert.ok(dv.color, 'expected a colour to be resolved');
});

test('every shipped default maps its state to the intended text', () => {
  const cases = [
    ['idle', 'idle'],
    ['idle*', 'not responding'],
    ['idle~', 'powered down'],
    ['idle-', 'idle, backfill'],
    ['mixed', 'mixed'],
    ['mixed-', 'mixed, backfill'],
    ['mixed*', 'not responding'],
    ['allocated', 'allocated'],
    ['allocated-', 'allocated, backfill'],
    ['drained', 'drained'],
    ['draining', 'drained'],
    ['down', 'down'],
    ['down*', 'not responding'],
    ['fail', 'down'],
    ['failing', 'down'],
    ['maint', 'maintenance'],
  ];
  for (const [value, expected] of cases) {
    assert.equal(displayFor([value])(value).text, expected, `mapping ${value}`);
  }
});

test('a state matching no mapping keeps its raw text', () => {
  for (const value of ['perfctrs', 'blocked', 'inval']) {
    assert.equal(displayFor([value])(value).text, value);
  }
});

// Trap 1: a bare pattern is anchored at both ends, so a prefix rule silently
// becomes an exact match and idle* falls straight through it.
test('Grafana wraps an undelimited pattern in ^...$', () => {
  assert.equal(stringToJsRegex('^idle').source, '^^idle$');
  assert.equal(stringToJsRegex('^idle').test('idle*'), false);
  assert.equal(stringToJsRegex('/^idle/').source, '^idle');
  assert.equal(stringToJsRegex('/^idle/').test('idle*'), true);
});

// Trap 2: RegexToText replaces the match rather than labelling the value, so a
// pattern that stops short leaves the remainder glued to the result.
test('RegexToText replaces only the matched portion', () => {
  const short = [rule('/^drain/', 'drained', 'yellow')];
  assert.equal(displayFor(['drained'], short)('drained').text, 'draineded');
});
