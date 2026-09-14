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
  slotCount: number;
  duplicated: boolean;
}

export interface BuildOptions {
  /**
   * Treat the key label as one a node may hold several values of — the
   * partition case. The node is then drawn in each of its groups.
   */
  multiValueLabel?: boolean;
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
    return { groups: [], nodeCount: 0, slotCount: 0, duplicated: false };
  }

  const keyFn = makeKeyFn(source);
  const buckets = new Map<string, { nodes: SlurmNode[]; assumed: boolean }>();
  let slotCount = 0;

  const place = (node: SlurmNode, key: string, assumed: boolean): void => {
    const bucket = buckets.get(key) ?? { nodes: [], assumed: false };
    bucket.nodes.push(node);
    bucket.assumed = bucket.assumed || assumed;
    buckets.set(key, bucket);
    slotCount++;
  };

  const multiValued = opts.multiValueLabel === true && source.kind === 'label';

  for (const node of nodes) {
    if (multiValued && source.kind === 'label' && source.label === 'partition' && node.partitions.length > 0) {
      // A node in three partitions is drawn three times. The header says so.
      for (const partition of node.partitions) {
        place(node, partition, false);
      }
      continue;
    }
    const { key, assumed } = keyFn(node);
    place(node, key, assumed);
  }

  const groups: NodeGroup[] = [...buckets.entries()]
    .map(([key, bucket]) => ({ key, nodes: [...bucket.nodes].sort(compareNodes), assumed: bucket.assumed }))
    .sort((a, b) => {
      // "ungrouped" is a fallback, not a rack; it belongs last.
      if (a.key === UNGROUPED) { return b.key === UNGROUPED ? 0 : 1; }
      if (b.key === UNGROUPED) { return -1; }
      return collator.compare(a.key, b.key);
    });

  return { groups, nodeCount: nodes.length, slotCount, duplicated: slotCount > nodes.length };
}
