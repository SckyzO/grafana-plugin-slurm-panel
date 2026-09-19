# Cabinet height in the rack layout

**Status:** implemented, shipped in 0.1.0
**Scope:** the panel's rack layout only. No change to the group model, to
ingest, to any grouping source, or to the wrap layout.

## The problem

Cabinets are drawn at whatever height their contents need, and the row aligns
them at the top, so a rack holding twenty nodes hangs above the floor next to
one holding forty.

This is an inconsistency in the blade-density design rather than a defect it
introduced. That design argues every cabinet must share a **width**, because a
floor plan whose cabinets differ in width does not read as a floor plan, and
then leaves **height** free. The same argument covers both.

It predates blades (two racks of different sizes already drew at different
heights) and blades amplify it, since a cabinet of quads becomes short while
one of duos stays tall.

Every demonstration hides it: all six racks in the dev fixture hold exactly
forty nodes, so every screenshot shows six cabinets of equal height. That is
the third time on this project that a fixture more regular than reality has
masked a real defect.

## What a slot is

A **slot is one row in the cabinet**, one chassis position. It is not a node
and it is not a rack unit.

The distinction only matters once blades exist, and then it matters a great
deal. A row holds as many nodes as its blade carries, so a 42-slot cabinet
holds 42 nodes of single-node servers, 84 of duos and 168 of quads. Slots
are the unit that stays true when the hardware inside changes, which is
exactly the property a height needs: a 42U cabinet is a 42U cabinet whether it
is filled with single-node servers or with quad chassis.

Declaring a height in **nodes** would have the opposite property. On a floor
where every cabinet is physically identical but the blades differ, a capacity
in nodes would draw them at different heights, reintroducing the defect this
design exists to remove.

On any cluster that never leaves `Nodes per blade` at 1, which is most of
them, the two units coincide and the distinction costs nothing.

## The word was freed before it was used

"Slot" already meant two other things here: the binding of a data role to a
query `refId` (`options.slots`, `SlotBindings`) and a drawn grid position
(`GroupedModel.slotCount`, and the `40 nodes drawn in 38 slots` warning). The
second was visible to operators, in the same warning strip these new lines
land in.

Both were renamed first, in their own commits, before this design claimed the
word: `cellCount` for the drawn position, whose doc comment already read "Cells
drawn", and `QueryBindings` / `options.queries` for the bindings, whose
option label has always read "State query". Renaming a stored option path
stops being free at publication, so the window for the second one closed with
this release.

## The rule

> **A declaration wins. What is not declared levels to the tallest cabinet on
> the floor.**

For each drawn group:

| Case | Height |
|---|---|
| The group appears in the Slots-per-rack table | its declared slot count |
| The table is silent and `Slots per rack` is set | that number |
| Neither | the tallest cabinet in the panel, declared **or** filled |

The third case is the default, and it is a deliberate change of default
behaviour: a reader who never opens either option sees cabinets standing on a
common floor where today they hang from the ceiling. It is justified by parity
with width, which is already levelled panel-wide by the densest blade without
anyone asking for it, and it costs no vertical space: the row already
reserves the height of its tallest cabinet.

The corollary is intentional: a group declared `rack2: 20` **stays** at twenty
slots and is drawn shorter than its neighbours. A declaration is an assertion
about the hardware, and the panel honours it rather than overriding it with a
levelled guess.

Levelling is panel-wide, not per wrapped row, for the same reason the shared
width is panel-wide. A floor plan whose second row of cabinets is a different
height from the first does not read as a floor plan either.

## The options

Both are rack-only (`showIf: (options) => options.layout === 'rack'`) and both
mirror the blade options exactly, because an operator who has understood
`Nodes per blade` and its table has already understood these.

```ts
slotsPerRack?: number;   // optional; absent means "not declared"
slotOverrides: string;   // default ''
```

### Slots per rack

An optional number, wired the way `Cell height` already is: `addNumberInput`
with a `placeholder` and **no** `defaultValue`, so an empty field is a real
state rather than a sentinel value. `0` is not a true statement about any
cabinet and is not used to mean "off".

```
Slots per rack        [ 42        ]   placeholder: auto
```

Description: *Leave empty to level every cabinet to the tallest one drawn.*

### Slots per rack, by group

A textarea, `addCustomEditor` with `<TextArea>` from `@grafana/ui`, because
`addTextAreaInput` does not exist on `PanelOptionsEditorBuilder`. One line per
declaration: a Slurm hostlist of **group** names, a colon, a slot count.

