import { collectUnmapped, summarise, ruleFor, groupingNotes } from './warnings';
import type { DisplayProcessor } from '@grafana/data';
import { buildGroups, parseRangeTable, UNGROUPED } from '@slurm-views/core';
import type { GroupedModel, SlurmNode } from '@slurm-views/core';
import type { GroupingNotes, SlotNotes } from './warnings';

const node = (name: string, state: string): SlurmNode => ({
  name, state, partitions: [], labels: {}, facets: { gres: [] },
});

// Models Grafana's real shape rather than a convenient one: a matched mapping
// returns early and never sets `percent`; an unmatched value falls through to
// the threshold path, which does. `idle` maps to the text "idle" — identical to
// its input — which is exactly the case a text comparison gets wrong.
const display = ((value: unknown) =>
  value === 'idle'
    ? { text: 'idle', numeric: NaN }
    : { text: String(value), numeric: NaN, percent: 0 }
) as unknown as DisplayProcessor;

describe('collectUnmapped', () => {
  it('names the states that matched no mapping, once each', () => {
    const nodes = [node('c1', 'idle'), node('c2', 'perfctrs'), node('c3', 'perfctrs'), node('c4', 'blocked')];
    expect(collectUnmapped(nodes, display)).toEqual(['blocked', 'perfctrs']);
  });

  it('returns nothing when every state is mapped', () => {
    expect(collectUnmapped([node('c1', 'idle')], display)).toEqual([]);
  });

  it('does not report a state whose mapped text equals its own name', () => {
    // The regression this guards: `idle` maps to "idle", so a text comparison
    // calls the commonest healthy state unmapped and the panel warns about it.
    expect(collectUnmapped([node('c1', 'idle'), node('c2', 'perfctrs')], display))
      .toEqual(['perfctrs']);
  });

  it('ignores a node with no state at all, which is a different problem', () => {
    expect(collectUnmapped([node('c1', '')], display)).toEqual([]);
  });
});

