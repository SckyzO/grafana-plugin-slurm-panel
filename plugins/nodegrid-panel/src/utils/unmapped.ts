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

/**
 * A state name, made safe to drop into a regular expression. Slurm prints
 * `allocated+` for a node that is allocated with jobs still completing, and
 * `/^allocated+.*$/` does not mean what it looks like: `d+` is one or more
 * `d`, so the rule also claims anything spelled `allocatedd`. It still matches
 * the real state, because the trailing `.*` absorbs the literal `+` — which is
 * exactly why a rule like that ships without anyone noticing. A name carrying
 * a bracket would not compile at all. Handing someone a rule that is quietly
 * wrong is worse than handing them none.
 */
const escapeForRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * The rule that would map a state, written the way it has to be written:
 * delimited, so Grafana does not wrap it in ^...$ and turn it into an exact
 * match, and spanning the whole value, so RegexToText replaces all of it
 * rather than gluing the result onto the remainder. Both traps are silent.
 * The trailing `.*` is what absorbs the nine sinfo flags, so one rule covers
 * `blocked`, `blocked*`, `blocked-` and the rest.
 */
export const ruleFor = (state: string): string => `/^${escapeForRegex(state)}.*$/`;

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

    // Naming the state says what is wrong; this says what to do about it, at
    // the moment it is wrong rather than in a document. The rule is correct as
    // printed — delimited, whole-value, escaped — because the two ways of
    // getting it wrong both fail silently and neither is visible from the
    // Value mappings UI.
    const example = shown[0];
    if (example !== undefined) {
      lines.push(
        bases.length === 1
          ? `Add one under Value mappings — condition Regex, ${ruleFor(example)} — then set its text and colour.`
          : `Add one per state under Value mappings — condition Regex, e.g. ${ruleFor(example)} — then set its text and colour.`
      );
    }
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
