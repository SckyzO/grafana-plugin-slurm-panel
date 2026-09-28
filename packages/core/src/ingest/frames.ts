import { toSamples } from './labels.js';
import type {
  GresEntry, IngestInput, IngestResult, IngestWarning, MinimalFrame, NodeFacets, Sample, SlurmNode,
} from '../model/types.js';

type ScalarFacet = 'cpuAlloc' | 'cpuTotal' | 'memAlloc' | 'memTotal' | 'drainSince';
const SCALAR_FACETS: ScalarFacet[] = ['cpuAlloc', 'cpuTotal', 'memAlloc', 'memTotal', 'drainSince'];

const framesFor = (frames: MinimalFrame[], refId: string | undefined): MinimalFrame[] =>
  refId === undefined ? [] : frames.filter((f) => f.refId === refId);

/**
 * Whether a frame holds any data at all. An empty Prometheus result still
 * comes back as a frame carrying its refId, with no field in it, and a quiet
 * facet looks exactly like that: a drain-reason query on a cluster with
 * nothing drained. That is an answer, not a query that lost its identity.
 */
const carriesData = (frame: MinimalFrame): boolean =>
  frame.fields.some((f) => f.type !== 'time' && f.name !== 'Time' && f.name !== 'time' && f.values.length > 0);

const toNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const emptyFacets = (): NodeFacets => ({ gres: [] });

// `IngestWarning.refId` is optional, and under exactOptionalPropertyTypes an
// optional property may not be explicitly set to `undefined`; it must be
// present with a real value or left out entirely. `frame.refId` and
// `queries[facet]` are both `string | undefined`, so build the warning through
// this helper instead of assigning the raw value into the object literal.
const warn = (kind: IngestWarning['kind'], refId: string | undefined, detail: string): IngestWarning =>
  refId === undefined ? { kind, detail } : { kind, refId, detail };

