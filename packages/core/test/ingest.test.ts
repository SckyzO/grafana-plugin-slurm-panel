import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ingest } from '../src/ingest/frames.js';
import { toSamples } from '../src/ingest/labels.js';
import type { LabelNames, MinimalFrame, QueryBindings } from '../src/model/types.js';

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
const QUERIES: QueryBindings = { state: 'A' };

describe.each([
  ['numeric-multi', 'node-status.numeric-multi.json'],
  ['table', 'node-status.table.json'],
])('ingest reads the %s frame shape', (_shape, file) => {
  const result = () => ingest({ frames: load(file), queries: QUERIES, labels: LABELS });

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

  it('keeps a label every series of a node agrees on, and drops one they do not', () => {
    // What a grouping by label reads. c1's three series agree on `status` and
    // differ on `partition`: the first has to survive the merge, the second
    // cannot, since no single value of it is true of the node.
    const c1 = result().nodes.find((n) => n.name === 'c1');
    expect(c1?.labels['status']).toBe('mixed-');
    expect(c1?.labels['partition']).toBeUndefined();
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
    const { nodes, warnings } = ingest({ frames, queries: QUERIES, labels: LABELS });
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

    const forward = ingest({ frames: forwardFrames, queries: QUERIES, labels: LABELS });
    const reversed = ingest({ frames: reversedFrames, queries: QUERIES, labels: LABELS });

    // ingest() sorts its output by node name unconditionally, so comparing
    // only the name lists would pass even if the internal collapsing were
    // order-sensitive — the final sort would hide exactly the bug this test
    // is named after. Compare the whole result structure instead.
    expect(reversed.nodes).toEqual(forward.nodes);
    expect(reversed.warnings).toEqual(forward.warnings);
    expect(reversed.nodes.find((n) => n.name === 'c1')?.partitions).toEqual(['cpu', 'debug', 'high']);
  });
});

describe('ingest names a query that carries no node identity', () => {
  // Every bound query, not only the state query, and once per query rather
  // than once per frame: a time-series query returns one frame per series,
  // and a line per frame repeated one sentence down the strip.
  const stateFrames = load('node-status.numeric-multi.json');
  const blind = (refId: string, name = 'Value'): MinimalFrame => ({
    refId,
    fields: [
      { name: 'Time', type: 'time', values: [1] },
      { name, type: 'number', labels: { instance: 'exporter:9341' }, values: [1] },
    ],
  });
  const NO_IDENTITY = { kind: 'no-identity', detail: 'no node label or column' };

  it('names a facet query once, however many series it returned', () => {
    const { warnings } = ingest({
      frames: [...stateFrames, blind('B'), blind('B'), blind('B')],
      queries: { state: 'A', cpuAlloc: 'B' },
      labels: LABELS,
    });
    expect(warnings).toEqual([{ ...NO_IDENTITY, refId: 'B' }]);
  });

  it.each(['cpuTotal', 'memAlloc', 'memTotal', 'gresUsed', 'gresTotal', 'drainReason', 'drainSince'])(
    'covers the %s query too',
    (role) => {
      const { warnings } = ingest({
        frames: [...stateFrames, blind('Z')],
        queries: { state: 'A', [role]: 'Z' },
        labels: LABELS,
      });
      expect(warnings).toEqual([{ ...NO_IDENTITY, refId: 'Z' }]);
    }
  );

  it('names a query aggregated down to no label at all', () => {
    // `sum(slurm_node_cpu_alloc)`: one number for the whole cluster, which no
    // node can claim.
    const sum: MinimalFrame = {
      refId: 'B',
      fields: [
        { name: 'Time', type: 'time', values: [1] },
        { name: 'Value', type: 'number', values: [540] },
      ],
    };
    const { warnings } = ingest({ frames: [...stateFrames, sum], queries: { state: 'A', cpuAlloc: 'B' }, labels: LABELS });
    expect(warnings).toEqual([{ ...NO_IDENTITY, refId: 'B' }]);
  });

  it('names a query once when two roles share it', () => {
    const { warnings } = ingest({
      frames: [...stateFrames, blind('B')],
      queries: { state: 'A', cpuAlloc: 'B', cpuTotal: 'B' },
      labels: LABELS,
    });
    expect(warnings).toEqual([{ ...NO_IDENTITY, refId: 'B' }]);
  });

  it('says nothing about an empty result, which is what a quiet facet looks like', () => {
    // No node drained, so no drain reason: Prometheus answers with one frame
    // carrying the refId and no field at all. That is data, not a fault.
    const { warnings } = ingest({
      frames: [...stateFrames, { refId: 'B', fields: [] }],
      queries: { state: 'A', drainReason: 'B' },
      labels: LABELS,
    });
    expect(warnings).toEqual([]);
  });

  it('counts the series skipped when only some of them carry identity', () => {
    const { nodes, warnings } = ingest({ frames: [...stateFrames, blind('A')], queries: QUERIES, labels: LABELS });
    expect(nodes.length).toBeGreaterThan(0);
    expect(warnings).toEqual([
      { ...NO_IDENTITY, refId: 'A', skippedSeries: 1, totalSeries: stateFrames.length + 1 },
    ]);
  });

  it('stays quiet about a facet query whose series all carry identity', () => {
    const cpu: MinimalFrame = {
      refId: 'B',
      fields: [
        { name: 'Time', type: 'time', values: [1] },
        { name: 'Value', type: 'number', labels: { node: 'c1' }, values: [4] },
      ],
    };
    const { warnings } = ingest({ frames: [...stateFrames, cpu], queries: { state: 'A', cpuAlloc: 'B' }, labels: LABELS });
    expect(warnings).toEqual([]);
  });
});

