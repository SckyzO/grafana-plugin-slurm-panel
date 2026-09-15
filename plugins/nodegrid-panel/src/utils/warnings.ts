import type { DisplayProcessor } from '@grafana/data';
import { collapseHostlist, suggestLabel, UNGROUPED } from '@slurm-views/core';
import type { CoverageSuggestion, GroupedModel, IngestWarning, KeySource, RangeTable, SlurmNode } from '@slurm-views/core';

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

/**
 * How many hostlist items to name before summarising the rest. The strip
 * clips its overflow, so an unbounded line eats the grid it annotates.
 */
const HOSTLIST_ITEM_LIMIT = 8;

/**
 * How many lines the strip prints in total before summarising the rest.
 *
 * Capping the length of one line is a different problem from capping how
 * many of them there are: the strip's container is `overflow: hidden`, so an
 * unbounded *count* of short lines eats the grid exactly as one unbounded
 * line would — a duplicated range-table block that renames the copy but not
 * its hostlist can print one problem per claimant and one empty-group line
 * per group it now shadows, and neither of those is capped in number by
 * anything above. This one rule, applied last in `summarise`, covers every
 * line source that exists today and any added later.
 */
const STRIP_LINE_LIMIT = 8;

/** Everything the grouping stage could not fully resolve. */
export interface GroupingNotes {
  /** How the panel grouped, so the orphan line can name the cause. */
  source: KeySource;
  /** Nodes the source placed nowhere. */
  orphans: string[];
  /** Declared groups that matched no node, and what they claimed. */
  emptyGroups: Array<{ name: string; members: string[] }>;
  /** Already-worded problems from the range table parser. */
  problems: string[];
  /** A label that would group more nodes than the active source does. */
  suggestion?: CoverageSuggestion;
}

export interface GroupingNotesInput {
  model: GroupedModel;
  nodes: SlurmNode[];
  source: KeySource;
  /** Present only when grouping by a range table. */
  table?: RangeTable;
  nodeLabel: string;
  stateLabel: string;
}

/**
 * Everything the grouping stage could not resolve, read off the built model.
 *
 * A pure function rather than three expressions inside the hook, because this
 * is the part that can be wrong in a way nothing notices: mistype the
 * UNGROUPED lookup and every orphan and empty-group warning vanishes from the
 * panel while the suite stays green — the exact failure these warnings exist
 * to catch. A hook needs a renderer to test; this does not.
 */
export function groupingNotes({
  model,
  nodes,
  source,
  table,
  nodeLabel,
  stateLabel,
}: GroupingNotesInput): GroupingNotes {
  const claimed = new Map((table?.groups ?? []).map((g) => [g.name, g.members]));
  return {
    source,
    orphans: model.groups.find((g) => g.key === UNGROUPED)?.nodes.map((n) => n.name) ?? [],
    emptyGroups: model.groups
      .filter((g) => g.nodes.length === 0)
      .map((g) => ({ name: g.key, members: claimed.get(g.key) ?? [] })),
    problems: (table?.problems ?? []).map((p) => p.detail),
    suggestion: suggestLabel({ nodes, source, nodeLabel, stateLabel }),
  };
}

/** Node names as hostlist items, capped: 240 orphans must still fit on a line. */
const listOf = (names: string[]): string => {
  const items = collapseHostlist(names);
  const shown = items.slice(0, HOSTLIST_ITEM_LIMIT);
  const rest = items.length - shown.length;
  return rest > 0 ? `${shown.join(',')} and ${rest} more` : shown.join(',');
};

/**
 * Why these nodes have no group. The condition is identical across sources —
 * the panel could not place them — but the cause is not, and the cause is the
 * only part that tells the operator what to go and fix.
 */
const causeOf = (source: KeySource, plural: boolean): string => {
  switch (source.kind) {
    case 'ranges':
      return 'matched no range';
    case 'label':
      return `${plural ? 'carry' : 'carries'} no "${source.label}" label`;
    case 'capture':
      return 'did not match the capture pattern';
    case 'chunk':
      return `${plural ? 'have' : 'has'} no number in ${plural ? 'their names' : 'its name'} to chunk by`;
    default:
      return 'could not be placed';
  }
};

export function summarise(
  model: GroupedModel,
  warnings: IngestWarning[],
  unmapped: string[],
  grouping: GroupingNotes
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

  // `none` puts every node in `ungrouped` deliberately. Warning about it would
  // be warning about the configuration the operator chose.
  if (grouping.source.kind !== 'none' && grouping.orphans.length > 0) {
    const n = grouping.orphans.length;
    lines.push(
      `${n} ${n === 1 ? 'node' : 'nodes'} ${causeOf(grouping.source, n !== 1)}: ${listOf(grouping.orphans)}. Drawn under "${UNGROUPED}".`
    );
  }

  // The opposite problem: a box with no nodes rather than nodes with no box.
  // A cluster mid-recabling shows both, and they must read separately.
  for (const group of grouping.emptyGroups) {
    lines.push(`Range "${group.name}" matched no node: ${listOf(group.members)}.`);
  }

  lines.push(...grouping.problems);

  if (grouping.suggestion !== undefined) {
    const { label, covered, total } = grouping.suggestion;
    lines.push(
      covered === total
        ? `Label "${label}" would group all ${total}. Grouping > Group by > Label.`
        : `Label "${label}" would group ${covered} of ${total}. Grouping > Group by > Label.`
    );
  }

  // Applied last, over every line pushed above: capping one source's line
  // count does not cap the strip, since several sources can each stay under
  // their own limit and still overflow together.
  if (lines.length > STRIP_LINE_LIMIT) {
    const kept = lines.slice(0, STRIP_LINE_LIMIT);
    kept.push(`and ${lines.length - STRIP_LINE_LIMIT} more warnings.`);
    return kept;
  }

  return lines;
}
