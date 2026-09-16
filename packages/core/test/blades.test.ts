import { MAX_BLADE, MIN_BLADE, parseBladeTable } from '../src/layout/blades.js';

describe('parseBladeTable', () => {
  it('reads a hostlist of group names on the left and a count on the right', () => {
    const { sizes, problems } = parseBladeTable('rack[1-3]: 4\ngpu1: 2');
    expect(problems).toEqual([]);
    expect([...sizes.entries()]).toEqual([
      ['rack1', 4],
      ['rack2', 4],
      ['rack3', 4],
      ['gpu1', 2],
    ]);
  });

  it('keeps the zero padding a group name was written with', () => {
    // r1 and r01 are different cabinets on different floors. Collapsing them
    // would silently give one of them the other's blade size.
    const { sizes } = parseBladeTable('r[01-02]: 4');
    expect([...sizes.keys()]).toEqual(['r01', 'r02']);
  });

  it('takes a name with no brackets as itself', () => {
    const { sizes, problems } = parseBladeTable('aisleA: 3');
    expect(problems).toEqual([]);
    expect(sizes.get('aisleA')).toBe(3);
  });

  it('ignores blank lines and # comments to end of line', () => {
    const { sizes, problems } = parseBladeTable('# the compute floor\n\nrack1: 4 # quads\n');
    expect(problems).toEqual([]);
    expect([...sizes.entries()]).toEqual([['rack1', 4]]);
  });

  it('reports a line with no separator and skips it', () => {
    const { sizes, problems } = parseBladeTable('rack1: 4\nrack2 4');
    expect(sizes.get('rack2')).toBeUndefined();
    expect(problems).toEqual([{ line: 2, detail: 'Line 2 has no "groups: count" separator.' }]);
  });

  it('reports a missing count and skips it', () => {
    // e.g. "rack1:" with nothing after the colon. expr is always non-empty by
    // the time this guard runs, so count is the only thing this can report.
    const { sizes, problems } = parseBladeTable('rack1:');
    expect(sizes.size).toBe(0);
    expect(problems).toEqual([{ line: 1, detail: 'Line 1 is missing a count.' }]);
  });

  it('reports a count that is not a whole number and skips it', () => {
    const { sizes, problems } = parseBladeTable('rack1: two');
    expect(sizes.size).toBe(0);
    expect(problems[0]?.detail).toBe('Line 1 ("two") is not a whole number of nodes per blade.');
  });

  it('reports a count outside the supported range and skips it', () => {
    const { sizes, problems } = parseBladeTable('rack1: 0\nrack2: 9');
    expect(sizes.size).toBe(0);
    expect(problems.map((p) => p.detail)).toEqual([
      `Line 1 asks for 0 nodes per blade; the range is ${MIN_BLADE} to ${MAX_BLADE}.`,
      `Line 2 asks for 9 nodes per blade; the range is ${MIN_BLADE} to ${MAX_BLADE}.`,
    ]);
  });

  it('carries the message the hostlist parser gives when an expression will not read', () => {
    const { sizes, problems } = parseBladeTable('rack[1-: 4');
    expect(sizes.size).toBe(0);
    expect(problems[0]?.line).toBe(1);
    expect(problems[0]?.detail).toContain('rack[1-');
  });

  it('keeps the first declaration of a group and reports the rest, collapsed', () => {
    // Collapsed rather than one problem per name: a floor plan that declares
    // rack[1-120] twice would otherwise print a hundred and twenty lines.
    const { sizes, problems } = parseBladeTable('rack[1-3]: 4\nrack[1-3]: 2');
    expect(sizes.get('rack1')).toBe(4);
    expect(problems).toEqual([
      { line: 2, detail: 'rack[1-3] are already declared above; the first declaration keeps its count.' },
    ]);
  });

  it('says "is" for a single repeated group', () => {
    const { problems } = parseBladeTable('rack1: 4\nrack1: 2');
    expect(problems[0]?.detail).toBe('rack1 is already declared above; the first declaration keeps its count.');
  });

  it('is empty and silent on an empty table', () => {
    expect(parseBladeTable('')).toEqual({ sizes: new Map(), problems: [] });
  });
});
