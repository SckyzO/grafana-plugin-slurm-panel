import { MAX_SLOT, MIN_SLOT, parseSlotTable } from '../src/layout/slots.js';

describe('parseSlotTable', () => {
  it('reads a hostlist of group names on the left and a slot count on the right', () => {
    const { slots, problems } = parseSlotTable('rack[1-3]: 42\ngpu1: 24');
    expect(problems).toEqual([]);
    expect([...slots.entries()]).toEqual([
      ['rack1', 42],
      ['rack2', 42],
      ['rack3', 42],
      ['gpu1', 24],
    ]);
  });

  it('keeps the zero padding a group name was written with', () => {
    // r1 and r01 are different cabinets on different floors. Collapsing them
    // would silently give one of them the other's height.
    const { slots } = parseSlotTable('r[01-02]: 42');
    expect([...slots.keys()]).toEqual(['r01', 'r02']);
  });

  it('ignores blank lines and # comments to end of line', () => {
    const { slots, problems } = parseSlotTable('# the compute floor\n\nrack1: 42 # a 42U baie\n');
    expect(problems).toEqual([]);
    expect([...slots.entries()]).toEqual([['rack1', 42]]);
  });

  it('reports a line with no separator and skips it', () => {
    const { slots, problems } = parseSlotTable('rack1: 42\nrack2 42');
    expect(slots.get('rack2')).toBeUndefined();
    expect(problems).toEqual([{ line: 2, detail: 'Line 2 has no "groups: count" separator.' }]);
  });

  it('reports a missing count and skips it', () => {
    const { slots, problems } = parseSlotTable('rack1:');
    expect(slots.size).toBe(0);
    expect(problems).toEqual([{ line: 1, detail: 'Line 1 is missing a count.' }]);
  });

  it('reports a count that is not a whole number and skips it', () => {
    const { slots, problems } = parseSlotTable('rack1: forty');
    expect(slots.size).toBe(0);
    expect(problems[0]?.detail).toBe('Line 1 ("forty") is not a whole number of slots.');
  });

  it('reports a count outside the supported range and skips it', () => {
    const { slots, problems } = parseSlotTable('rack1: 0\nrack2: 65');
    expect(slots.size).toBe(0);
    expect(problems.map((p) => p.detail)).toEqual([
      `Line 1 asks for 0 slots; the range is ${MIN_SLOT} to ${MAX_SLOT}.`,
      `Line 2 asks for 65 slots; the range is ${MIN_SLOT} to ${MAX_SLOT}.`,
    ]);
  });

  it('carries the message the hostlist parser gives when an expression will not read', () => {
    const { slots, problems } = parseSlotTable('rack[1-: 42');
    expect(slots.size).toBe(0);
    expect(problems[0]?.line).toBe(1);
    expect(problems[0]?.detail).toContain('rack[1-');
  });

  it('keeps the first declaration of a group and reports the rest, collapsed', () => {
    const { slots, problems } = parseSlotTable('rack[1-3]: 42\nrack[1-3]: 24');
    expect(slots.get('rack1')).toBe(42);
    expect(problems).toEqual([
      { line: 2, detail: 'rack[1-3] are already declared above; the first declaration keeps its count.' },
    ]);
  });

  it('says "is" for a single repeated group', () => {
    const { problems } = parseSlotTable('rack1: 42\nrack1: 24');
    expect(problems[0]?.detail).toBe('rack1 is already declared above; the first declaration keeps its count.');
  });

  it('is empty and silent on an empty table', () => {
    expect(parseSlotTable('')).toEqual({ slots: new Map(), problems: [] });
  });

  it('accepts both ends of the supported range', () => {
    // The bound exists to stop a typo turning a cabinet into a column of a
    // thousand rows, not to reject a real 60U baie.
    const { slots, problems } = parseSlotTable(`rack1: ${MIN_SLOT}\nrack2: ${MAX_SLOT}`);
    expect(problems).toEqual([]);
    expect(slots.get('rack1')).toBe(MIN_SLOT);
    expect(slots.get('rack2')).toBe(MAX_SLOT);
  });
});
