import { suggestLabel } from '../src/group/coverage.js';
import { buildGroups } from '../src/group/build.js';
import { UNGROUPED } from '../src/group/keys.js';
import type { SlurmNode } from '../src/model/types.js';

const node = (name: string, labels: Record<string, string>, partitions: string[] = []): SlurmNode => ({
  name, state: 'idle', partitions, labels, facets: { gres: [] },
});

const withRack = [
  node('c1', { rack: 'r1', node: 'c1', status: 'idle' }),
  node('c2', { rack: 'r1', node: 'c2', status: 'idle' }),
  node('c3', { rack: 'r2', node: 'c3', status: 'idle' }),
];

const args = { nodeLabel: 'node', stateLabel: 'status' };

describe('suggestLabel', () => {
  it('says nothing when grouping is switched off, which is a choice', () => {
    expect(suggestLabel({ nodes: withRack, source: { kind: 'none' }, placed: 0, ...args })).toBeUndefined();
  });

  it('says nothing when the active source already covers as much', () => {
    const source = { kind: 'label', label: 'rack' } as const;
    expect(suggestLabel({ nodes: withRack, source, placed: 3, ...args })).toBeUndefined();
  });

  it('names a label that would cover more than the active source does', () => {
    const source = { kind: 'capture', pattern: '^(zzz)' } as const;
    expect(suggestLabel({ nodes: withRack, source, placed: 0, ...args }))
      .toEqual({ label: 'rack', covered: 3, total: 3 });
  });

  it('never nominates the node label, which is one group per node', () => {
    // The identity guard would catch this too, since a node label has one
    // value per node by definition. The explicit exclusion is kept because it
    // states the intent and skips the counting; this test pins the outcome,
    // not which of the two guards produced it.
    const nodes = [node('c1', { node: 'c1' }), node('c2', { node: 'c2' })];
    const source = { kind: 'capture', pattern: '^(zzz)' } as const;
    expect(suggestLabel({ nodes, source, placed: 0, ...args })).toBeUndefined();
  });

  it('never nominates the state label, which is a measurement and not a topology', () => {
    // Three nodes, two states: the identity guard does not fire here, so the
    // state-label exclusion is the only thing that can keep this quiet. That
    // is what makes the test able to fail.
    const nodes = [
      node('c1', { status: 'idle' }),
      node('c2', { status: 'down' }),
      node('c3', { status: 'idle' }),
    ];
    const source = { kind: 'capture', pattern: '^(zzz)' } as const;
    expect(suggestLabel({ nodes, source, placed: 0, ...args })).toBeUndefined();
  });

  it('never nominates an identity in disguise', () => {
    const nodes = [node('c1', { serial: 'a' }), node('c2', { serial: 'b' })];
    const source = { kind: 'capture', pattern: '^(zzz)' } as const;
    expect(suggestLabel({ nodes, source, placed: 0, ...args })).toBeUndefined();
  });

  it('never nominates a sparse identity: one value per node it reaches', () => {
    // slurm_exporter's `reason` label lands only on drained nodes, so a
    // distinct count measured against the whole model never fires. The
    // comparison has to be against the nodes the label actually reaches.
    const nodes = [
      node('c1', { reason: 'disk' }),
      node('c2', { reason: 'memory' }),
      node('c3', {}),
      node('c4', {}),
      node('c5', {}),
    ];
    const source = { kind: 'capture', pattern: '^(zzz)' } as const;
    expect(suggestLabel({ nodes, source, placed: 0, ...args })).toBeUndefined();
  });

  it('never nominates a label with one value, which would group everything into one', () => {
    // It would cover every node and so win the comparison every time, while
    // being useless advice.
    const nodes = [node('c1', { cluster: 'prod' }), node('c2', { cluster: 'prod' })];
    const source = { kind: 'capture', pattern: '^(zzz)' } as const;
    expect(suggestLabel({ nodes, source, placed: 0, ...args })).toBeUndefined();
  });

  it('says nothing when there are no nodes', () => {
    const source = { kind: 'capture', pattern: '^(c)' } as const;
    expect(suggestLabel({ nodes: [], source, placed: 0, ...args })).toBeUndefined();
  });

  it('reads the count of what the active source placed off the built model, not off a re-run key function', () => {
    // buildGroups does not place every node through the key function: the
    // multi-value partition fan-out places nodes straight from
    // node.partitions, so a partition label never appears in node.labels at
    // all. Re-deriving coverage with makeKeyFn over `label: partition` would
    // find nothing placed and recommend a label the panel had already drawn
    // every node under — this is that exact model, built for real through
    // buildGroups, not asserted by hand.
    const nodes = [
      node('c1', { rack: 'r1' }, ['cpu', 'debug']),
      node('c2', { rack: 'r1' }, ['cpu', 'debug']),
      node('c3', { rack: 'r2' }, ['cpu', 'debug']),
      node('c4', { rack: 'r2' }, ['cpu', 'debug']),
      node('c5', { rack: 'r3' }, ['cpu', 'debug']),
      node('c6', { rack: 'r3' }, ['cpu', 'debug']),
    ];
    const source = { kind: 'label', label: 'partition' } as const;
    const model = buildGroups(nodes, source, { multiValueLabel: true });
    const orphans = model.groups.find((g) => g.key === UNGROUPED)?.nodes.length ?? 0;

    // Sanity check on the fixture itself: the fan-out placed every node, none
    // fell through to `ungrouped`.
    expect(orphans).toBe(0);

    const result = suggestLabel({ nodes, source, placed: model.nodeCount - orphans, ...args });
    expect(result).toBeUndefined();
  });
});
