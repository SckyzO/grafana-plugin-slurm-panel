import { toSamples } from './labels.js';
import type {
  GresEntry, IngestInput, IngestResult, IngestWarning, MinimalFrame, NodeFacets, SlurmNode,
} from '../model/types.js';

type ScalarFacet = 'cpuAlloc' | 'cpuTotal' | 'memAlloc' | 'memTotal' | 'drainSince';
const SCALAR_FACETS: ScalarFacet[] = ['cpuAlloc', 'cpuTotal', 'memAlloc', 'memTotal', 'drainSince'];

const framesFor = (frames: MinimalFrame[], refId: string | undefined): MinimalFrame[] =>
  refId === undefined ? [] : frames.filter((f) => f.refId === refId);

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

  // --- identity and state -------------------------------------------------
  for (const frame of framesFor(frames, queries.state)) {
    // Narrow to `{ sample, name: string }` here, in the same step that
    // filters, so a later edit to the filter can't silently invalidate a
    // separate `!` at the point of use, since the compiler ties them together.
    const identified = toSamples(frame).flatMap((sample) => {
      const name = sample.labels[labels.node];
      return typeof name === 'string' ? [{ sample, name }] : [];
    });

    if (identified.length === 0) {
      warnings.push(warn('no-identity', frame.refId, 'no node label or column'));
      continue;
    }

    for (const { sample, name } of identified) {
      let node = nodes.get(name);
      if (!node) {
        node = {
          name,
          state: sample.labels[labels.state] ?? '',
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

  // --- scalar facets ------------------------------------------------------
  for (const facet of SCALAR_FACETS) {
    const refId = queries[facet];
    const seen = new Map<string, Set<number>>();

    for (const frame of framesFor(frames, refId)) {
      for (const sample of toSamples(frame)) {
        const name = sample.labels[labels.node];
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
      for (const sample of toSamples(frame)) {
        const name = sample.labels[labels.node];
        const type = sample.labels[labels.gresType];
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
    for (const sample of toSamples(frame)) {
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

  return { nodes: [...nodes.values()].sort((a, b) => a.name.localeCompare(b.name)), warnings };
}
