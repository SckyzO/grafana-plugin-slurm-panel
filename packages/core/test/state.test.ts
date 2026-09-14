import { BASE_STATES, parseState } from '../src/state/parse.js';

describe('parseState splits a sinfo state into base and modifiers', () => {
  it.each([
    ['idle', 'idle', [], 'idle'],
    ['idle*', 'idle', ['*'], 'idle, not responding'],
    ['mixed-', 'mixed', ['-'], 'mixed, planned by backfill'],
    ['allocated~', 'allocated', ['~'], 'allocated, powered down'],
    ['down#', 'down', ['#'], 'down, powering up'],
    ['idle!', 'idle', ['!'], 'idle, power down pending'],
    ['idle%', 'idle', ['%'], 'idle, powering down'],
    ['idle$', 'idle', ['$'], 'idle, in a maintenance reservation'],
    ['idle@', 'idle', ['@'], 'idle, reboot pending'],
    ['idle^', 'idle', ['^'], 'idle, reboot issued'],
  ])('parses %s', (raw, base, symbols, text) => {
    const parsed = parseState(raw);
    expect(parsed.base).toBe(base);
    expect(parsed.modifiers.map((m) => m.symbol)).toEqual(symbols);
    expect(parsed.text).toBe(text);
    expect(parsed.raw).toBe(raw);
  });

  it('accepts inval, which sinfo does not document but the exporter emits', () => {
    expect(parseState('inval').base).toBe('inval');
    expect(parseState('inval').modifiers).toEqual([]);
  });

  it('keeps an unrecognised trailing character rather than guessing at it', () => {
    const parsed = parseState('idle?');
    expect(parsed.base).toBe('idle?');
    expect(parsed.modifiers).toEqual([]);
    expect(parsed.text).toBe('idle?');
  });

  it('does not strip a modifier character off an unknown base state', () => {
    // A state Slurm adds in a future release must survive intact.
    const parsed = parseState('quiescing*');
    expect(parsed.base).toBe('quiescing');
    expect(parsed.modifiers.map((m) => m.symbol)).toEqual(['*']);
  });

  it('handles an empty state without throwing', () => {
    expect(parseState('')).toEqual({ base: '', modifiers: [], text: '', raw: '' });
  });

  it('parses every documented base state as itself, with no modifiers', () => {
    // Consumes BASE_STATES so the list is verified rather than decorative, and
    // catches a future Slurm state whose name ends in a modifier character —
    // that state would silently lose its last letter.
    for (const base of BASE_STATES) {
      expect(parseState(base)).toEqual({ base, modifiers: [], text: base, raw: base });
    }
  });
});
