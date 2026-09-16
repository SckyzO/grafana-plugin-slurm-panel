import { buildGroups } from '../src/group/build.js';
import { UNGROUPED } from '../src/group/keys.js';
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
    expect(model.cellCount).toBe(2);
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
    expect(model.cellCount).toBe(4);
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
      groups: [], nodeCount: 0, cellCount: 0, duplicated: false,
    });
  });
});

describe('declared order', () => {
  const rackNode = (name: string, rack: string): SlurmNode => ({
    name, state: 'idle', partitions: [], labels: { rack }, facets: { gres: [] },
  });

  const source = { kind: 'label', label: 'rack' } as const;

  it('emits declared groups in the order they were declared, not alphabetically', () => {
    // A machine room floor is not in alphabetical order, and the table is the
    // only place the operator can say what order it is in.
    const nodes = [rackNode('c1', 'zulu'), rackNode('c2', 'alpha')];
    const model = buildGroups(nodes, source, { order: ['zulu', 'alpha'] });
    expect(model.groups.map((g) => g.key)).toEqual(['zulu', 'alpha']);
  });

  it('emits a declared group that matched no node, empty, in its declared place', () => {
    const nodes = [rackNode('c1', 'rack1'), rackNode('c2', 'rack3')];
    const model = buildGroups(nodes, source, { order: ['rack1', 'rack2', 'rack3'] });
    expect(model.groups.map((g) => g.key)).toEqual(['rack1', 'rack2', 'rack3']);
    expect(model.groups[1]!.nodes).toEqual([]);
  });

  it('does not count an empty group as nodes or as cells', () => {
    const nodes = [rackNode('c1', 'rack1')];
    const model = buildGroups(nodes, source, { order: ['rack1', 'rack2'] });
    expect(model.nodeCount).toBe(1);
    expect(model.cellCount).toBe(1);
  });

  it('sorts an undeclared group naturally, after every declared one', () => {
    const nodes = [rackNode('c1', 'rack9'), rackNode('c2', 'aaa'), rackNode('c3', 'rack1')];
    const model = buildGroups(nodes, source, { order: ['rack9'] });
    expect(model.groups.map((g) => g.key)).toEqual(['rack9', 'aaa', 'rack1']);
  });

  it('keeps ungrouped last whatever the declared order says', () => {
    const nodes = [rackNode('c1', 'rack1'), { ...rackNode('c2', ''), labels: {} }];
    const model = buildGroups(nodes, source, { order: ['ungrouped', 'rack1'] });
    expect(model.groups.at(-1)!.key).toBe(UNGROUPED);
  });

  it('changes nothing for a source that declares nothing', () => {
    const nodes = [rackNode('c1', 'zulu'), rackNode('c2', 'alpha')];
    expect(buildGroups(nodes, source).groups.map((g) => g.key)).toEqual(['alpha', 'zulu']);
  });

  it('draws no empty group when there is no data at all', () => {
    // Nothing to say about a floor plan when no node reported anything.
    expect(buildGroups([], source, { order: ['rack1'] }).groups).toEqual([]);
  });
});
