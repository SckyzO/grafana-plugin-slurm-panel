import type { DisplayProcessor } from '@grafana/data';
import { collapseHostlist, suggestLabel, UNGROUPED } from '@slurm-views/core';
import type {
  CoverageSuggestion,
  GroupedModel,
  IngestWarning,
  KeySource,
  RangeTable,
  SlurmNode,
} from '@slurm-views/core';
import { fractionFor } from './colorMode';
import type { ColorMode } from '../types';

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
 * the panel as up to eight distinct strings (`blocked`, `blocked#`,
 * `blocked!`, `blocked%` and so on) and naming each of them turns a single
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
 * the real state, because the trailing `.*` absorbs the literal `+`, which is
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
 * line would: a duplicated range-table block that renames the copy but not
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

/** Everything the blade layout could not honour. Absent outside the rack layout. */
export interface BladeNotes {
  /** Already-worded problems from the blade table parser. */
  problems: string[];
  /** Declared groups the panel is not drawing. */
  undrawn: string[];
  /** Drawn groups whose sled falls under the legibility floor. */
  squeezed: Array<{ key: string; blade: number; width: number }>;
}

/** Everything the slot layout could not honour. Absent outside the rack layout. */
export interface SlotNotes {
  /** Already-worded problems from the slot table parser. */
  problems: string[];
  /** Declared groups the panel is not drawing. */
  undrawn: string[];
  /** Drawn groups whose content needs more rows than the frame has. */
  overflowing: Array<{ key: string; needed: number; declared: number }>;
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
 * panel while the suite stays green, the exact failure these warnings exist
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
  const orphans = model.groups.find((g) => g.key === UNGROUPED)?.nodes.map((n) => n.name) ?? [];
  return {
    source,
    orphans,
    emptyGroups: model.groups
      .filter((g) => g.nodes.length === 0)
      .map((g) => ({ name: g.key, members: claimed.get(g.key) ?? [] })),
    problems: (table?.problems ?? []).map((p) => p.detail),
    // Read off the built model, not re-derived with makeKeyFn: buildGroups
    // does not place every node through the key function (the multi-value
    // partition fan-out places from node.partitions), so re-running it here
    // would answer a different question than the one the panel drew.
    suggestion: suggestLabel({ nodes, source, placed: model.nodeCount - orphans.length, nodeLabel, stateLabel }),
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
 * Why these nodes have no group. The condition is identical across sources,
 * in that the panel could not place them, but the cause is not, and the cause is the
 * only part that tells the operator what to go and fix.
 */
/**
 * The grouping source is not merely unproductive but unusable, and why.
 *
 * Re-tested here rather than reported from the core: `makeKeyFn` deliberately
 * swallows a `RegExp` constructor error, because the pattern is typed by hand
 * into a panel option and is invalid most of the time it is being typed, and
 * blanking the grid mid-keystroke would be worse. That is the right call for
 * the drawing and the wrong one for the strip, so the strip asks the same
 * question again once, off the render path.
 */
const configurationFault = (source: KeySource): string | undefined => {
  if (source.kind === 'capture') {
    try {
      new RegExp(source.pattern);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      return `Capture pattern "${source.pattern}" is not a valid regular expression, so no node could be grouped: ${detail}`;
    }
    return undefined;
  }
  if (source.kind === 'chunk' && !(Number.isInteger(source.size) && source.size > 0)) {
    return `Ordinals per group is ${source.size}; it must be a whole number above zero. No node could be grouped.`;
  }
  return undefined;
};

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

/** What the Colour by radio calls each mode, so the line names what was clicked. */
const COLOUR_MODE_LABEL: Record<Exclude<ColorMode, 'state'>, string> = {
  cpu: 'CPU',
  mem: 'Memory',
  gres: 'GPU',
};

/**
 * The two display-time facts the warning pass needs that the model does not
 * carry: what the reader asked to be coloured by, and what label the state
 * was supposed to arrive under. Grouped rather than passed as two more
 * positional arguments — seven parameters is already past the point where an
 * options object would read better, and reshaping the rest touches
 * forty-three call sites, which is its own change rather than a rider.
 */
export interface DisplayNotes {
  colorMode: ColorMode;
  /** The configured Data > State label, named back when nothing arrives under it. */
  stateLabel: string;
}

export function summarise(
  model: GroupedModel,
  warnings: IngestWarning[],
  unmapped: string[],
  grouping: GroupingNotes,
  blades?: BladeNotes,
  slots?: SlotNotes,
  display?: DisplayNotes
): string[] {
  const lines: string[] = [];
  const allNodes = model.groups.flatMap((g) => g.nodes);

  // A node whose state label resolved to nothing gets an empty string, and an
  // empty string is skipped by collectUnmapped — deliberately, since it is
  // not an unmapped state. Nothing else spoke for it either: identity
  // resolves from a different label, so the no-identity warning stays quiet,
  // and the colour-mode line below is guarded on a continuous mode while
  // State is the default. The result was a whole cluster drawn as hollow
  // rings, in silence, from one mistyped option.
  //
  // Only when *no* node has a state, for the same reason as the colour-mode
  // line: a few blank states among many is a data question, not a
  // configuration one.
  if (display !== undefined && allNodes.length > 0 && allNodes.every((n) => n.state === '')) {
    lines.push(`No node carries a "${display.stateLabel}" label: every cell is drawn hollow. ` + 'Data > State label.');
  }

  // Three of the four Colour by modes are driven by facets that have no field
  // in the options editor — they are bound by editing the panel JSON. Pick one
  // without binding it and every cell is drawn hollow, which is also exactly
  // how the panel draws a node that legitimately has no data. The reader
  // cannot tell "nothing is wired" from "nothing to show", and this was the
  // one thing the panel could not say about itself.
  //
  // Only when *no* node carries the facet. Partial coverage is normal and
  // documented — a node with no GPU is drawn empty on purpose — so a line that
  // fired on partial coverage would be permanent noise on any mixed floor.
  if (display !== undefined && display.colorMode !== 'state') {
    const mode = display.colorMode;
    if (allNodes.length > 0 && allNodes.every((n) => fractionFor(n, mode) === undefined)) {
      lines.push(
        `Colour by ${COLOUR_MODE_LABEL[mode]}, but no node carries that data: every cell is drawn empty. ` +
          'Bind the facet in the panel JSON (panel menu > Edit panel JSON, options.queries).'
      );
    }
  }

  if (unmapped.length > 0) {
    // Count and name states, not state-and-flag combinations. Name them rather
    // than only counting, so a state introduced by a Slurm upgrade is
    // actionable, but cap the list. The panel's container is overflow:hidden,
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
    // printed (delimited, whole-value, escaped) because the two ways of
    // getting it wrong both fail silently and neither is visible from the
    // Value mappings UI.
    const example = shown[0];
    if (example !== undefined) {
      // Short on purpose. The strip sits above the grid and takes the height
      // it needs, so a sentence that wraps to three lines in a half-width
      // panel pushes the cells it annotates off the bottom - which is how one
      // reader ended up deleting the state that produced it rather than the
      // sentence. Value mappings, Regex, and the pattern: the three things a
      // reader cannot guess. What to type in the text and colour fields is
      // visible in the form itself.
      lines.push(
        bases.length === 1
          ? `Fix: Value mappings ▸ Regex ${ruleFor(example)}`
          : `Fix: Value mappings ▸ Regex, one per state, e.g. ${ruleFor(example)}`
      );
    }
  }

  for (const warning of warnings) {
    lines.push(
      warning.kind === 'no-identity' ? `Query ${warning.refId ?? '?'} skipped: ${warning.detail}` : warning.detail
    );
  }

  // `none` puts every node in `ungrouped` deliberately. Warning about it would
  // be warning about the configuration the operator chose.
  if (grouping.source.kind !== 'none' && grouping.orphans.length > 0) {
    // Two settings put every node under `ungrouped` for a reason that has
    // nothing to do with the nodes, and `causeOf` would blame the names: a
    // capture pattern that does not compile ("did not match the capture
    // pattern" — nothing was ever run against them), and a chunk size of
    // zero ("have no number in their names to chunk by" — they all do). A
    // confident wrong cause sends the reader off to debug their naming, so
    // these two are named before the generic line rather than through it.
    const misconfigured = configurationFault(grouping.source);
    if (misconfigured !== undefined) {
      lines.push(misconfigured);
    } else {
      const n = grouping.orphans.length;
      lines.push(
        `${n} ${n === 1 ? 'node' : 'nodes'} ${causeOf(grouping.source, n !== 1)}: ${listOf(grouping.orphans)}. Drawn under "${UNGROUPED}".`
      );
    }
  }

  // The opposite problem: a box with no nodes rather than nodes with no box.
  // A cluster mid-recabling shows both, and they must read separately.
  for (const group of grouping.emptyGroups) {
    lines.push(`Range "${group.name}" matched no node: ${listOf(group.members)}.`);
  }

  lines.push(...grouping.problems);

  if (blades !== undefined) {
    lines.push(...blades.problems);

    if (blades.undrawn.length > 0) {
      const n = blades.undrawn.length;
      lines.push(
        `Nodes per blade named ${n} ${n === 1 ? 'group that is' : 'groups that are'} not drawn: ${listOf(blades.undrawn)}.`
      );
    }

    // One line per blade size, not one per cabinet: every cabinet at a given
    // size has the same sled width, because they all share the rack width, so
    // a hundred squeezed cabinets would print a hundred identical sentences.
    const bySize = new Map<number, { keys: string[]; width: number }>();
    for (const { key, blade, width } of blades.squeezed) {
      const seen = bySize.get(blade);
      if (seen === undefined) {
        bySize.set(blade, { keys: [key], width });
      } else {
        seen.keys.push(key);
      }
    }
    for (const [blade, { keys, width }] of [...bySize].sort((a, b) => a[0] - b[0])) {
      lines.push(`A blade of ${blade} leaves each node ${width}px wide in ${listOf(keys)}. Raise Cell width.`);
    }
  }

  if (slots !== undefined) {
    lines.push(...slots.problems);

    if (slots.undrawn.length > 0) {
      const n = slots.undrawn.length;
      lines.push(
        `Slots per rack named ${n} ${n === 1 ? 'group that is' : 'groups that are'} not drawn: ${listOf(slots.undrawn)}.`
      );
    }

    // Grouped by the pair of numbers rather than one line per cabinet: a row
    // of identical cabinets that all outgrew the same declaration is one fact.
    const byPair = new Map<string, { keys: string[]; needed: number; declared: number }>();
    for (const { key, needed, declared } of slots.overflowing) {
      const id = `${needed}/${declared}`;
      const seen = byPair.get(id);
      if (seen === undefined) {
        byPair.set(id, { keys: [key], needed, declared });
      } else {
        seen.keys.push(key);
      }
    }
    // Worst first, by how far the declaration is from the truth. The strip's
    // line cap is applied once at the end over every source, so a run of
    // overflow lines can still be the ones truncation reaches, which makes
    // this order load-bearing rather than cosmetic: the cabinet whose table
    // is most wrong is the one worth keeping. Ties break by size so the
    // order is total.
    const worstFirst = [...byPair.values()].sort(
      (a, b) => b.needed - b.declared - (a.needed - a.declared) || b.needed - a.needed
    );
    for (const { keys, needed, declared } of worstFirst) {
      // Slots on both sides, not nodes: under quads "45 nodes but 42 slots"
      // is arithmetic the reader has to redo.
      const verb = keys.length === 1 ? 'needs' : 'need';
      lines.push(`${listOf(keys)} ${verb} ${needed} slots but ${declared} were declared.`);
    }
  }

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