describe('summarise', () => {
  const model = (nodeCount: number, cellCount: number): GroupedModel => ({
    groups: [], nodeCount, cellCount,
  });

  it('says nothing when there are more cells than nodes', () => {
    // More cells than nodes has exactly one cause - Multi-value label, which
    // asks for a cell per (node, partition) - and the strip used to report it
    // as a fault. Grouping the dev cluster by partition said "540 nodes drawn
    // in 617 cells" under a warning triangle, and no setting removed it,
    // because the setting was the cause. Nothing here now says so; the option
    // that produced it says what it does, and each group header carries its
    // own count.
    expect(summarise(model(20, 25), [], [], notes())).toEqual([]);
  });

  it('says nothing about counts when they agree', () => {
    expect(summarise(model(20, 20), [], [], notes())).toEqual([]);
  });

  it('names an unmapped state rather than only counting it', () => {
    expect(summarise(model(2, 2), [], ['perfctrs'], notes()))
      .toContain('1 state matched no value mapping: perfctrs');
  });

  it('pluralises several unmapped states', () => {
    expect(summarise(model(2, 2), [], ['blocked', 'perfctrs'], notes()))
      .toContain('2 states matched no value mapping: blocked, perfctrs');
  });

  it('counts states, not state-and-flag combinations', () => {
    // What a real panel was showing: one unknown state reaching the strip as
    // five strings, reported as five states to write rules for.
    const line = summarise(
      model(5, 5),
      [],
      ['blocked', 'blocked!', 'blocked#', 'blocked%', 'blocked-'],
      notes()
    )[0];
    expect(line).toContain('1 state matched no value mapping: blocked');
    expect(line).toContain('(5 with flags)');
    expect(line).not.toContain('blocked!');
  });

  it('does not mention flag variants when there are none', () => {
    expect(summarise(model(2, 2), [], ['blocked', 'zzz'], notes())[0]).not.toContain('with flags');
  });

  it('does not mistake a state that merely ends in a flag character for a flagged one', () => {
    // Guard against stripping a character off a one-character state and
    // reporting an empty name.
    expect(summarise(model(1, 1), [], ['-'], notes())[0]).toContain('1 state matched no value mapping: -');
  });

  it('caps the named list and says how many it held back', () => {
    // The panel clips its overflow, so an unbounded list eats the grid.
    const many = Array.from({ length: 12 }, (_, i) => `state${i}`);
    const line = summarise(model(2, 2), [], many, notes())[0];
    expect(line).toContain('12 states matched no value mapping:');
    expect(line).toContain('and 4 more');
    expect(line).not.toContain('state8');
  });

  it('prints a rule that can be pasted, for the state it just named', () => {
    const lines = summarise(model(1, 1), [], ['blocked', 'blocked!'], notes());
    expect(lines[0]).toContain('1 state matched no value mapping: blocked');
    expect(lines[1]).toContain('Value mappings');
    expect(lines[1]).toContain('Regex');
    expect(lines[1]).toContain('/^blocked.*$/');
  });

  it('offers the rule as an example when several states need one', () => {
    const lines = summarise(model(1, 1), [], ['blocked', 'completing'], notes());
    expect(lines[1]).toContain('one per state');
    expect(lines[1]).toContain('e.g. /^blocked.*$/');
  });

  it('says nothing about rules when nothing is unmapped', () => {
    expect(summarise(model(2, 2), [], [], notes()).join(' ')).not.toContain('Value mappings');
  });

  it('escapes a state that would otherwise be a different regex', () => {
    // Slurm prints `allocated+` for a node allocated with jobs completing.
    // Unescaped, /^allocated+.*$/ reads as one-or-more `d`, so it also claims
    // `allocatedd`. It still matches the real state — the trailing `.*` eats
    // the literal `+` — which is why the mistake survives a quick look.
    expect(ruleFor('allocated+')).toBe('/^allocated\\+.*$/');
    expect(new RegExp('^allocated\\+.*$').test('allocated+')).toBe(true);
    expect(new RegExp('^allocated\\+.*$').test('allocatedd')).toBe(false);
    expect(new RegExp('^allocated+.*$').test('allocatedd')).toBe(true);
  });

  it('delimits and spans the whole value, which is what makes the rule work', () => {
    // Undelimited, Grafana wraps the pattern in ^...$ and it becomes an exact
    // match; stopping short of the end makes RegexToText glue the result onto
    // the remainder. Both are silent. Pinned here because this string is
    // handed to an operator to paste.
    const rule = ruleFor('blocked');
    expect(rule.startsWith('/')).toBe(true);
    expect(rule.endsWith('/')).toBe(true);
    expect(rule).toContain('.*$');
  });

  it('passes an ingest warning through with its refId', () => {
    expect(summarise(model(0, 0), [{ kind: 'no-identity', refId: 'B', detail: 'no node label or column' }], [], notes()))
      .toContain('Query B skipped: no node label or column');
  });

  describe('summarise, slot notes', () => {
    const slotNotes = (over: Partial<SlotNotes> = {}): SlotNotes => ({
      problems: [],
      undrawn: [],
      overflowing: [],
      ...over,
    });

    it('carries the slot table parser problems through as written', () => {
      const lines = summarise(model(4, 4), [], [], notes(), undefined, slotNotes({
        problems: ['Line 2 is missing a count.'],
      }));
      expect(lines).toContain('Line 2 is missing a count.');
    });

    it('collapses declared groups that are not drawn into one line', () => {
      // rack9 and rack10 are consecutive, so listOf's hostlist collapsing
      // (see packages/core/test/hostlist.test.ts) folds them into one range
      // rather than joining them with a comma.
      const lines = summarise(model(4, 4), [], [], notes(), undefined, slotNotes({
        undrawn: ['rack9', 'rack10'],
      }));
      expect(lines).toContain('Slots per rack named 2 groups that are not drawn: rack[9-10].');
    });

    it('says "group that is" for a single undrawn declaration', () => {
      const lines = summarise(model(4, 4), [], [], notes(), undefined, slotNotes({ undrawn: ['rack9'] }));
      expect(lines).toContain('Slots per rack named 1 group that is not drawn: rack9.');
    });

    it('names a cabinet that holds more than it declares, in slots on both sides', () => {
      // Stated in slots rather than nodes so it stays in the unit the option is
      // written in: under quads "45 nodes but 42 slots" is arithmetic the reader
      // has to redo, where "12 slots but 10" is the comparison the panel made.
      const lines = summarise(model(45, 45), [], [], notes(), undefined, slotNotes({
        overflowing: [{ key: 'rack1', needed: 45, declared: 42 }],
      }));
      expect(lines).toContain('rack1 needs 45 slots but 42 were declared.');
    });

    it('groups cabinets that outgrew the same declaration by the same amount into one line', () => {
      // A row of identical cabinets that all outgrew the same declaration is one
      // fact, not three sentences.
      const lines = summarise(model(36, 36), [], [], notes(), undefined, slotNotes({
        overflowing: [
          { key: 'rack7', needed: 12, declared: 10 },
          { key: 'rack8', needed: 12, declared: 10 },
          { key: 'rack9', needed: 12, declared: 10 },
        ],
      }));
      expect(lines).toContain('rack[7-9] need 12 slots but 10 were declared.');
    });

    it('keeps cabinets that overflowed by different amounts on their own lines', () => {
      const lines = summarise(model(20, 20), [], [], notes(), undefined, slotNotes({
        overflowing: [
          { key: 'rack1', needed: 12, declared: 10 },
          { key: 'rack2', needed: 20, declared: 10 },
        ],
      }));
      expect(lines).toContain('rack1 needs 12 slots but 10 were declared.');
      expect(lines).toContain('rack2 needs 20 slots but 10 were declared.');
    });

    it('puts the cabinet whose declaration is most wrong first', () => {
      // The strip's line cap is applied over every source at the end, so these
      // are the lines truncation reaches. Order decides which one survives.
      const lines = summarise(model(60, 60), [], [], notes(), undefined, slotNotes({
        overflowing: [
          { key: 'rack1', needed: 45, declared: 42 },  // short by 3
          { key: 'rack2', needed: 30, declared: 10 },  // short by 20
          { key: 'rack3', needed: 14, declared: 10 },  // short by 4
        ],
      }));
      const only = lines.filter((l) => l.includes('were declared.'));
      expect(only).toEqual([
        'rack2 needs 30 slots but 10 were declared.',
        'rack3 needs 14 slots but 10 were declared.',
        'rack1 needs 45 slots but 42 were declared.',
      ]);
    });

    it('says nothing at all outside the rack layout', () => {
      // The options are hidden in Wrap, so warning about a table nobody can see
      // would be warning about nothing.
      expect(summarise(model(4, 4), [], [], notes())).toEqual([]);
    });
  });
});

