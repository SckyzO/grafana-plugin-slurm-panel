import { makeKeyFn, UNGROUPED } from './keys.js';
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
export function suggestLabel({ nodes, source, nodeLabel, stateLabel }: CoverageInput): CoverageSuggestion | undefined {
  // `none` is a choice, not a failure to group.
  if (source.kind === 'none' || nodes.length === 0) {
    return undefined;
  }

  const keyFn = makeKeyFn(source);
  const active = nodes.filter((node) => keyFn(node).key !== UNGROUPED).length;

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
    const distinct = seen.size;
    // One group per node groups nothing; one group for everything is not a
    // grouping either, and it would win on coverage every single time.
    if (distinct === nodes.length || distinct < 2) {
      continue;
    }
    const covered = [...seen.values()].reduce((sum, n) => sum + n, 0);
    if (covered <= active) {
      continue;
    }
    if (best === undefined || covered > best.covered) {
      best = { label, covered, total: nodes.length };
    }
  }

  return best;
}
