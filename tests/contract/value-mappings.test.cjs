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
  rule('/^idle.*-$/', 'idle, backfill', 'semi-dark-green'),
  rule('/^idle.*$/', 'idle', 'green'),
  rule('/^(planned|plnd).*$/', 'planned', 'light-green'),
  rule('/^comp.*$/', 'completing', 'super-light-blue'),
  rule('/^mix.*-$/', 'mixed, backfill', 'light-blue'),
  rule('/^mix.*$/', 'mixed', 'blue'),
  rule('/^alloc.*-$/', 'allocated, backfill', 'semi-dark-blue'),
  rule('/^alloc.*$/', 'allocated', 'dark-blue'),
  rule('/^(drain|drng).*$/', 'drained', 'yellow'),
  rule('/^maint.*$/', 'maintenance', 'purple'),
  rule('/^res.*$/', 'reserved', 'semi-dark-purple'),
  rule('/^(npc|perfctrs).*$/', 'perf counters', 'light-purple'),
  rule('/^(down|fail).*$/', 'down', 'red'),
  rule('/^unk.*$/', 'unknown', 'semi-dark-red'),
  rule('/^inval.*$/', 'invalid registration', 'semi-dark-red'),
  rule('/^block.*$/', 'blocked', 'orange'),
  rule('/^reboot.*$/', 'reboot', 'light-orange'),
  rule('/^pow.*$/', 'power management', 'text'),
  rule('/^fut.*$/', 'future', 'text'),
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
  // Every state in the sinfo man page's NODE STATE CODES section, in both the
  // long form (what slurm_exporter asks sinfo for, via StateLong:) and the
  // abbreviation (what %t prints). A rule that covered only one of the two
  // would leave half a cluster uncoloured and is the reason this list is
  // exhaustive rather than representative.
  const cases = [
    ['idle', 'idle'],
    ['idle*', 'not responding'],
    ['idle~', 'powered down'],
    ['idle-', 'idle, backfill'],
    ['mixed', 'mixed'],
    ['mix', 'mixed'],
    ['mixed-', 'mixed, backfill'],
    ['mix-', 'mixed, backfill'],
    ['mixed*', 'not responding'],
    ['allocated', 'allocated'],
    ['alloc', 'allocated'],
    ['allocated+', 'allocated'],
    ['allocated-', 'allocated, backfill'],
    ['drained', 'drained'],
    ['drain', 'drained'],
    ['draining', 'drained'],
    ['drng', 'drained'],
    ['down', 'down'],
    ['down*', 'not responding'],
    ['fail', 'down'],
    ['failing', 'down'],
    ['failg', 'down'],
    ['maint', 'maintenance'],
    ['completing', 'completing'],
    ['comp', 'completing'],
    ['planned', 'planned'],
    ['plnd', 'planned'],
    ['reserved', 'reserved'],
    ['resv', 'reserved'],
    ['perfctrs', 'perf counters'],
    ['npc', 'perf counters'],
    ['blocked', 'blocked'],
    ['block', 'blocked'],
    ['unknown', 'unknown'],
    ['unk', 'unknown'],
    ['inval', 'invalid registration'],
    ['reboot_issued', 'reboot'],
    ['reboot_requested', 'reboot'],
    ['power_down', 'power management'],
    ['powered_down', 'power management'],
    ['powering_down', 'power management'],
    ['powering_up', 'power management'],
    ['pow_dn', 'power management'],
    ['pow_up', 'power management'],
    ['future', 'future'],
    ['futr', 'future'],
  ];
  for (const [value, expected] of cases) {
    assert.equal(displayFor([value])(value).text, expected, `mapping ${value}`);
  }
});