```
rack[1-120]: 42
rack[121-125]: 47   # the row we inherited
```

The hostlist is on the left rather than the right. That is the mirror of the
Ranges table, and it is what makes a floor of 125 cabinets two lines instead
of 125.

## Parsing, and what happens when a line is wrong

`parseSlotTable` lives in `packages/core/src/layout/slots.ts` and is a
line-for-line sibling of `parseBladeTable`: nothing throws, nothing is fatal, a
bad line is skipped and reported against its own 1-based line number, and `#`
comments run to end of line. A table that blanks the whole panel on one typo
cannot be edited in a textarea.

```ts
export const MIN_SLOT = 1;
export const MAX_SLOT = 64;

export interface SlotProblem { line: number; detail: string }
export interface SlotTable { slots: Map<string, number>; problems: SlotProblem[] }

export function parseSlotTable(table: string): SlotTable;
```

`MAX_SLOT` is 64 because it sits above any cabinet that exists (the tallest
standard rack is 60U) and because a bound is what stops a typo turning one
cabinet into a column of a thousand rows.

The problem strings are load-bearing; tests assert them verbatim:

- `Line ${line} has no "groups: count" separator.`
- `Line ${line} is missing a count.`
- `Line ${line} ("${countText}") is not a whole number of slots.`
- `Line ${line} asks for ${count} slots; the range is ${MIN_SLOT} to ${MAX_SLOT}.`
- `Line ${line} ("${expr}"): ${error}.`
- `${list} ${verb} already declared above; the first declaration keeps its count.`

The duplicate-declaration list is collapsed back into a hostlist, so a
repeated `rack[1-120]` line is one problem rather than a hundred and twenty.

## The rendering

### The height arithmetic

No `align-items: stretch`. The frame is given an **explicit height**, computed
in `rackGeometry.ts` exactly as its width already is, so the property can be
asserted as plain arithmetic by a test runner with no layout engine.

```
frameHeight(rows, cellHeight) =
    content = rows <= 0 ? 0
                        : rows * cellHeight
                          + (rows - 1) * RACK_GAP
    max(MIN_FRAME_HEIGHT, content + RACK_PADDING * 2 + RACK_BORDER * 2)
```

The padding and border terms are present for the same reason they are present
in `sledWidthFor`: the app runs under `box-sizing: border-box`, so an explicit
`height` includes both. Leaving the border out of the width formula is what
let a sled overflow the frame by exactly two pixels, undetected by ninety-seven
unit tests, a screenshot suite and an e2e suite. This is the same trap on the
other axis.

Unlike the width, the height has no `floor()` on the row content, so every
term of that part of the formula is visible in the result and a literal
assertion detects a missing one.

The result never falls below `MIN_FRAME_HEIGHT`, 24 pixels, which is
`theme.spacing(3)`, so a cabinet with one node, or none, is still a cabinet
rather than a hairline. That floor lives in the arithmetic rather than in
`RackFrame`'s stylesheet on purpose: a CSS `min-height` is a second path to
the frame's height that `layoutSlots` cannot see, and a one-row cabinet
rendered at 24 inside a band sized at 17 would overflow the band this design
exists to seat it in.

### The band, and why declared-shorter cabinets still stand on the floor

Explicit heights that legitimately differ would reintroduce the original
defect under `alignItems: 'flex-start'`: a cabinet declared at twenty slots
would hang from the top of the row.

Each cabinet is therefore drawn inside a **band** of one shared height, with
the frame aligned to the band's bottom:

```
bandRows   = max over drawn groups of max(slotsOf(key), rowsNeeded(key))
bandHeight = frameHeight(bandRows, cellHeight)
```

The band exists only in the rack layout; the wrap layout draws no cabinet and
is untouched by any of this. Group headers then align because every group is
the same total height, and every cabinet sits on a common floor. `bandRows` counts overflow as well as
declared slots, so a cabinet that spills past its declaration has room to do
so by construction rather than by luck.

### Where the layout lives

A new `layoutSlots` sits **beside** `layoutBlades` in
`plugins/nodegrid-panel/src/components/rackGeometry.ts`, not inside it. It
consumes the `BladeLayout`, since it needs each group's blade to convert nodes
into rows, and that dependency is explicit in its input rather than hidden in a
merged function. Two pure functions, each testable alone, and no rename
cascading through `NodeGroup`, `RackFrame` and their tests.

