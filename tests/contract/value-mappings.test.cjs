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

// The rules the plugin ships, read from the file it ships them in. This used
// to be a transcription, and the transcription drifted: the patterns stayed
// in step, the palette did not, and the colour assertions below were pinning
// eighteen colours no build had produced in months. Two readers, one file.
//
// This does not make the file a test of ourselves. Every assertion below is
// about what *Grafana* does with these rules — that a RegexToText mapping
// resolves on a string field, that the colour survives the display processor,
// that first-match-wins holds. The rules are the input; Grafana is the
// subject. The three trap tests further down supply their own fixtures
// precisely because they must not depend on what we happen to ship.
const SHIPPED_RULES = require('../../plugins/nodegrid-panel/data/mappings.json');
const SHIPPED = SHIPPED_RULES.map((r) => rule(r.pattern, r.text, r.color));

const displayFor = (values, mappings = SHIPPED) =>
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

const THEME = createTheme();

// The oracle: the colour table in the shipped README, which is what a reader
// is actually promised, transcribed here by hand.
//
// A transcription is the right shape for an *expected output* — it earns its
// keep precisely by disagreeing when the rules move. It was the wrong shape
// for the *input*, which is the defect this file used to carry, and the two
// must not be confused.
//
// Nothing computed from mappings.json can do this job. A table recomputed
// from the rules agrees with the rules by construction, whatever the rules
// say. This was measured, not assumed: an earlier version of this test
// compared a resolved colour count against a count derived from the same
// JSON, and permuting the idle and blocked colours passed it 9 out of 9.
// Grafana's own RegexToText branch is stringToJsRegex + String.match, first
// match wins — the same walk — so the two sides could never have diverged.
const EXPECTED_COLOURS = {
  allocated: '#96D98D',
  mixed: '#73BF69',
  completing: '#56A64B',
  idle: '#5794F2',
  planned: '#8AB8FF',
  drained: '#8F3BB8',
  maint: '#8F3BB8',
  reserved: '#8F3BB8',
  perfctrs: '#8F3BB8',
  blocked: '#FF9830',
  reboot_issued: '#FF9830',
  down: '#C4162A',
  unknown: '#C4162A',
  // "the theme's own ink" in the README's table, and deliberately not a hex:
  // these two states are absent from the floor, so they take whatever colour
  // the reader's theme writes in.
  power_down: THEME.colors.text.primary,
  future: THEME.colors.text.primary,
};

test('every state in that list resolves the colour the README promises', () => {
  // A rule naming a colour the theme does not know still "maps": it returns
  // text and a falsy or fallback colour, and the grid comes out uniform.
  for (const [value, expected] of Object.entries(EXPECTED_COLOURS)) {
    const dv = displayFor([value])(value);
    assert.ok(dv.color, `expected a colour for ${value}`);
    assert.match(dv.color, /^(#|rgb)/, `${value} resolved to a non-colour: ${dv.color}`);
    assert.equal(
      dv.color.toUpperCase(),
      expected.toUpperCase(),
      `${value}: the README promises ${expected}, the rules resolve ${dv.color}`
    );
  }

  // And the palette discriminates. Pinned against the README's table, which
  // has nine rows: collapsing two families is a decision, and this is what
  // makes it a deliberate one rather than a silent one.
  assert.equal(
    new Set(Object.values(EXPECTED_COLOURS).map((c) => c.toUpperCase())).size,
    9,
    'the README documents nine colour families'
  );
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
        mappings: SHIPPED,
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
