import { buildGroups } from '../src/group/build.js';
import type { SlurmNode } from '../src/model/types.js';

const node = (name: string, partitions: string[] = [], labels: Record<string, string> = {}): SlurmNode => ({
  name, state: 'idle', partitions, labels, facets: { gres: [] },
});

describe('buildGroups', () => {
  it('groups by a label and sorts the groups by key', () => {
    const model = buildGroups(
      [node('c2', [], { rack: 'r02' }), node('c1', [], { rack: 'r01' })],
      { kind: 'label', label: 'rack' }
    );
    expect(model.groups.map((g) => g.key)).toEqual(['r01', 'r02']);
    expect(model.nodeCount).toBe(2);
    expect(model.slotCount).toBe(2);
    expect(model.duplicated).toBe(false);
  });

  it('orders within a group by the ordinal, not lexically', () => {
    // c10 sorts before c2 as a string; a rack that reads 1, 10, 2 is wrong.
    const model = buildGroups([node('c10'), node('c2'), node('c1')], { kind: 'chunk', size: 40 });
    expect(model.groups[0]?.nodes.map((n) => n.name)).toEqual(['c1', 'c2', 'c10']);
  });

  it('falls back to a natural sort for names carrying no ordinal', () => {
    const model = buildGroups([node('login-b'), node('login-a')], { kind: 'none' });
    expect(model.groups[0]?.nodes.map((n) => n.name)).toEqual(['login-a', 'login-b']);
  });

  it('places a node in every group of a multi-valued key, and reports both counts', () => {
    const model = buildGroups(
      [node('c1', ['cpu', 'debug', 'high']), node('c4', ['cpu'])],
      { kind: 'label', label: 'partition' },
      { multiValueLabel: true }
    );
    expect(model.groups.map((g) => g.key)).toEqual(['cpu', 'debug', 'high']);
    expect(model.nodeCount).toBe(2);
    expect(model.slotCount).toBe(4);
    expect(model.duplicated).toBe(true);
  });

  it('marks a group assumed when the key was invented', () => {
    expect(buildGroups([node('compute0421')], { kind: 'chunk', size: 40 }).groups[0]?.assumed).toBe(true);
  });

  it('does not mark a label group assumed', () => {
    expect(buildGroups([node('c1', [], { rack: 'r01' })], { kind: 'label', label: 'rack' }).groups[0]?.assumed)
      .toBe(false);
  });

  it('is stable when the input order changes between refreshes', () => {
    const nodes = [node('c1', [], { rack: 'r01' }), node('c2', [], { rack: 'r01' }), node('c3', [], { rack: 'r02' })];
    const forward = buildGroups(nodes, { kind: 'label', label: 'rack' });
    const reversed = buildGroups([...nodes].reverse(), { kind: 'label', label: 'rack' });
    expect(reversed.groups.map((g) => g.key)).toEqual(forward.groups.map((g) => g.key));
    expect(reversed.groups.map((g) => g.nodes.map((n) => n.name)))
      .toEqual(forward.groups.map((g) => g.nodes.map((n) => n.name)));
  });

  it('returns an empty model for no nodes rather than one empty group', () => {
    expect(buildGroups([], { kind: 'none' })).toEqual({
      groups: [], nodeCount: 0, slotCount: 0, duplicated: false,
    });
  });
});