```ts
export interface SlotLayoutInput {
  /**
   * The groups the panel is actually drawing, in draw order, each with its
   * node count: one structure rather than a key list beside a count map.
   * Two structures that must cover the same keys, with nothing forcing them
   * to, is how a `?? 0` ends up drawing a silently empty cabinet.
   */
  groups: Array<{ key: string; nodes: number }>;
  /** Resolved blade layout, for sizeOf. */
  blades: BladeLayout;
  /** Declared group name to slot count, from parseSlotTable. */
  declared: Map<string, number>;
  /** The panel-wide Slots per rack, where the table is silent. Absent means level. */
  fallback: number | undefined;
  cellHeight: number;
}

export interface SlotLayout {
  /** Shared by every cabinet, so headers align and cabinets share a floor. */
  bandHeight: number;
  /** Rows the frame is drawn at, per drawn group. */
  slotsOf: Map<string, number>;
  /** Frame height in pixels, per drawn group. */
  heightOf: Map<string, number>;
  /** Declared groups the panel is not drawing. */
  undrawn: string[];
  /** Drawn groups whose content needs more rows than the frame has. */
  overflowing: Array<{ key: string; needed: number; declared: number }>;
}

export function layoutSlots(input: SlotLayoutInput): SlotLayout;
```

Resolution order:

1. `rowsNeeded(key) = ceil(group.nodes / blades.sizeOf(group.key))`
2. `declaredFor(key) = declared.get(key) ?? fallback`, which may be `undefined`
3. `panelRows = max over drawn groups of (declaredFor(key) ?? rowsNeeded(key))`
4. `slotsOf(key) = declaredFor(key) ?? panelRows`
5. `heightOf(key) = frameHeight(slotsOf(key), cellHeight)`
6. `overflowing` collects every key where `rowsNeeded(key) > slotsOf(key)`

Step 3 is what makes an undeclared cabinet level to a *declared* neighbour as
well as to a filled one. It also yields an invariant worth stating, because it
bounds the overflow case: a levelled group takes `panelRows`, which is at
least its own `rowsNeeded`, so **only a group with an effective declaration,
a table entry or the panel-wide number, can overflow.**

`undrawn` is computed the way `layoutBlades` computes it: a declaration for a
cabinet the query did not return is worth saying, and must not change the
height of the ones it did, so only drawn groups feed `panelRows`.

### Overflow

The declared height is set as `height`, not `min-height`. The frame fills from
the bottom (`flex-wrap: wrap-reverse` with `align-content: flex-start`), so
rows that do not fit render past the cross-end, which is the **top**, outside
the frame's border. That is the drawing that was chosen over truncating and
over growing in silence.

Truncating was rejected outright: this is a supervision panel, and a node that
exists but is not drawn is a node nobody is watching. It turns a stale table
into a silent blind spot. Growing in silence was rejected because a cabinet
that is taller than declared then looks like a declaration rather than an
anomaly.

Overflow is **unbounded by design**, and that is the price of refusing to
truncate. A group declared at ten slots whose query returns two hundred rows
makes `bandRows` two hundred, so every cabinet's band, and the panel, grows
to match. The drawing is then ugly and the warning says why, which is the
correct order: a panel that is hard to look at because the declaration is
wrong beats a panel that looks right by hiding nodes.

Two properties here cannot be seen by any unit test and must be verified in a
real browser before the work is called done:

1. that the overflow renders **above** the frame rather than below it, and
2. that it does not paint over the group header. `bandRows` is intended to
   reserve the room, and that intent has to be confirmed against a rendered
   page, not asserted from the formula that produced it.

## Warnings

`summarise` gains a **sixth optional parameter**, leaving its twenty-eight
existing call sites untouched:

```ts
export interface SlotNotes {
  problems: string[];
  undrawn: string[];
  overflowing: Array<{ key: string; needed: number; declared: number }>;
}

export function summarise(
  model, warnings, unmapped, grouping,
  blades?: BladeNotes,
  slots?: SlotNotes,
): string[];
```

A sixth positional parameter is the conservative choice rather than the
elegant one. Folding parameters five and six into a single `rack` object would
read better and was considered; it was rejected because it churns working
blade code and its tests for no user-visible gain. If a seventh ever appears,
that collapse is the right move then.

Lines are emitted only in the rack layout, as the blade lines already are:
warning about a table nobody can see is warning about nothing.

- the parser's problems, one per bad line
- `Slots per rack named ${n} groups that are not drawn: ${list}.`
- `${list} ${verb} ${needed} slots but ${declared} were declared.`

