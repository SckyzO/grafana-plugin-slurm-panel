# Blade density in the rack layout

**Status:** design approved, not implemented
**Scope:** the panel's rack layout only. No change to the group model, to
ingest, or to any grouping source.

## The problem

The rack layout draws one sled per node. A cabinet whose chassis hold four
nodes each is therefore drawn four times taller than it stands, and a rack of
forty nodes needs forty rows on screen to show what occupies ten slots.

## What a blade is, and what it is not

A blade is **N nodes in a row**, N between 1 and 8. That is a deliberate
simplification of the hardware, agreed with the maintainer:

- 1 is a single-node server in its own slot, and it is the truth for most
  clusters. It is also the default, so the default draws exactly what the
  panel draws today.
- 2, 3 and 4 are the duo, triple and quad chassis this is being built for.
- A 4U chassis holding two nodes on top and two below is **out of scope**.
  Modelling it needs a per-chassis geometry rather than a count, and once
  that door is open so are orientation and half-width sleds — which is a
  DCIM tool, not a Grafana panel.

The consequence of the simplification is worth stating plainly, because it is
the whole reason this design is shaped the way it is: **a count cannot
describe a chassis in general.** It happens to describe the row-of-N case
exactly, and it describes nothing else. That is the same trap this project
has already walked into twice — an invented `rack` label, and `c[1-40]` read
as RE2 — where something is right by accident on the simple case and silently
wrong on the real one. The design below is arranged so that the panel only
ever draws a blade it was told about.

## Where the information comes from

From the reader, declared in the panel's options. Nowhere else.

`slurm_exporter` reads `sinfo`, and `sinfo` has no concept of a chassis. There
is no label to read and no query to write. This is the same position the
panel takes on topology everywhere else: **it is never the source, it consumes
what it is told and names what it cannot resolve.**

A label source — a `blade="4"` put there by Prometheus relabelling, the way
`rack` can be — is deliberately **not** part of this design. The declaration
below already scales to any cluster in two lines, so a label would add a
second surface for no reach. It can be added later without breaking anything.

## The options

Two, in the **Layout** category, both hidden by `showIf` when the layout is
Wrap, because a blade means nothing outside a cabinet. This is the first use
of `showIf` in this panel.

### Nodes per blade

A native slider, `path: 'nodesPerBlade'`, 1 to 8, default **1**.

The default is not a disguised off switch. "One node per blade" is a true
statement about most clusters, and the drawing it produces is exactly the
drawing the panel produces today — so a reader who never opens this option
sees no change of any kind.

### Nodes per blade, by group

A textarea, one line per declaration, overriding the slider for the groups it
names. The Grafana option builder has no textarea, so this is an
`addCustomEditor` rendering `<TextArea>` from `@grafana/ui`, the same
construction the Grouping > Ranges table already uses.

```
rack[1-120]: 2
rack[121-125]: 3
gpu1: 4
```

**The left-hand side is a hostlist of group names.** That is what makes this
usable on a real floor: 125 racks are two lines, not 125. It reuses
`expandHostlist()` unchanged — brackets, comma-separated ranges, and zero
padding all behave as they already do in the Ranges table, and a name with no
brackets is itself.

Note the inversion against Ranges, and say it in the user documentation: a
Ranges line is `rack1: c[1-40]` — one name on the left, a hostlist of *nodes*
on the right — while a blade line is `rack[1-120]: 2` — a hostlist of *groups*
on the left, a count on the right. In both the left says who and the right
says what, but a reader who knows one will look for the other's shape.

### A mixed rack is declared as two racks

A cabinet that physically mixes a duo blade and a quad blade cannot be
described by one count, and this design does not try. The escape hatch costs
nothing and needs no code: **declare it as two logical racks.** Four racks of
duos and a fifth of triples is five groups, each homogeneous, each with its
own count.

A group left undeclared falls back to the slider, and a slider left at 1
draws a vertical stack — which makes no horizontal claim at all, and is
therefore never wrong about where a machine sits. A rack nobody can describe
is drawn the way it is drawn today rather than drawn wrongly.

## The rendering

`RackFrame` is today a `flex` column-reverse, nowrap, one full-width sled per
node. It becomes `flexDirection: 'row'` with `flexWrap: 'wrap-reverse'`:
rows fill left to right, and `wrap-reverse` reverses the cross axis so the
**first row sits at the bottom**, which is how a cabinet is read. Node 1 stays
at the foot of the rack.

Three geometry decisions, each with its reason:

**A row's height does not change with density.** A blade occupies one slot
whether it carries one node or four. This is the whole point: a rack of forty
nodes in quads becomes ten rows rather than forty, and fits on a screen.

**Every rack keeps the same width, computed from the densest blade in the
panel rather than its own.** A floor plan whose cabinets have different widths
does not read as a floor plan. A duo's sleds are simply wider than a quad's —
which is also true of the hardware. So `rackWidthFor` gains the panel-wide
maximum as an argument, and sled width is derived per group:

```
rackWidth   = max(40, cellWidth * max(4, maxBladeInPanel))
sledWidth   = floor((rackWidth - 8 - (n - 1) * 2) / n)
sledHeight  = sledHeightFor(cellWidth)     // unchanged
```

