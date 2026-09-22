import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ingest } from '../src/ingest/frames.js';
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

describe('a query binding that matches nothing the dashboard returned', () => {
  // Invisible before: the filter yields no frames, so every loop body is
  // skipped — including the no-identity push, which lives inside the loop.
  // The panel then said "No nodes. Check that the state query returns a node
  // label" about a query that was returning one, under a different letter.
  const frameB = (): MinimalFrame[] => [
    {
      refId: 'B',
      fields: [{ name: 'Value', type: 'number', labels: { node: 'c1', status: 'idle' }, values: [1] }],
    },
  ];

  it('names the refId that is missing, and the ones that are there', () => {
    const { warnings } = ingest({ frames: frameB(), queries: { state: 'A' }, labels: LABELS });
    const kinds = warnings.filter((w) => w.kind === 'no-such-query');
    expect(kinds).toHaveLength(1);
    expect(kinds[0]?.detail).toContain('no query "A" for state');
    expect(kinds[0]?.detail).toContain('the dashboard returned B');
  });

  it('names a facet binding too, which has no editor field to check it against', () => {
    const { warnings } = ingest({
      frames: frameB(),
      queries: { state: 'B', cpuAlloc: 'C' },
      labels: LABELS,
    });
    const missing = warnings.filter((w) => w.kind === 'no-such-query');
    expect(missing).toHaveLength(1);
    expect(missing[0]?.detail).toContain('no query "C" for cpuAlloc');
  });

  it('says nothing when every binding resolves', () => {
    const { warnings } = ingest({ frames: frameB(), queries: { state: 'B' }, labels: LABELS });
    expect(warnings.filter((w) => w.kind === 'no-such-query')).toEqual([]);
  });
});

describe('a facet query that carries no node identity', () => {
  // The state query has been reporting this since the beginning; the six
  // facet queries dropped every sample in silence, while the shipped README
  // promises the line without qualifying it to one query.
  const frames = (): MinimalFrame[] => [
    {
      refId: 'A',
      fields: [{ name: 'Value', type: 'number', labels: { node: 'c1', status: 'idle' }, values: [1] }],
    },
    {
      // `sum by (instance)` rather than `by (node)`: a real and common shape.
      refId: 'B',
      fields: [{ name: 'Value', type: 'number', labels: { instance: 'c1:9341' }, values: [8] }],
    },
  ];

  it('reports the facet query rather than dropping it', () => {
    const { warnings } = ingest({
      frames: frames(),
      queries: { state: 'A', cpuAlloc: 'B' },
      labels: LABELS,
    });
    const skipped = warnings.filter((w) => w.kind === 'no-identity');
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.refId).toBe('B');
  });

  it('still says nothing about a facet query that does carry identity', () => {
    const ok: MinimalFrame[] = [
      { refId: 'A', fields: [{ name: 'Value', type: 'number', labels: { node: 'c1', status: 'idle' }, values: [1] }] },
      { refId: 'B', fields: [{ name: 'Value', type: 'number', labels: { node: 'c1' }, values: [8] }] },
    ];
    const { nodes, warnings } = ingest({ frames: ok, queries: { state: 'A', cpuAlloc: 'B' }, labels: LABELS });
    expect(warnings.filter((w) => w.kind === 'no-identity')).toEqual([]);
    expect(nodes[0]?.facets.cpuAlloc).toBe(8);
  });
});

describe('a facet value that is not a finite number', () => {
  it('is reported rather than sharing one silent continue with a missing label', () => {
    // A Prometheus NaN: a stale marker, a topk that returned fewer series, a
    // division by zero in the query. Indistinguishable from a missing node
    // label before, because one guard covered both.
    const frames: MinimalFrame[] = [
      { refId: 'A', fields: [{ name: 'Value', type: 'number', labels: { node: 'c1', status: 'idle' }, values: [1] }] },
      { refId: 'B', fields: [{ name: 'Value', type: 'number', labels: { node: 'c1' }, values: [Number.NaN] }] },
    ];
    const { nodes, warnings } = ingest({ frames, queries: { state: 'A', cpuAlloc: 'B' }, labels: LABELS });
    expect(warnings.some((w) => w.detail.includes('not a finite number'))).toBe(true);
    // And the facet stays unset rather than taking a made-up number.
    expect(nodes[0]?.facets.cpuAlloc).toBeUndefined();
  });
});