describe('ingest refuses to pick between two states for one node', () => {
  // A state query over a range, or two exporters mid-change, returns a node
  // under two states: one series per distinct label set. The first one read
  // used to win, so Prometheus's series order chose the colour. The instant
  // query the panel ships with cannot produce this.
  const series = (node: string, status: string | undefined, partition: string): MinimalFrame => ({
    refId: 'A',
    fields: [
      { name: 'Time', type: 'time', values: [1] },
      {
        name: 'Value',
        type: 'number',
        labels: { node, partition, ...(status === undefined ? {} : { status }) },
        values: [1],
      },
    ],
  });

  it('leaves the state blank and names the node, whichever series comes first', () => {
    const forward = [series('c1', 'idle', 'cpu'), series('c1', 'mixed', 'debug'), series('c2', 'idle', 'cpu')];
    for (const frames of [forward, [...forward].reverse()]) {
      const { nodes, warnings } = ingest({ frames, queries: QUERIES, labels: LABELS });
      expect(Object.fromEntries(nodes.map((n) => [n.name, n.state]))).toEqual({ c1: '', c2: 'idle' });
      expect(warnings).toEqual([
        { kind: 'ambiguous-state', refId: 'A', detail: 'returned more than one state', nodes: ['c1'] },
      ]);
    }
  });

  it('takes the one state there is when another series carries none', () => {
    // First read used to win here too: a series without the label, seen
    // first, left the node blank however many series named its state.
    const frames = [series('c1', undefined, 'cpu'), series('c1', 'idle', 'debug')];
    const { nodes, warnings } = ingest({ frames, queries: QUERIES, labels: LABELS });
    expect(nodes[0]?.state).toBe('idle');
    expect(warnings).toEqual([]);
  });
});