test('every state in that list also resolves a colour, and the set discriminates', () => {
  // A rule naming a colour the theme does not know still "maps": it returns
  // text and a falsy or fallback colour, and the grid comes out uniform. Check
  // the colours land, and that they are not all the same one.
  const colours = new Set();
  for (const value of ['idle', 'mixed', 'allocated', 'drained', 'down', 'maint',
                       'reserved', 'perfctrs', 'blocked', 'completing', 'planned',
                       'unknown', 'reboot_issued', 'power_down', 'future']) {
    const dv = displayFor([value])(value);
    assert.ok(dv.color, `expected a colour for ${value}`);
    assert.match(dv.color, /^(#|rgb)/, `${value} resolved to a non-colour: ${dv.color}`);
    colours.add(dv.color);
  }
  assert.ok(colours.size >= 10, `expected the palette to discriminate, got ${colours.size} colours`);
});

test('a state matching no mapping keeps its raw text', () => {
  // These were real Slurm states until the rule set was completed against the
  // sinfo man page, which is exactly why they are no longer usable here: a
  // test for unmapped behaviour has to use a value that will not quietly
  // become mapped. Stand-ins for whatever a future Slurm adds.
  for (const value of ['plasma', 'entangled', 'zzz_not_a_state']) {
    assert.equal(displayFor([value])(value).text, value);
  }
});

// Trap 3: a state name is not always a safe regex. Slurm prints `allocated+`
// for a node allocated with jobs still completing. The panel prints a rule for
// an operator to paste, so what Grafana does with an escaped and an unescaped
// name is a contract rather than an implementation detail.
test('an unescaped state name makes a rule that matches more than the state', () => {
  const unescaped = [rule('/^allocated+.*$/', 'allocated', 'dark-blue')];
  const escaped = [rule('/^allocated\\+.*$/', 'allocated', 'dark-blue')];

  // The unescaped rule does still match the state it was written for — the
  // trailing `.*` absorbs the literal `+`, which is why this is easy to ship
  // without noticing.
  assert.equal(displayFor(['allocated+'], unescaped)('allocated+').text, 'allocated');

  // What it also does is match a state that does not exist: `d+` is one or
  // more `d`, so anything spelled `allocatedd...` is reported as allocated.
  assert.equal(displayFor(['allocatedd'], unescaped)('allocatedd').text, 'allocated');

  // The escaped form matches the state and nothing else.
  assert.equal(displayFor(['allocated+'], escaped)('allocated+').text, 'allocated');
  assert.equal(displayFor(['allocatedd'], escaped)('allocatedd').text, 'allocatedd');
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

// Trap 3: with thresholds configured (always true here, since module.ts calls
// useFieldConfig()), a mapping match and a threshold fallback are only
// distinguishable through `percent`, not through `text` or `color` alone —
// an unmapped value still gets a colour, from the threshold base colour.
const displayWithThresholds = (values) =>
  getDisplayProcessor({
    field: {
      name: 'status',
      type: FieldType.string,
      values,
      config: {
        mappings: DEFAULTS,
        thresholds: { mode: 'absolute', steps: [{ value: -Infinity, color: 'green' }] },
      },
    },
    theme: createTheme(),
  });

test('a value matching a mapping leaves percent undefined, even with thresholds configured', () => {
  const dv = displayWithThresholds(['idle'])('idle');
  assert.equal(dv.text, 'idle');
  assert.equal(dv.percent, undefined);
});

test('a value matching no mapping falls through to the threshold path: percent is set and the colour is the threshold colour, not a mapping colour', () => {
  // Not a real Slurm state: every one of those is mapped now, and this test
  // needs a value that misses on purpose. That is also the danger being
  // pinned — the day Slurm adds a state, it arrives here, unmapped, and must
  // not be painted with the threshold base colour as though it were healthy.
  const dv = displayWithThresholds(['zzz_not_a_state'])('zzz_not_a_state');
  const theme = createTheme();
  assert.equal(dv.text, 'zzz_not_a_state');
  assert.equal(dv.percent, 0);
  // Resolved via the theme, the same as Grafana does: the threshold step's
  // named colour ('green'), not a raw mapping colour.
  assert.equal(
    dv.color,
    theme.visualization.getColorByName('green'),
    'expected the threshold base colour, not a mapping colour'
  );
});
