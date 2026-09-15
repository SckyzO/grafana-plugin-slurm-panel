import { parseRangeTable } from '../src/group/ranges.js';
import { makeKeyFn, declaredKeys, UNGROUPED } from '../src/group/keys.js';
import type { SlurmNode } from '../src/model/types.js';

const node = (name: string): SlurmNode => ({
  name, state: 'idle', partitions: [], labels: {}, facets: { gres: [] },
});

const TABLE = `
# Row A
rack1: c[1-3]
rack2: c[4-6]

gpu: g[1-2]
`;

describe('parseRangeTable', () => {
  it('keeps the declared order, which is the machine room order', () => {
    expect(parseRangeTable(TABLE).groups.map((g) => g.name)).toEqual(['rack1', 'rack2', 'gpu']);
  });

  it('indexes every member', () => {
    const { index } = parseRangeTable(TABLE);
    expect(index.get('c5')).toBe('rack2');
    expect(index.get('g2')).toBe('gpu');
    expect(index.get('c99')).toBeUndefined();
  });

  it('ignores comments and blank lines', () => {
    expect(parseRangeTable(TABLE).problems).toEqual([]);
  });

  it('skips one invalid line and still parses the others', () => {
    // A grid that blanks on every keystroke is unusable, and this string is
    // invalid for most of the time it is being typed.
    const { groups, problems } = parseRangeTable('rack1: c[1-2]\nbroken: c[5-1]\nrack3: c[7-8]');
    expect(groups.map((g) => g.name)).toEqual(['rack1', 'rack3']);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.line).toBe(2);
    expect(problems[0]!.detail).toContain('backwards');
  });

  it('reports a line with no separator', () => {
    const { problems } = parseRangeTable('rack1 c[1-2]');
    expect(problems[0]!.detail).toContain('separator');
  });

  it('gives a duplicated node to the first line that claimed it, and says so', () => {
    const { index, problems } = parseRangeTable('rack1: c[1-3]\nrack2: c[3-4]');
    expect(index.get('c3')).toBe('rack1');
    expect(problems[0]!.detail).toContain('c3');
    expect(problems[0]!.detail).toContain('rack1');
  });

  it('refuses a second declaration of the same group name', () => {
    const { groups, problems } = parseRangeTable('rack1: c[1-2]\nrack1: c[5-6]');
    expect(groups).toHaveLength(1);
    expect(problems[0]!.detail).toContain('again');
  });
});

describe('the ranges key source', () => {
  it('places a node by the table', () => {
    const keyFn = makeKeyFn({ kind: 'ranges', table: TABLE });
    expect(keyFn(node('c5')).key).toBe('rack2');
  });

  it('is never assumed: a table is stated, not inferred', () => {
    const keyFn = makeKeyFn({ kind: 'ranges', table: TABLE });
    expect(keyFn(node('c5')).assumed).toBe(false);
  });

  it('leaves a node the table does not mention ungrouped', () => {
    const keyFn = makeKeyFn({ kind: 'ranges', table: TABLE });
    expect(keyFn(node('c99')).key).toBe(UNGROUPED);
  });
});

describe('declaredKeys', () => {
  it('returns the declared order for a range table', () => {
    expect(declaredKeys({ kind: 'ranges', table: TABLE })).toEqual(['rack1', 'rack2', 'gpu']);
  });

  it('returns nothing for a source that only discovers its groups by reading nodes', () => {
    expect(declaredKeys({ kind: 'label', label: 'partition' })).toEqual([]);
    expect(declaredKeys({ kind: 'capture', pattern: '^(r\\d+)' })).toEqual([]);
    expect(declaredKeys({ kind: 'chunk', size: 40 })).toEqual([]);
    expect(declaredKeys({ kind: 'none' })).toEqual([]);
  });
});