export function ingest({ frames, queries, labels }: IngestInput): IngestResult {
  const warnings: IngestWarning[] = [];
  const nodes = new Map<string, SlurmNode>();
  // Per-node set of label keys seen with more than one differing value;
  // see the comment where this is populated, below.
  const ambiguousLabelKeys = new Map<string, Set<string>>();

  // Which frames of each bound query held data, and which of those carried no
  // node identity. Kept per refId rather than per role, because one query can
  // serve two roles, and reported once per query at the end rather than once
  // per frame: a time-series query returns a frame per series, and a line per
  // frame repeats one sentence down the strip.
  const identity = new Map<string, { frames: Set<MinimalFrame>; blind: Set<MinimalFrame> }>();
  // Every state each node was reported under; settled after the state loop.
  const statesOf = new Map<string, Set<string>>();
  const noteIdentity = (frame: MinimalFrame, identified: number): void => {
    if (frame.refId === undefined || !carriesData(frame)) {
      return;
    }
    const entry = identity.get(frame.refId) ?? { frames: new Set<MinimalFrame>(), blind: new Set<MinimalFrame>() };
    entry.frames.add(frame);
    if (identified === 0) {
      entry.blind.add(frame);
    }
    identity.set(frame.refId, entry);
  };
  // Values that are numbers but not finite — a NaN from a division by zero in
  // the query, an Inf — per query and facet. Dropped like a missing label
  // before, so the cell just showed no data. Reported at the end, once the
  // nodes the grid draws are known. A null is left alone: it is a gap in a
  // series, not a value.
  const nonFinite = new Map<string, { refId: string; facet: string; names: Set<string> }>();
  const noteValue = (refId: string | undefined, facet: string, name: string | undefined, value: unknown): void => {
    if (refId === undefined || name === undefined || typeof value !== 'number' || Number.isFinite(value)) {
      return;
    }
    const key = `${refId}\u0000${facet}`;
    const entry = nonFinite.get(key) ?? { refId, facet, names: new Set<string>() };
    entry.names.add(name);
    nonFinite.set(key, entry);
  };
  const identifiedIn = (samples: Sample[]): number => samples.filter((s) => s.labels[labels.node] !== undefined).length;

  // --- identity and state -------------------------------------------------
  for (const frame of framesFor(frames, queries.state)) {
    // Narrow to `{ sample, name: string }` here, in the same step that
    // filters, so a later edit to the filter can't silently invalidate a
    // separate `!` at the point of use, since the compiler ties them together.
    const identified = toSamples(frame).flatMap((sample) => {
      const name = sample.labels[labels.node];
      return typeof name === 'string' ? [{ sample, name }] : [];
    });

    noteIdentity(frame, identified.length);
    if (identified.length === 0) {
      continue;
    }

    for (const { sample, name } of identified) {
      let node = nodes.get(name);
      const state = sample.labels[labels.state];
      if (state !== undefined) {
        const seen = statesOf.get(name) ?? new Set<string>();
        seen.add(state);
        statesOf.set(name, seen);
      }
      if (!node) {
        node = {
          name,
          // Settled once every series is read, below: which series comes
          // first is Prometheus's order, not the node's.
          state: '',
          partitions: [],
          // No prototype: the loop below asks `node.labels[key] === undefined`
          // to mean "not seen yet", and on a plain object literal a label
          // legally named `constructor` or `toString` answers with an
          // inherited member instead. The key was then treated as a
          // disagreement and dropped for good — four legal Prometheus label
          // names lost in silence, and a grouping keyed on one of them drew a
          // function where the group name goes.
          labels: Object.create(null) as Record<string, string>,
          facets: emptyFacets(),
        };
        nodes.set(name, node);
      }
      // Several series per node is the normal case, not an error: one per
      // (node, partition) pair. Collapse them, and keep every partition.
      const partition = sample.labels[labels.partition];
      if (partition !== undefined && !node.partitions.includes(partition)) {
        node.partitions.push(partition);
      }
      // A label like `partition` genuinely differs across this node's
      // samples; keeping whichever sample happened to be seen first would
      // make `labels` depend on input order, which is exactly what
      // `partitions` above already models properly. Keep a key only while
      // every sample seen so far agrees on it, and once two disagree, drop
      // it for good rather than let the next sample silently reinstate it.
      const ambiguous = ambiguousLabelKeys.get(name) ?? new Set<string>();
      ambiguousLabelKeys.set(name, ambiguous);
      for (const [key, value] of Object.entries(sample.labels)) {
        if (key === '__name__' || ambiguous.has(key)) {
          continue;
        }
        const existing = node.labels[key];
        if (existing === undefined) {
          node.labels[key] = value;
        } else if (existing !== value) {
          delete node.labels[key];
          ambiguous.add(key);
        }
      }
    }
  }

  for (const node of nodes.values()) {
    node.partitions.sort();
  }

  // One state per node, or none. A state query over a range, or two
  // exporters caught mid-change, returns a node under two states, and
  // keeping either would be keeping a colour nobody can justify.
  const splitStates: string[] = [];
  for (const [name, states] of statesOf) {
    const node = nodes.get(name);
    if (node === undefined) {
      continue;
    }
    if (states.size === 1) {
      node.state = [...states][0] ?? '';
    } else {
      splitStates.push(name);
    }
  }
  if (splitStates.length > 0) {
    warnings.push({
      ...warn('ambiguous-state', queries.state, 'returned more than one state'),
      nodes: splitStates.sort((a, b) => a.localeCompare(b)),
    });
  }

  // --- scalar facets ------------------------------------------------------
  for (const facet of SCALAR_FACETS) {
    const refId = queries[facet];
    const seen = new Map<string, Set<number>>();

    for (const frame of framesFor(frames, refId)) {
      const samples = toSamples(frame);
      noteIdentity(frame, identifiedIn(samples));
      for (const sample of samples) {
        const name = sample.labels[labels.node];
        noteValue(refId, facet, name, sample.value);
        const value = toNumber(sample.value);
        if (name === undefined || value === undefined) {
          continue;
        }
        const bucket = seen.get(name) ?? new Set<number>();
        bucket.add(value);
        seen.set(name, bucket);
      }
    }

    for (const [name, values] of seen) {
      const node = nodes.get(name);
      if (!node) {
        continue;
      }
      if (values.size > 1) {
        // Keeping an arbitrary row here is how a panel reports a number
        // nobody can reproduce. Say so instead.
        warnings.push(warn('ambiguous-scalar', refId, `${name} returned ${values.size} differing values for ${facet}`));
        continue;
      }
      // Under noUncheckedIndexedAccess, `[...values][0]` is `number | undefined`;
      // under exactOptionalPropertyTypes, assigning an explicit `undefined` to
      // `facets[facet]?: number` is a type error. Narrow with a guard instead of
      // asserting it away: size is always exactly 1 here, but TS can't see that.
      const value = [...values][0];
      if (value !== undefined) {
        node.facets[facet] = value;
      }
    }
  }

  // --- gres, keyed per model ----------------------------------------------
  const applyGres = (refId: string | undefined, key: 'used' | 'total'): void => {
    for (const frame of framesFor(frames, refId)) {
      const samples = toSamples(frame);
      noteIdentity(frame, identifiedIn(samples));
      for (const sample of samples) {
        const name = sample.labels[labels.node];
        const type = sample.labels[labels.gresType];
        noteValue(refId, key === 'used' ? 'gresUsed' : 'gresTotal', name, sample.value);
        const value = toNumber(sample.value);
        if (name === undefined || type === undefined || value === undefined) {
          continue;
        }
        const node = nodes.get(name);
        if (!node) {
          continue;
        }
        let entry: GresEntry | undefined = node.facets.gres.find((g) => g.type === type);
        if (!entry) {
          entry = { type };
          node.facets.gres.push(entry);
        }
        entry[key] = value;
      }
    }
  };
  applyGres(queries.gresUsed, 'used');
  applyGres(queries.gresTotal, 'total');
  for (const node of nodes.values()) {
    node.facets.gres.sort((a, b) => a.type.localeCompare(b.type));
  }

  // --- drain reason, which carries no partition label ---------------------
  for (const frame of framesFor(frames, queries.drainReason)) {
    const samples = toSamples(frame);
    noteIdentity(frame, identifiedIn(samples));
    for (const sample of samples) {
      const name = sample.labels[labels.node];
      const reason = sample.labels[labels.reason];
      if (name === undefined || reason === undefined) {
        continue;
      }
      const node = nodes.get(name);
      if (node) {
        node.facets.drainReason = reason;
      }
    }
  }

  // First in the list: a query that lost its identity explains the other
  // lines, and often an empty grid, better than anything after it.
  const identityWarnings: IngestWarning[] = [];
  for (const [refId, { frames: held, blind }] of identity) {
    if (blind.size === 0) {
      continue;
    }
    const warning = warn('no-identity', refId, 'no node label or column');
    identityWarnings.push(
      blind.size === held.size ? warning : { ...warning, skippedSeries: blind.size, totalSeries: held.size }
    );
  }

  // Only nodes the grid draws: a sample naming a node the state query never
  // returned has no cell for the line to explain.
  const nonFiniteWarnings: IngestWarning[] = [];
  for (const { refId, facet, names } of nonFinite.values()) {
    const drawn = [...names].filter((name) => nodes.has(name)).sort((a, b) => a.localeCompare(b));
    if (drawn.length > 0) {
      nonFiniteWarnings.push({ ...warn('non-finite', refId, `${facet} is not a finite number`), nodes: drawn });
    }
  }

  return {
    nodes: [...nodes.values()].sort((a, b) => a.name.localeCompare(b.name)),
    warnings: [...identityWarnings, ...warnings, ...nonFiniteWarnings],
  };
}