const notes = (over: Partial<GroupingNotes> = {}): GroupingNotes => ({
  source: { kind: 'none' },
  orphans: [],
  emptyGroups: [],
  problems: [],
  ...over,
});

describe('grouping warnings', () => {
  const model = (nodeCount: number): GroupedModel => ({
    groups: [], nodeCount, cellCount: nodeCount,
  });

  it('names orphan nodes collapsed back to hostlist syntax', () => {
    const lines = summarise(model(3), [], [], notes({
      source: { kind: 'ranges', table: 'rack1: c[1-2]' },
      orphans: ['c201', 'c202', 'c203'],
    }));
    expect(lines).toContain('3 nodes matched no range: c[201-203]. Drawn under "ungrouped".');
  });

  it('names the cause, which differs by source', () => {
    const line = summarise(model(1), [], [], notes({
      source: { kind: 'label', label: 'rack' }, orphans: ['c1'],
    }))[0];
    expect(line).toContain('1 node carries no "rack" label');
  });

  it('says nothing about orphans when grouping is switched off', () => {
    // Every node is ungrouped on purpose; that is the configuration chosen.
    const lines = summarise(model(2), [], [], notes({ orphans: ['c1', 'c2'] }));
    expect(lines.join(' ')).not.toContain('ungrouped');
  });

  it('names a declared range that matched no node', () => {
    const lines = summarise(model(1), [], [], notes({
      source: { kind: 'ranges', table: 'x: c[1-1]' },
      emptyGroups: [{ name: 'rack7', members: ['c213', 'c214'] }],
    }));
    expect(lines).toContain('Range "rack7" matched no node: c[213-214].');
  });

  it('passes a table problem straight through', () => {
    const lines = summarise(model(1), [], [], notes({
      source: { kind: 'ranges', table: 'bad' },
      problems: ['Line 2 has no "name: hostlist" separator.'],
    }));
    expect(lines).toContain('Line 2 has no "name: hostlist" separator.');
  });

  it('reports a better label as a measurement, not as advice', () => {
    const lines = summarise(model(240), [], [], notes({
      source: { kind: 'chunk', size: 40 },
      suggestion: { label: 'rack', covered: 240, total: 240 },
    }));
    expect(lines).toContain('Label "rack" would group all 240. Grouping > Group by > Label.');
  });

  it('says how many when a better label does not cover everything', () => {
    const lines = summarise(model(240), [], [], notes({
      source: { kind: 'chunk', size: 40 },
      suggestion: { label: 'rack', covered: 228, total: 240 },
    }));
    expect(lines).toContain('Label "rack" would group 228 of 240. Grouping > Group by > Label.');
  });

  it('caps a very long orphan list', () => {
    // The strip clips its overflow, so an unbounded line eats the grid.
    const orphans = Array.from({ length: 20 }, (_, i) => `x${i}y`);
    const line = summarise(model(20), [], [], notes({
      source: { kind: 'ranges', table: 'x: c[1-1]' }, orphans,
    }))[0];
    expect(line).toContain('and 12 more');
  });

  it('caps the strip itself, not just the length of one line', () => {
    // A duplicated block that renames the copy but keeps the range table's
    // node list produces one empty-group line per declared group: bounding
    // each line's own length does nothing when the *count* of lines is what
    // eats the grid. Twelve empty groups exceed STRIP_LINE_LIMIT (8).
    const emptyGroups = Array.from({ length: 12 }, (_, i) => ({ name: `rack${i}`, members: [] }));
    const lines = summarise(model(1), [], [], notes({
      source: { kind: 'ranges', table: 'x: c[1-1]' }, emptyGroups,
    }));
    expect(lines).toHaveLength(9);
    expect(lines.slice(0, 8)).toEqual(emptyGroups.slice(0, 8).map((g) => `Range "${g.name}" matched no node: .`));
    expect(lines[8]).toBe('and 4 more warnings.');
  });

  it('does not cap a strip at or under the limit', () => {
    const emptyGroups = Array.from({ length: 8 }, (_, i) => ({ name: `rack${i}`, members: [] }));
    const lines = summarise(model(1), [], [], notes({
      source: { kind: 'ranges', table: 'x: c[1-1]' }, emptyGroups,
    }));
    expect(lines).toHaveLength(8);
    expect(lines.join(' ')).not.toContain('more warnings');
  });
});

