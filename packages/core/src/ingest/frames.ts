import { toSamples } from './labels.js';
import type {
  GresEntry, IngestInput, IngestResult, IngestWarning, MinimalFrame, NodeFacets, SlurmNode,
} from '../model/types.js';

type ScalarSlot = 'cpuAlloc' | 'cpuTotal' | 'memAlloc' | 'memTotal' | 'drainSince';
const SCALAR_SLOTS: ScalarSlot[] = ['cpuAlloc', 'cpuTotal', 'memAlloc', 'memTotal', 'drainSince'];

const framesFor = (frames: MinimalFrame[], refId: string | undefined): MinimalFrame[] =>
  refId === undefined ? [] : frames.filter((f) => f.refId === refId);

const toNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const emptyFacets = (): NodeFacets => ({ gres: [] });

// `IngestWarning.refId` is optional, and under exactOptionalPropertyTypes an
// optional property may not be explicitly set to `undefined` — it must be
// present with a real value or left out entirely. `frame.refId` and
// `slots[slot]` are both `string | undefined`, so build the warning through
// this helper instead of assigning the raw value into the object literal.
const warn = (kind: IngestWarning['kind'], refId: string | undefined, detail: string): IngestWarning =>
  refId === undefined ? { kind, detail } : { kind, refId, detail };

export function ingest({ frames, slots, labels }: IngestInput): IngestResult {
  const warnings: IngestWarning[] = [];
  const nodes = new Map<string, SlurmNode>();

  // --- identity and state -------------------------------------------------
  for (const frame of framesFor(frames, slots.state)) {
    const identified = toSamples(frame).filter((s) => typeof s.labels[labels.node] === 'string');

    if (identified.length === 0) {
      warnings.push(warn('no-identity', frame.refId, 'no node label or column'));
      continue;
    }

    for (const sample of identified) {
      const name = sample.labels[labels.node]!;
      let node = nodes.get(name);
      if (!node) {
        node = { name, state: sample.labels[labels.state] ?? '', partitions: [], labels: {}, facets: emptyFacets() };
        nodes.set(name, node);
      }
      // Several series per node is the normal case, not an error: one per
      // (node, partition) pair. Collapse them, and keep every partition.
      const partition = sample.labels[labels.partition];
      if (partition !== undefined && !node.partitions.includes(partition)) {
        node.partitions.push(partition);
      }
      for (const [key, value] of Object.entries(sample.labels)) {
        if (key !== '__name__' && node.labels[key] === undefined) {
          node.labels[key] = value;
        }
      }
    }
  }

  for (const node of nodes.values()) {
    node.partitions.sort();
  }

  // --- scalar facets ------------------------------------------------------
  for (const slot of SCALAR_SLOTS) {
    const refId = slots[slot];
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
        warnings.push(warn('ambiguous-scalar', refId, `${name} returned ${values.size} differing values for ${slot}`));
        continue;
      }
      // Under noUncheckedIndexedAccess, `[...values][0]` is `number | undefined`;
      // under exactOptionalPropertyTypes, assigning an explicit `undefined` to
      // `facets[slot]?: number` is a type error. Narrow with a guard instead of
      // asserting it away — size is always exactly 1 here, but TS can't see that.
      const value = [...values][0];
      if (value !== undefined) {
        node.facets[slot] = value;
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
  applyGres(slots.gresUsed, 'used');
  applyGres(slots.gresTotal, 'total');
  for (const node of nodes.values()) {
    node.facets.gres.sort((a, b) => a.type.localeCompare(b.type));
  }

  // --- drain reason, which carries no partition label ---------------------
  for (const frame of framesFor(frames, slots.drainReason)) {
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
