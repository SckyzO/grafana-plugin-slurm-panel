import { makeKeyFn, ordinalOf, UNGROUPED } from './keys.js';
import type { KeySource } from './keys.js';
import type { SlurmNode } from '../model/types.js';

export interface NodeGroup {
  key: string;
  nodes: SlurmNode[];
  /** True when the key was invented rather than read. */
  assumed: boolean;
}

export interface GroupedModel {
  groups: NodeGroup[];
  /** Distinct nodes. */
  nodeCount: number;
  /** Cells drawn. Larger than nodeCount when a node sits in several groups. */
  cellCount: number;
}

export interface BuildOptions {
  /**
   * Treat the key label as one a node may hold several values of — the
   * partition case. The node is then drawn in each of its groups.
   */
  multiValueLabel?: boolean;
  /**
   * Group keys the source declared, in declaration order. Keys named here are
   * emitted in this order and emitted even when no node matched them, so an
   * empty rack stays visible in its place on the floor. Keys not named here
   * keep the natural sort, after them.
   */
  order?: string[];
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Ordinal first, then a natural sort, so a rack reads 1, 2, 10 rather than 1, 10, 2. */
function compareNodes(a: SlurmNode, b: SlurmNode): number {
  const oa = ordinalOf(a.name);
  const ob = ordinalOf(b.name);
  if (oa !== undefined && ob !== undefined && oa !== ob) {
    return oa - ob;
  }
  return collator.compare(a.name, b.name);
}

export function buildGroups(
  nodes: SlurmNode[],
  source: KeySource,
  opts: BuildOptions = {}
): GroupedModel {
  if (nodes.length === 0) {
    return { groups: [], nodeCount: 0, cellCount: 0 };
  }

  const keyFn = makeKeyFn(source);
  const buckets = new Map<string, { nodes: SlurmNode[]; assumed: boolean }>();
  let cellCount = 0;

  // Seeded before the node loop so a declared group that matched nothing is
  // still emitted: an empty rack is information, not an absence.
  for (const key of opts.order ?? []) {
    if (!buckets.has(key)) {
      buckets.set(key, { nodes: [], assumed: false });
    }
  }

  const place = (node: SlurmNode, key: string, assumed: boolean): void => {
    const bucket = buckets.get(key) ?? { nodes: [], assumed: false };
    bucket.nodes.push(node);
    bucket.assumed = bucket.assumed || assumed;
    buckets.set(key, bucket);
    cellCount++;
  };

  const multiValued = opts.multiValueLabel === true && source.kind === 'label';

  for (const node of nodes) {
    if (multiValued && source.kind === 'label' && source.label === 'partition' && node.partitions.length > 0) {
      // A node in three partitions is drawn three times, which is the whole
      // of what multiValueLabel asks for. cellCount then exceeds nodeCount by
      // design; there is deliberately no flag saying so, because ingest keys
      // nodes by name and this branch is the only thing that can widen the
      // gap - a flag for it could only ever report the option working.
      for (const partition of node.partitions) {
        place(node, partition, false);
      }
      continue;
    }
    const { key, assumed } = keyFn(node);
    place(node, key, assumed);
  }

  const rank = new Map((opts.order ?? []).map((key, i): [string, number] => [key, i]));

  const groups: NodeGroup[] = [...buckets.entries()]
    .map(([key, bucket]) => ({ key, nodes: [...bucket.nodes].sort(compareNodes), assumed: bucket.assumed }))
    .sort((a, b) => {
      // "ungrouped" is a fallback, not a rack; it belongs last even when a
      // table happens to declare a group by that name.
      if (a.key === UNGROUPED) { return b.key === UNGROUPED ? 0 : 1; }
      if (b.key === UNGROUPED) { return -1; }
      const ra = rank.get(a.key);
      const rb = rank.get(b.key);
      if (ra !== undefined && rb !== undefined) { return ra - rb; }
      // A declared group outranks one that was merely discovered.
      if (ra !== undefined) { return -1; }
      if (rb !== undefined) { return 1; }
      return collator.compare(a.key, b.key);
    });

  return { groups, nodeCount: nodes.length, cellCount };
}
