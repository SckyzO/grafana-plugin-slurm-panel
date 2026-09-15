import { suggestLabel } from '../src/group/coverage.js';
import type { SlurmNode } from '../src/model/types.js';

const node = (name: string, labels: Record<string, string>): SlurmNode => ({
  name, state: 'idle', partitions: [], labels, facets: { gres: [] },
});

const withRack = [
  node('c1', { rack: 'r1', node: 'c1', status: 'idle' }),
  node('c2', { rack: 'r1', node: 'c2', status: 'idle' }),
  node('c3', { rack: 'r2', node: 'c3', status: 'idle' }),
];

const args = { nodeLabel: 'node', stateLabel: 'status' };

describe('suggestLabel', () => {
  it('says nothing when grouping is switched off, which is a choice', () => {
    expect(suggestLabel({ nodes: withRack, source: { kind: 'none' }, ...args })).toBeUndefined();
  });

  it('says nothing when the active source already covers as much', () => {
    const source = { kind: 'label', label: 'rack' } as const;
    expect(suggestLabel({ nodes: withRack, source, ...args })).toBeUndefined();
  });

  it('names a label that would cover more than the active source does', () => {
    const source = { kind: 'capture', pattern: '^(zzz)' } as const;
    expect(suggestLabel({ nodes: withRack, source, ...args }))
      .toEqual({ label: 'rack', covered: 3, total: 3 });
  });

  it('never nominates the node label, which is one group per node', () => {
    // The identity guard would catch this too, since a node label has one
    // value per node by definition. The explicit exclusion is kept because it
    // states the intent and skips the counting; this test pins the outcome,
    // not which of the two guards produced it.
    const nodes = [node('c1', { node: 'c1' }), node('c2', { node: 'c2' })];
    const source = { kind: 'capture', pattern: '^(zzz)' } as const;
    expect(suggestLabel({ nodes, source, ...args })).toBeUndefined();
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
    expect(suggestLabel({ nodes, source, ...args })).toBeUndefined();
  });

  it('never nominates an identity in disguise', () => {
    const nodes = [node('c1', { serial: 'a' }), node('c2', { serial: 'b' })];
    const source = { kind: 'capture', pattern: '^(zzz)' } as const;
    expect(suggestLabel({ nodes, source, ...args })).toBeUndefined();
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
    expect(suggestLabel({ nodes, source, ...args })).toBeUndefined();
  });

  it('never nominates a label with one value, which would group everything into one', () => {
    // It would cover every node and so win the comparison every time, while
    // being useless advice.
    const nodes = [node('c1', { cluster: 'prod' }), node('c2', { cluster: 'prod' })];
    const source = { kind: 'capture', pattern: '^(zzz)' } as const;
    expect(suggestLabel({ nodes, source, ...args })).toBeUndefined();
  });

  it('says nothing when there are no nodes', () => {
    const source = { kind: 'capture', pattern: '^(c)' } as const;
    expect(suggestLabel({ nodes: [], source, ...args })).toBeUndefined();
  });
});