describe('blade warnings', () => {
  const noGrouping: GroupingNotes = { source: { kind: 'none' }, orphans: [], emptyGroups: [], problems: [] };
  const empty = { groups: [], nodeCount: 0, cellCount: 0 };

  it('says nothing at all when there are no blade notes', () => {
    // Every wrap-layout panel is this case, and it must stay silent.
    expect(summarise(empty, [], [], noGrouping)).toEqual([]);
  });

  it('repeats problems from the parser verbatim', () => {
    const lines = summarise(empty, [], [], noGrouping, {
      problems: ['Line 2 has no "groups: count" separator.'],
      undrawn: [],
      squeezed: [],
    });
    expect(lines).toContain('Line 2 has no "groups: count" separator.');
  });

  it('collapses a hundred declared groups that are not drawn into one line', () => {
    // rack[1-120] against a query that returned twenty is a hundred missing
    // cabinets, and a hundred lines is a wall rather than a warning.
    const undrawn = Array.from({ length: 100 }, (_, i) => `rack${i + 21}`);
    const lines = summarise(empty, [], [], noGrouping, { problems: [], undrawn, squeezed: [] });
    expect(lines).toEqual([
      'Nodes per blade named 100 groups that are not drawn: rack[21-120].',
    ]);
  });

  it('says "group that is" for a single one', () => {
    const lines = summarise(empty, [], [], noGrouping, { problems: [], undrawn: ['rack9'], squeezed: [] });
    expect(lines).toEqual(['Nodes per blade named 1 group that is not drawn: rack9.']);
  });

  it('collapses squeezed cabinets by blade size, naming the width once', () => {
    // Every cabinet at the same blade size has the same sled width, because
    // they all share the rack width. One line per size, not one per cabinet.
    const squeezed = [
      { key: 'rack1', blade: 4, width: 6 },
      { key: 'rack2', blade: 4, width: 6 },
      { key: 'gpu1', blade: 3, width: 8 },
    ];
    const lines = summarise(empty, [], [], noGrouping, { problems: [], undrawn: [], squeezed });
    expect(lines).toEqual([
      'A blade of 3 leaves each node 8px wide in gpu1. Raise Cell width.',
      'A blade of 4 leaves each node 6px wide in rack[1-2]. Raise Cell width.',
    ]);
  });
});