describe('ingest names a facet value that is not a finite number', () => {
  // A NaN from a division by zero in the query, or an Inf, used to be
  // dropped in the same `continue` as a missing label, so the cell simply
  // showed no data. Named once per query and facet, and only for nodes the
  // grid draws: a sample naming a node the state query never returned has
  // no cell to explain.
  const stateFrames = load('node-status.numeric-multi.json');
  const valued = (refId: string, node: string, value: unknown, extra: Record<string, string> = {}): MinimalFrame => ({
    refId,
    fields: [
      { name: 'Time', type: 'time', values: [1] },
      { name: 'Value', type: 'number', labels: { node, ...extra }, values: [value] },
    ],
  });

  it('names the nodes once per query and facet', () => {
    const { warnings } = ingest({
      frames: [...stateFrames, valued('B', 'c1', Number.NaN), valued('B', 'c9', Number.POSITIVE_INFINITY), valued('B', 'c10', 4)],
      queries: { state: 'A', cpuAlloc: 'B' },
      labels: LABELS,
    });
    expect(warnings).toEqual([
      { kind: 'non-finite', refId: 'B', detail: 'cpuAlloc is not a finite number', nodes: ['c1', 'c9'] },
    ]);
  });

  it('covers the GPU queries, which are keyed per model', () => {
    const { warnings } = ingest({
      frames: [...stateFrames, valued('G', 'g1', Number.NaN, { gres_type: 'gpu:a100' })],
      queries: { state: 'A', gresUsed: 'G' },
      labels: LABELS,
    });
    expect(warnings).toEqual([
      { kind: 'non-finite', refId: 'G', detail: 'gresUsed is not a finite number', nodes: ['g1'] },
    ]);
  });

  it('leaves out a node the grid does not draw', () => {
    const { warnings } = ingest({
      frames: [...stateFrames, valued('B', 'zz9', Number.NaN)],
      queries: { state: 'A', cpuAlloc: 'B' },
      labels: LABELS,
    });
    expect(warnings).toEqual([]);
  });

  it('says nothing about a missing point, which is a gap and not a value', () => {
    const { warnings } = ingest({
      frames: [...stateFrames, valued('B', 'c1', null)],
      queries: { state: 'A', cpuAlloc: 'B' },
      labels: LABELS,
    });
    expect(warnings).toEqual([]);
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
      queries: { state: 'A', drainReason: 'B' },
      labels: LABELS,
    });
    expect(nodes.find((n) => n.name === 'c9')?.facets.drainReason).toBe('GPU fell off the bus - RMA pending');
    expect(nodes.find((n) => n.name === 'c1')?.facets.drainReason).toBeUndefined();
  });

  it('fans a GRES facet out per model rather than keeping one', () => {
    const { nodes } = ingest({
      frames: [...stateFrames, ...gresFrames],
      queries: { state: 'A', gresUsed: 'C' },
      labels: LABELS,
    });
    expect(nodes.find((n) => n.name === 'g1')?.facets.gres).toEqual([
      { type: 'gpu:model_a', used: 2 },
      { type: 'gpu:model_b', used: 1 },
    ]);
  });

  it('refuses to pick between two GPU values for one node and model', () => {
    // The scalar facets already refuse; the GPU loop kept whichever row it
    // read last. Two series for the same node and model disagreeing — a range
    // query whose value moved — is the same fact and gets the same answer.
    const twice: MinimalFrame[] = ['2', '5'].map((v) => ({
      refId: 'G',
      fields: [
        { name: 'Time', type: 'time', values: [1] },
        { name: 'Value', type: 'number', labels: { node: 'g1', gres_type: 'gpu:a100' }, values: [Number(v)] },
      ],
    }));
    const { nodes, warnings } = ingest({
      frames: [...stateFrames, ...twice],
      queries: { state: 'A', gresUsed: 'G' },
      labels: LABELS,
    });
    expect(warnings).toContainEqual({
      kind: 'ambiguous-scalar', refId: 'G', detail: 'g1 returned 2 differing values for gresUsed gpu:a100',
    });
    expect(nodes.find((n) => n.name === 'g1')?.facets.gres.find((g) => g.type === 'gpu:a100')?.used).toBeUndefined();
  });

  it('keeps a GPU value that repeats unchanged', () => {
    const same: MinimalFrame[] = [1, 2].map((t) => ({
      refId: 'G',
      fields: [
        { name: 'Time', type: 'time', values: [t] },
        { name: 'Value', type: 'number', labels: { node: 'g1', gres_type: 'gpu:a100' }, values: [3] },
      ],
    }));
    const { nodes, warnings } = ingest({
      frames: [...stateFrames, ...same],
      queries: { state: 'A', gresUsed: 'G' },
      labels: LABELS,
    });
    expect(warnings).toEqual([]);
    expect(nodes.find((n) => n.name === 'g1')?.facets.gres).toEqual([{ type: 'gpu:a100', used: 3 }]);
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
      queries: { state: 'A', cpuAlloc: 'D' },
      labels: LABELS,
    });
    expect(warnings).toContainEqual({
      kind: 'ambiguous-scalar', refId: 'D', detail: 'c1 returned 2 differing values for cpuAlloc',
    });
  });
});

