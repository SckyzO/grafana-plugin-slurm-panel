import type { DisplayProcessor } from '@grafana/data';
import type { GroupedModel, IngestWarning, SlurmNode } from '@slurm-views/core';

/**
 * A state whose display text equals its raw value matched no mapping. Naming
 * these in the panel is how a state introduced by a Slurm upgrade becomes
 * visible instead of quietly grey.
 */
export function collectUnmapped(nodes: SlurmNode[], display: DisplayProcessor): string[] {
  const unmapped = new Set<string>();
  for (const node of nodes) {
    if (node.state === '') {
      continue;
    }
    // Grafana returns early when a value mapping matches and never computes
    // `percent`; an unmatched value falls through to the threshold path, which
    // sets it. Do not compare text: `idle` maps to "idle", a real match that
    // text comparison reports as a miss. Same signal as NodeCell.
    if (display(node.state).percent !== undefined) {
      unmapped.add(node.state);
    }
  }
  return [...unmapped].sort();
}

/**
 * How many unmapped states to name before summarising the rest. Enough to act
 * on, few enough to stay on one line in a panel that clips its overflow.
 */
const UNMAPPED_NAME_LIMIT = 8;

export function summarise(
  model: GroupedModel,
  warnings: IngestWarning[],
  unmapped: string[],
  maxCells: number
): string[] {
  const lines: string[] = [];

  if (model.duplicated) {
    // A count that silently disagrees with sinfo is worse than no count.
    lines.push(`${model.nodeCount} nodes drawn in ${model.slotCount} slots`);
  }

  if (unmapped.length > 0) {
    const noun = unmapped.length === 1 ? 'state' : 'states';
    // Name them rather than only counting, so a state introduced by a Slurm
    // upgrade is actionable — but cap the list. The panel's container is
    // overflow:hidden, and an unbounded line eats the grid it annotates. A real
    // cluster shows two or three unknown states and never reaches the cap; a
    // pathological one shows thirty and must not push the wall off screen.
    const shown = unmapped.slice(0, UNMAPPED_NAME_LIMIT);
    const rest = unmapped.length - shown.length;
    const named = rest > 0 ? `${shown.join(', ')}, and ${rest} more` : shown.join(', ');
    lines.push(`${unmapped.length} ${noun} matched no value mapping: ${named}`);
  }

  for (const warning of warnings) {
    lines.push(
      warning.kind === 'no-identity'
        ? `Query ${warning.refId ?? '?'} skipped: ${warning.detail}`
        : warning.detail
    );
  }

  if (model.slotCount > maxCells) {
    // Render what we have and say the view needs splitting, rather than
    // refusing or silently truncating.
    lines.push(`${model.slotCount} cells exceeds ${maxCells}. Filter the query or split the view by region.`);
  }

  return lines;
}
