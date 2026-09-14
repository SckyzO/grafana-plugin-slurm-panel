import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ingest } from '../src/ingest/frames.js';
import type { LabelNames, MinimalFrame, SlotBindings } from '../src/model/types.js';

const load = (name: string): MinimalFrame[] => {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Array<{
    schema: { refId?: string; fields: Array<{ name: string; type?: string; labels?: Record<string, string> }> };
    data: { values: unknown[][] };
  }>;
  // f.schema.refId is `string | undefined`; MinimalFrame.refId is optional
  // and, under exactOptionalPropertyTypes, may not be explicitly assigned
  // `undefined` — spread it in only when present rather than always setting it.
  return raw.map((f) => ({
    ...(f.schema.refId !== undefined ? { refId: f.schema.refId } : {}),
    fields: f.schema.fields.map((fld, i) => ({ ...fld, values: f.data.values[i] ?? [] })),
  }));
};

const LABELS: LabelNames = { node: 'node', state: 'status', partition: 'partition', gresType: 'gres_type', reason: 'reason' };
const SLOTS: SlotBindings = { state: 'A' };

describe.each([
  ['numeric-multi', 'node-status.numeric-multi.json'],
  ['table', 'node-status.table.json'],
])('ingest reads the %s frame shape', (_shape, file) => {
  const result = () => ingest({ frames: load(file), slots: SLOTS, labels: LABELS });

  it('collapses the series of one node into a single node', () => {
    const { nodes } = result();
    expect(nodes).toHaveLength(4);
    expect(nodes.map((n) => n.name).sort()).toEqual(['c1', 'c10', 'c9', 'g1']);
  });

  it('collects every partition a node belongs to', () => {
    expect(result().nodes.find((n) => n.name === 'c1')?.partitions).toEqual(['cpu', 'debug', 'high']);
  });

  it('keeps the state label verbatim, suffix and all', () => {
    const byName = Object.fromEntries(result().nodes.map((n) => [n.name, n.state]));
    expect(byName).toEqual({ c1: 'mixed-', c9: 'drained', c10: 'down', g1: 'idle' });
  });

  it('reports no warnings on well-formed input', () => {
    expect(result().warnings).toEqual([]);
  });
});

describe('ingest reports rather than guesses', () => {
  it('skips a frame carrying no identity, naming its refId', () => {
    const frames: MinimalFrame[] = [
      { refId: 'A', fields: [{ name: 'Time', type: 'time', values: [1] }, { name: 'Value', type: 'number', values: [1] }] },
    ];
    const { nodes, warnings } = ingest({ frames, slots: SLOTS, labels: LABELS });
    expect(nodes).toEqual([]);
    expect(warnings).toEqual([{ kind: 'no-identity', refId: 'A', detail: 'no node label or column' }]);
  });

  it('is stable when the rows come back in a different order', () => {
    const forwardFrames = load('node-status.numeric-multi.json');
    const reversedFrames = [...forwardFrames].reverse();
    // Guard against this test becoming a tautology: if `.reverse()` above
    // were ever dropped (a one-character-class edit someone could make
    // while debugging), forwardFrames and reversedFrames would be identical
    // and every assertion below would pass no matter what ingest() does.
    expect(reversedFrames).not.toEqual(forwardFrames);

    const forward = ingest({ frames: forwardFrames, slots: SLOTS, labels: LABELS });
    const reversed = ingest({ frames: reversedFrames, slots: SLOTS, labels: LABELS });

    // ingest() sorts its output by node name unconditionally, so comparing
    // only the name lists would pass even if the internal collapsing were
    // order-sensitive — the final sort would hide exactly the bug this test
    // is named after. Compare the whole result structure instead.
    expect(reversed.nodes).toEqual(forward.nodes);
    expect(reversed.warnings).toEqual(forward.warnings);
    expect(reversed.nodes.find((n) => n.name === 'c1')?.partitions).toEqual(['cpu', 'debug', 'high']);
  });
});

describe('ingest joins the facets that carry no partition label', () => {
  const stateFrames = load('node-status.numeric-multi.json');
  const drainFrame: MinimalFrame = {
    refId: 'B',
    fields: [
      { name: 'Time', type: 'time', values: [1789388276915] },
      { name: 'slurm_node_drain_reason_info', type: 'number',
        labels: { node: 'c9', reason: 'GPU fell off the bus - RMA pending' }, values: [1] },
    ],
  };
  const gresFrames: MinimalFrame[] = [
    { refId: 'C', fields: [
      { name: 'Time', type: 'time', values: [1789388276915] },
      { name: 'slurm_node_gres_used', type: 'number', labels: { node: 'g1', gres_type: 'gpu:model_a' }, values: [2] } ] },
    { refId: 'C', fields: [
      { name: 'Time', type: 'time', values: [1789388276915] },
      { name: 'slurm_node_gres_used', type: 'number', labels: { node: 'g1', gres_type: 'gpu:model_b' }, values: [1] } ] },
  ];

  it('attaches a drain reason to a node identified only by name', () => {
    const { nodes } = ingest({
      frames: [...stateFrames, drainFrame],
      slots: { state: 'A', drainReason: 'B' },
      labels: LABELS,
    });
    expect(nodes.find((n) => n.name === 'c9')?.facets.drainReason).toBe('GPU fell off the bus - RMA pending');
    expect(nodes.find((n) => n.name === 'c1')?.facets.drainReason).toBeUndefined();
  });

  it('fans a GRES facet out per model rather than keeping one', () => {
    const { nodes } = ingest({
      frames: [...stateFrames, ...gresFrames],
      slots: { state: 'A', gresUsed: 'C' },
      labels: LABELS,
    });
    expect(nodes.find((n) => n.name === 'g1')?.facets.gres).toEqual([
      { type: 'gpu:model_a', used: 2 },
      { type: 'gpu:model_b', used: 1 },
    ]);
  });

  it('reports an ambiguous scalar instead of keeping an arbitrary row', () => {
    const twice: MinimalFrame[] = [
      { refId: 'D', fields: [
        { name: 'Time', type: 'time', values: [1] },
        { name: 'slurm_node_cpu_alloc', type: 'number', labels: { node: 'c1', partition: 'cpu' }, values: [4] } ] },
      { refId: 'D', fields: [
        { name: 'Time', type: 'time', values: [1] },
        { name: 'slurm_node_cpu_alloc', type: 'number', labels: { node: 'c1', partition: 'debug' }, values: [9] } ] },
    ];
    const { warnings } = ingest({
      frames: [...stateFrames, ...twice],
      slots: { state: 'A', cpuAlloc: 'D' },
      labels: LABELS,
    });
    expect(warnings).toContainEqual({
      kind: 'ambiguous-scalar', refId: 'D', detail: 'c1 returned 2 differing values for cpuAlloc',
    });
  });
});