describe('groupingNotes', () => {
  const mkNode = (name: string): SlurmNode => ({
    name, state: 'idle', partitions: [], labels: {}, facets: { gres: [] },
  });
  const ranges = { kind: 'ranges', table: 'rack1: c[1-2]\nrack7: c[90-91]' } as const;
  const args = { nodeLabel: 'node', stateLabel: 'status' };

  it('reads orphans off the ungrouped bucket', () => {
    // The regression this guards: mistype the UNGROUPED lookup and every
    // orphan warning leaves the panel while the suite stays green.
    const model: GroupedModel = {
      groups: [
        { key: 'rack1', nodes: [mkNode('c1')], assumed: false },
        { key: UNGROUPED, nodes: [mkNode('c9')], assumed: false },
      ],
      nodeCount: 2, cellCount: 2,
    };
    const notes = groupingNotes({ model, nodes: [mkNode('c1'), mkNode('c9')], source: ranges, ...args });
    expect(notes.orphans).toEqual(['c9']);
  });

  it('reports no orphans when nothing landed in the ungrouped bucket', () => {
    const model: GroupedModel = {
      groups: [{ key: 'rack1', nodes: [mkNode('c1')], assumed: false }],
      nodeCount: 1, cellCount: 1,
    };
    expect(groupingNotes({ model, nodes: [mkNode('c1')], source: ranges, ...args }).orphans).toEqual([]);
  });

  it('reports a declared group that matched no node, with what it claimed', () => {
    const model: GroupedModel = {
      groups: [
        { key: 'rack1', nodes: [mkNode('c1')], assumed: false },
        { key: 'rack7', nodes: [], assumed: false },
      ],
      nodeCount: 1, cellCount: 1,
    };
    const notes = groupingNotes({
      model, nodes: [mkNode('c1')], source: ranges,
      table: parseRangeTable(ranges.table), ...args,
    });
    expect(notes.emptyGroups).toEqual([{ name: 'rack7', members: ['c90', 'c91'] }]);
  });

  it('carries the table problems through', () => {
    const model: GroupedModel = { groups: [], nodeCount: 0, cellCount: 0 };
    const notes = groupingNotes({
      model, nodes: [], source: { kind: 'ranges', table: 'broken line' },
      table: parseRangeTable('broken line'), ...args,
    });
    expect(notes.problems).toHaveLength(1);
    expect(notes.problems[0]).toContain('separator');
  });

  it('has no problems and no empty groups when there is no table', () => {
    const model: GroupedModel = {
      groups: [{ key: 'p1', nodes: [mkNode('c1')], assumed: false }],
      nodeCount: 1, cellCount: 1,
    };
    const notes = groupingNotes({
      model, nodes: [mkNode('c1')], source: { kind: 'label', label: 'partition' }, ...args,
    });
    expect(notes.problems).toEqual([]);
    expect(notes.emptyGroups).toEqual([]);
  });

  it('stays quiet about coverage when the multi-value partition fan-out placed every node', () => {
    // buildGroups does not run every node through the key function: the
    // fan-out for a multi-value label places nodes straight from
    // node.partitions. A coverage check that re-derived "how many did the
    // active source place" with makeKeyFn over `label: partition` found
    // nothing placed — node.labels never carries `partition` — and
    // recommended `rack` even though the panel had already drawn every node.
    // This model reproduces that fan-out through buildGroups itself, not by
    // hand-asserting the count.
    const withRackAndPartitions = (name: string, rack: string): SlurmNode => ({
      name, state: 'idle', partitions: ['cpu', 'debug'], labels: { rack }, facets: { gres: [] },
    });
    const nodes = [
      withRackAndPartitions('c1', 'r1'), withRackAndPartitions('c2', 'r1'),
      withRackAndPartitions('c3', 'r2'), withRackAndPartitions('c4', 'r2'),
      withRackAndPartitions('c5', 'r3'), withRackAndPartitions('c6', 'r3'),
    ];
    const source = { kind: 'label', label: 'partition' } as const;
    const model = buildGroups(nodes, source, { multiValueLabel: true });

    const notes = groupingNotes({ model, nodes, source, ...args });
    expect(notes.orphans).toEqual([]);
    expect(notes.suggestion).toBeUndefined();
  });
});
