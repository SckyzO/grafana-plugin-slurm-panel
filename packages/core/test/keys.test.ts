import { makeKeyFn, ordinalOf, UNGROUPED } from '../src/group/keys.js';
import type { SlurmNode } from '../src/model/types.js';

const node = (name: string, labels: Record<string, string> = {}): SlurmNode => ({
  name, state: 'idle', partitions: [], labels, facets: { gres: [] },
});

describe('label keys read a value the data already carries', () => {
  const key = makeKeyFn({ kind: 'label', label: 'rack' });

  it('reads the label', () => {
    expect(key(node('c1', { rack: 'r012' }))).toEqual({ key: 'r012', assumed: false });
  });

  it('falls back rather than dropping a node with the label missing', () => {
    expect(key(node('c1'))).toEqual({ key: UNGROUPED, assumed: false });
  });
});

describe('capture keys read structure the node name encodes', () => {
  const key = makeKeyFn({ kind: 'capture', pattern: '^(r\\d+)c\\d+n\\d+$' });

  it('returns the first capture group', () => {
    expect(key(node('r012c04n03'))).toEqual({ key: 'r012', assumed: false });
  });

  it('falls back when the pattern matches nothing', () => {
    expect(key(node('c1'))).toEqual({ key: UNGROUPED, assumed: false });
  });

  it('falls back on a pattern with no capture group', () => {
    expect(makeKeyFn({ kind: 'capture', pattern: '^r\\d+' })(node('r012c04n03')))
      .toEqual({ key: UNGROUPED, assumed: false });
  });

  it('does not throw on a pattern that will not compile', () => {
    // A regex typed into a panel option is typed by a human, mid-thought.
    expect(makeKeyFn({ kind: 'capture', pattern: '^(unclosed' })(node('c1')))
      .toEqual({ key: UNGROUPED, assumed: false });
  });
});

describe('chunk keys invent structure, and say so', () => {
  const key = makeKeyFn({ kind: 'chunk', size: 40 });

  it.each([
    ['compute0001', 'chunk 1'],
    ['compute0040', 'chunk 1'],
    ['compute0041', 'chunk 2'],
    ['compute0421', 'chunk 11'],
  ])('slices %s into %s', (name, expected) => {
    expect(key(node(name))).toEqual({ key: expected, assumed: true });
  });

  it('marks the result assumed even when it lands in the first chunk', () => {
    expect(key(node('c1')).assumed).toBe(true);
  });

  it('falls back for a name carrying no ordinal, and is not assumed', () => {
    // Nothing was invented here, so nothing is claimed.
    expect(key(node('login'))).toEqual({ key: UNGROUPED, assumed: false });
  });

  it('refuses a non-positive chunk size instead of dividing by zero', () => {
    expect(makeKeyFn({ kind: 'chunk', size: 0 })(node('compute0421')))
      .toEqual({ key: UNGROUPED, assumed: false });
  });
});

describe('no grouping puts every node in one group', () => {
  it('returns a single key', () => {
    expect(makeKeyFn({ kind: 'none' })(node('c1'))).toEqual({ key: UNGROUPED, assumed: false });
  });
});

describe('ordinalOf reads the trailing number of a node name', () => {
  it.each([
    ['c1', 1], ['c10', 10], ['compute0421', 421], ['r012c04n03', 3], ['login', undefined],
  ])('reads %s as %s', (name, expected) => {
    expect(ordinalOf(name)).toBe(expected);
  });
});