The overflow line groups entries by their `(needed, declared)` pair and
collapses the names into a hostlist, the way the squeezed-sled line groups by
blade size. `verb` is `needs` for a single name and `need` for several:

```
rack1 needs 45 slots but 42 were declared.
rack[7-9] need 12 slots but 10 were declared.
```

The message is stated in slots on both sides rather than in nodes, so it stays
in the unit the option is written in. Under quads, "45 nodes but 42 slots"
would be arithmetic the reader has to redo; "12 slots but 10" is the
comparison the panel actually made.

## Testing

- **`packages/core/test/slots.test.ts`**: the parser, including every problem
  string verbatim. The path matters: `packages/core/jest.config.js` sets
  `testMatch: ['<rootDir>/test/**/*.test.ts']`, so a test written under `src/`
  is never run and passes silently.
- **`rackGeometry` unit tests**: `layoutSlots` resolution, the levelling rule,
  the declared-wins rule, and the only-declared-can-overflow invariant. At
  least two **literal** height assertions, chosen so that dropping any term of
  the formula changes the number: at `cellHeight` 7, `frameHeight(4, 7)` is 44 and
  `frameHeight(1, 7)` is 17. A suite whose every expectation is computed by the
  formula under test cannot detect an error in that formula, which is precisely
  how the two-pixel width defect survived.
- **A browser test** for the two overflow properties above, reading geometry
  back off the rendered element rather than recomputing it, the same idiom as
  the test that pinned the border fix.
- **e2e**: the provisioned blades panel gains a slot declaration, so the
  mixed-blade floor is also a mixed-height floor. The dev fixture's six
  identical racks are what hid this defect; the regression suite should not
  inherit that regularity.

## Out of scope, deliberately

- **Rack units.** A slot is a chassis position, not a U. A 2U quad chassis
  occupies one slot here and two U in the cabinet. Modelling U would mean
  per-chassis heights, and that is a DCIM tool rather than a Grafana panel,
  the same boundary the blade design drew when it refused 2-above-2.
- **Reserved slots.** Switches, PDUs and blanking panels are not nodes, the
  exporter does not publish them, and the panel does not invent them. A
  cabinet declared at 42 slots holding 40 nodes shows two empty rows, and
  which two is not something the panel knows.
- **Where a cabinet stands.** Aisles, rows and floor coordinates are the next
  rung of topology and belong to whoever owns the inventory, not to the panel.
- **Per-slot labels.** No ruler down the side of the cabinet. If it is needed,
  it is a separate change with its own argument.

## Revision (2026-09-18)

Read back against the implementation before tagging 0.1.0.

| Was | Is |
|---|---|
| `**Status:** design approved, not implemented` | Implemented. `packages/core/src/layout/slots.ts`, `layoutSlots` in `rackGeometry.ts`, and the e2e block `cabinet height, against the same live data` |
| `frameHeight` adds `RACK_BORDER * 2` | The vertical chrome is asymmetric: `RACK_PADDING * 2 + RACK_BORDER + RACK_FOOT`, because the cabinet's foot is heavier than its top edge. The width formula is the symmetric one; this axis is not |
| "a 42-slot cabinet holds 42 nodes of duos on 21 slots, or 160 nodes of quads on 40 slots" | 42 slots hold 42 nodes of single-node servers, 84 of duos and 168 of quads. The old sentence mixed a cabinet's capacity with the slots a fixed node count needs |

## Revision (2026-09-19)

The dev fixture changed shape, which retires this document's own opening
complaint.

| Was | Is |
|---|---|
| "all six racks in the dev fixture hold exactly forty nodes, so every screenshot shows six cabinets of equal height" | The fixture is 540 nodes over nine cabinets, each holding twenty slots times its blade density: 80 in quads, 60 in triples, 40 in duos, 20 in single-node servers. Equal height is now the *correct* drawing, not a demonstration gap |
| The declared-height demonstration lives on the blades panel, which declared twelve slots against twenty-four | It has its own panel, `Two declared heights, one floor` (id 10 of the grouping dashboard): twenty slots against twenty-six, over cabinets that both draw twenty rows. The blades panel is level and full, because that is what the hardware it describes looks like |

The old arrangement made the compute cabinets read as half empty. They were:
forty nodes in a quad-blade cabinet occupy ten slots, and a cabinet holding a
quarter of what it can take is a half-empty cabinet drawn faithfully. The
defect was in the fixture's arithmetic, not in the rendering.