describe('labels inherited from Object.prototype', () => {
  // Prometheus label names are [a-zA-Z_][a-zA-Z0-9_]*, which admits
  // `constructor`, `toString`, `valueOf` and `hasOwnProperty`. Read off a
  // plain object literal those are not `undefined` — they are the inherited
  // members — so the "two samples disagree" branch fires on the first sample
  // and drops the key for good. Four legal labels vanish, silently, and a
  // grouping keyed on one of them puts a function where a group name goes:
  // `data-testid="node-group-function Object() { [native code] }"`.
  //
  // Verified in the audit that this is NOT prototype pollution: assigning a
  // string to `__proto__` is inert, and Object.prototype was untouched. It is
  // a typing unsoundness — TypeScript promises `string | undefined` under
  // noUncheckedIndexedAccess and the runtime can hand back a Function.
  const INHERITED = ['constructor', 'toString', 'valueOf', 'hasOwnProperty'];

  const frames = (): MinimalFrame[] => [
    {
      refId: 'A',
      fields: [
        {
          name: 'Value',
          type: 'number',
          labels: {
            node: 'c1',
            status: 'idle',
            rack: 'r1',
            ...Object.fromEntries(INHERITED.map((k) => [k, `v-${k}`])),
          },
          values: [1],
        },
      ],
    },
  ];

  it('keeps a label whose name collides with an inherited member', () => {
    const node = ingest({ frames: frames(), queries: QUERIES, labels: LABELS }).nodes[0];
    expect(node).toBeDefined();
    for (const key of INHERITED) {
      expect(node?.labels[key]).toBe(`v-${key}`);
    }
  });

  it('hands back strings, not functions, for those names', () => {
    const node = ingest({ frames: frames(), queries: QUERIES, labels: LABELS }).nodes[0];
    for (const key of INHERITED) {
      expect(typeof node?.labels[key]).toBe('string');
    }
  });

  // The half of the fix that lives in toSamples: the dictionaries it hands
  // back answer only for labels the data sent, in both frame shapes. The
  // tests above read node.labels, a dictionary ingest builds for itself, so
  // they pass whatever toSamples returns.
  it.each<[string, MinimalFrame]>([
    ['series', { refId: 'A', fields: [{ name: 'Value', type: 'number', labels: { node: 'c1' }, values: [1] }] }],
    [
      'table',
      {
        refId: 'A',
        fields: [
          { name: 'node', type: 'string', values: ['c1'] },
          { name: 'Value', type: 'number', values: [1] },
        ],
      },
    ],
  ])('answers nothing for a label a %s frame did not send', (_shape, frame) => {
    const labels = toSamples(frame)[0]?.labels;
    expect(labels?.['node']).toBe('c1');
    for (const key of INHERITED) {
      expect(labels?.[key]).toBeUndefined();
    }
  });

  it('still drops a label two samples disagree on', () => {
    // The guard must not cost the behaviour it sits next to: `rack` differing
    // between two series of one node is genuinely ambiguous and still goes.
    const two: MinimalFrame[] = [
      { refId: 'A', fields: [{ name: 'Value', type: 'number', labels: { node: 'c1', status: 'idle', rack: 'r1' }, values: [1] }] },
      { refId: 'A', fields: [{ name: 'Value', type: 'number', labels: { node: 'c1', status: 'idle', rack: 'r2' }, values: [1] }] },
    ];
    const node = ingest({ frames: two, queries: QUERIES, labels: LABELS }).nodes[0];
    expect(node?.labels['rack']).toBeUndefined();
  });
});
