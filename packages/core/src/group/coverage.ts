import type { KeySource } from './keys.js';
import type { SlurmNode } from '../model/types.js';

export interface CoverageSuggestion {
  label: string;
  /** Nodes this label would place. */
  covered: number;
  /** Nodes in the model. */
  total: number;
}

export interface CoverageInput {
  nodes: SlurmNode[];
  source: KeySource;
  /**
   * Nodes the active source actually placed, read off the built model rather
   * than recomputed. buildGroups does not place every node through the key
   * function — the multi-value partition fan-out places from node.partitions —
   * so re-running the key function here answered a different question than the
   * one the panel drew, and the signal spoke about a panel that had grouped
   * everything.
   */
  placed: number;
  /** The panel's configured node label. Excluded: one group per node. */
  nodeLabel: string;
  /** The panel's configured state label. Excluded: it changes between scrapes. */
  stateLabel: string;
}

/**
 * The label that would group more nodes than the active source does, if there
 * is one.
 *
 * This measures; it does not advise. "You should use a label" is an opinion
 * and becomes noise on second reading, whereas a number stops being printed
 * the moment it stops being true — which is why no special case is needed to
 * keep a correctly configured panel quiet.
 *
 * It never acts. Switching the source because a third party added a label to
 * the scrape would change a panel's behaviour with nothing in its JSON to
 * explain it.
 */
export function suggestLabel({ nodes, source, placed, nodeLabel, stateLabel }: CoverageInput): CoverageSuggestion | undefined {
  // `none` is a choice, not a failure to group.
  if (source.kind === 'none' || nodes.length === 0) {
    return undefined;
  }

  const counts = new Map<string, Map<string, number>>();
  for (const node of nodes) {
    for (const [label, value] of Object.entries(node.labels)) {
      if (label === nodeLabel || label === stateLabel || value === '') {
        continue;
      }
      const seen = counts.get(label) ?? new Map<string, number>();
      seen.set(value, (seen.get(value) ?? 0) + 1);
      counts.set(label, seen);
    }
  }

  let best: CoverageSuggestion | undefined;
  // Sorted so that two labels covering the same number resolve to the first
  // by name rather than by Map insertion order.
  for (const [label, seen] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const covered = [...seen.values()].reduce((sum, n) => sum + n, 0);
    const distinct = seen.size;
    // One group per node groups nothing, and the comparison has to be against
    // the nodes this label actually reaches rather than the whole model: a
    // label carried by four nodes with four distinct values is an identity for
    // those four, and measuring it against a 240-node total lets it through.
    // slurm_exporter ships exactly such a label — `reason`, which only drained
    // nodes carry. One group for everything is not a grouping either, and it
    // would win on coverage every single time.
    if (distinct === covered || distinct < 2) {
      continue;
    }
    if (covered <= placed) {
      continue;
    }
    if (best === undefined || covered > best.covered) {
      best = { label, covered, total: nodes.length };
    }
  }

  return best;
}