The two constants are the cabinet's own, not the reader's: `8` is
`theme.spacing(0.5)` of padding on each side and `2` is the frame's fixed
inter-sled gap, both already in `RackFrame`. Neither is `options.gap`, which
belongs to the wrap layout and must not be reached for here. With the default
`nodesPerBlade` of 1, `max(4, 1)` is 4 and `rackWidth` is `max(40, cellWidth *
4)` — the expression the panel uses today, unchanged, which is what makes the
default drawing bit-for-bit the current one.

**A sled squeezed under the legibility floor is reported, not silently
shrunk.** At the default cell width of 14 a quad leaves each node about 10px,
which is the floor the Cell width option already names. The panel says so
rather than drawing a hairline:

```
A blade of 4 leaves each node 10px wide in rack1. Raise Cell width.
```

This warning is collapsed the same way as the one below it. A declaration of
`rack[1-120]: 4` at a cell width too small squeezes all hundred and twenty, and
a hundred and twenty identical lines is not a warning but a wall:

```
A blade of 4 leaves each node 10px wide in rack[1-120]. Raise Cell width.
```

## Parsing, and what happens when a line is wrong

A new module, `packages/core/src/layout/blades.ts` — pure, no React. It is a
new directory because this is a rendering concern and `group/` is not.

```ts
export interface BladeProblem { line: number; detail: string }
export interface BladeTable {
  sizes: Map<string, number>;
  problems: BladeProblem[];
}
export function parseBladeTable(text: string): BladeTable;
```

The parser does not know the slider's value. Resolution happens in the panel:
`sizes.get(groupKey) ?? options.nodesPerBlade`.

Nothing here is fatal and nothing throws, exactly as in `parseRangeTable`. A
bad line is skipped and reported with its 1-based line number, so it matches
what the operator sees in the textarea:

| Line | What happens |
|---|---|
| No `:` separator | Skipped. `Line 3 has no "groups: count" separator.` |
| A count that is not an integer, or outside 1-8 | Skipped, with the bound named. |
| A group declared twice | The first declaration wins; the second is reported. |
| A hostlist that does not parse | Skipped, carrying `expandHostlist`'s own message. |

Blank lines are ignored, and `#` starts a comment to the end of the line —
both exactly as `parseRangeTable` already treats them, because a floor plan
long enough to need this option is long enough to want section headings.

`parseBladeTable` and its two types are exported from
`packages/core/src/index.ts` beside the grouping ones.

Two further warnings need the groups that were actually drawn, so they are
raised by the panel rather than the parser:

**A declared group that is not drawn.** This is where scale bites a second
time: `rack[1-120]: 2` against a query that returned twenty racks would be a
hundred warnings. They are collapsed with `collapseHostlist()`, which already
exists for this purpose:

```
Nodes per blade named 100 groups that are not drawn: rack[21-120].
```

One line, not a hundred.

**A sled under the legibility floor**, as above.

Both reach the strip through the existing `summarise()`, which already caps
the whole strip at eight lines and appends `and N more warnings.`

## Testing

**The headline is non-regression.** With `nodesPerBlade` at 1 and no
overrides, the panel must draw exactly what it draws today. The proof is that
the existing rack tests stay green **without being edited** — a test written
for the occasion would prove less.

- **Core, `blades.test.ts`** — hostlist on the left-hand side, zero padding, a
  bare name with no brackets, a duplicate group, a count out of bounds, a
  non-integer count, a missing separator, blank and comment lines.
- **Geometry, `rackGeometry.test.ts`** — sled width for n = 1..4 at several
  cell widths; two racks of different density resolving to the *same* rack
  width, which is what proves the panel-wide maximum is used rather than the
  group's own; the legibility floor being detected.
- **Component, `NodeGroup.test.tsx`** — eight nodes at four per blade produce
  two rows, asserted on geometry rather than on a count of cells, because
  there are still eight cells either way; and a group carrying an override
  beside a group that does not, **with different values**, so that swapping
  the two fails. A fixture where both are equal would hide the swap, which is
  how a width/height inversion survived review earlier on this project.
- **E2E** — one provisioned panel declaring `rack[1-4]: 4`, asserted with
  `getBoundingClientRect()`, the only check that distinguishes "laid out this
  way" from "present in the DOM". The dev fixture suits it: 240 nodes over six
  racks of forty gives ten rows, and the group names `rack[1-4]` and
  `gpu[1-2]` exercise the hostlist for real rather than on a contrived name.

## Out of scope, deliberately

- A 2x2 chassis, and any chassis that is a shape rather than a count.
- A label or query as a source of density.
- A per-group *list* of blade sizes (`rack3: 2,4,4`), which would describe a
  mixed rack exactly. `rack1: 4` is the degenerate case of such a list, so
  this is a forward-compatible extension rather than an alternative, and the
  two-logical-racks escape hatch may mean it is never wanted.
- The legibility of a panel drawing 125 cabinets at once. That is a limit of
  the panel today; density neither causes it nor cures it.
