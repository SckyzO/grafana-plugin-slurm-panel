import type { DisplayProcessor } from '@grafana/data';
import type { GroupedModel, IngestWarning, SlurmNode } from '@slurm-views/core';

/**
 * A state matched no value mapping when `display()` falls through to the
 * threshold path and sets `percent`; a matched mapping returns early and
 * leaves `percent` undefined. Naming these in the panel is how a state
 * introduced by a Slurm upgrade becomes visible instead of silently taking
 * the threshold base colour.
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

/**
 * The nine flag characters sinfo can append to a state: not responding,
 * powered off, powering up, pending power down, powering down, reservation
 * maintenance, pending reboot, reboot issued, and planned by the backfill
 * scheduler. Source: the NODE STATE CODES section of the sinfo man page.
 */
const STATE_FLAGS = '*~#!%$@^-';

/**
 * The state without its flag, when it carries one. One unknown state reaches
 * the panel as up to eight distinct strings — `blocked`, `blocked#`,
 * `blocked!`, `blocked%` and so on — and naming each of them turns a single
 * actionable fact into a wall of text that says the same thing eight times.
 * The operator has one thing to do either way: write a rule for the state.
 */
const baseStateOf = (state: string): string => {
  const flag = state.slice(-1);
  return state.length > 1 && STATE_FLAGS.includes(flag) ? state.slice(0, -1) : state;
};

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
    // Count and name states, not state-and-flag combinations. Name them rather
    // than only counting, so a state introduced by a Slurm upgrade is
    // actionable — but cap the list. The panel's container is overflow:hidden,
    // and an unbounded line eats the grid it annotates.
    const bases = [...new Set(unmapped.map(baseStateOf))].sort();
    const noun = bases.length === 1 ? 'state' : 'states';
    const shown = bases.slice(0, UNMAPPED_NAME_LIMIT);
    const rest = bases.length - shown.length;
    const named = rest > 0 ? `${shown.join(', ')}, and ${rest} more` : shown.join(', ');
    // The raw count still gets a mention when it differs, because "8 variants"
    // is the difference between one unknown state and eight of them.
    const variants = unmapped.length > bases.length ? ` (${unmapped.length} with flags)` : '';
    lines.push(`${bases.length} ${noun} matched no value mapping: ${named}${variants}`);
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
