# Slurm Node Grid

[![Release](https://img.shields.io/github/v/release/SckyzO/grafana-plugin-slurm-panel?logo=github&label=release)](https://github.com/SckyzO/grafana-plugin-slurm-panel/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/SckyzO/grafana-plugin-slurm-panel/ci.yml?branch=main&logo=githubactions&logoColor=white&label=CI)](https://github.com/SckyzO/grafana-plugin-slurm-panel/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/SckyzO/grafana-plugin-slurm-panel)](https://github.com/SckyzO/grafana-plugin-slurm-panel/blob/main/LICENSE)

One cell per Slurm node, coloured by state (or by CPU, memory or GPU
utilisation), grouped and laid out to match how the cluster is actually
organised, rather than by counting Prometheus series.

`slurm_exporter` publishes one series per `(node, partition)` pair, so a node
in three partitions appears three times to any panel that just counts
series. This panel groups by node identity first, and says how many distinct
nodes and how many drawn cells that produced whenever the two numbers
disagree.

![Nine cabinets, one sled per node, coloured by Slurm state](https://raw.githubusercontent.com/SckyzO/grafana-plugin-slurm-panel/main/plugins/nodegrid-panel/src/img/node-grid-by-rack.png)

## Requirements

- **Grafana 12.3 or later.** The panel is built against that API and the
  release is tested against every minor from 12.3 to the current nightly.
- **A data source that returns one series per node**, with the node name and
  the Slurm state as labels. Prometheus scraping
  [`slurm_exporter`](https://github.com/SckyzO/slurm_exporter) is the case
  every default is set for; anything shaped the same works, and the label
  names are options.
- **No backend, no configuration file, no extra permissions.** The panel is
  frontend only and reads nothing but the queries you give it.

## Getting started

Add the panel to a dashboard, point it at your Prometheus data source, and
give it one query:

```promql
slurm_node_status
```

That is enough to see the cluster. The twenty-one state rules ship with the
panel as Value mappings, so the grid is coloured before you configure
anything, and every cell names its node and state in the tooltip.

Two options are worth setting next, in this order:

1. **Grouping > Group by**, so the cells are arranged the way the cluster is.
   A `rack` label is the best case; if the exporter does not publish one,
   [`docs/grouping.md`](https://github.com/SckyzO/grafana-plugin-slurm-panel/blob/main/docs/grouping.md) covers the three
   routes to a topology and what each one costs.
2. **Layout > Rack**, which draws each group as a cabinet instead of a
   wrapping row.

Everything the panel cannot resolve, it says so in a strip above the grid
rather than hiding — see [Warnings](#warnings).

## Data

One required query, plus a set of optional named facets. Each is bound
to a query `refId`:

| Role                     | Query (default)                                     | Notes                                                      |
| ------------------------ | --------------------------------------------------- | ---------------------------------------------------------- |
| `state` (required)       | `slurm_node_status`                                 | node identity and Slurm state; drives colour in State mode |
| `cpuAlloc` / `cpuTotal`  | `slurm_node_cpu_alloc` / `slurm_node_cpu_total`     | drives colour in CPU mode                                  |
| `memAlloc` / `memTotal`  | `slurm_node_mem_alloc` / `slurm_node_mem_total`     | drives colour in Memory mode                               |
| `gresUsed` / `gresTotal` | `slurm_node_gres_used` / `slurm_node_gres_total`    | keyed by the `gres_type` label; drives colour in GPU mode  |
| `drainReason`            | `slurm_node_drain_reason_info`                      | value read from the `reason` label, shown in the tooltip   |
| `drainSince`             | `time() - slurm_node_drain_since_timestamp_seconds` | age in seconds, shown in the tooltip                       |

The label names are options too, defaulting to what `slurm_exporter` emits:
`node` for node identity, `status` for the state, and `partition`, `gres_type`
and `reason` for the rest.

The **Data** section of the panel options covers the node label, the state
label and the state query's `refId`, the required query. The optional facets
above, and the `partition` / `gresType` / `reason` label names, have no
field of their own in that editor; bind them by editing the panel's JSON
model instead (panel menu ▸ **Edit panel JSON**) or in a dashboard's
provisioning file. `dev/provisioning/dashboards/slurm-prod.json` in this
plugin's repository is a worked example: its panel's `options.queries` and
`options.labels` bind every role except the two memory facets, which the
**Memory occupancy** panel of
`dev/provisioning/dashboards/slurm-node-colour.json` shows instead.

Hovering a cell reads everything the panel joined for that node, whichever
facets the queries bound:

![A tooltip over one cell: the hostname, then its state, partitions and CPU allocation, then how long it has been drained and why](https://raw.githubusercontent.com/SckyzO/grafana-plugin-slurm-panel/main/plugins/nodegrid-panel/src/img/node-grid-tooltip.png)

## Grouping

`slurm_exporter` publishes no rack or location label of any kind. It reads
`sinfo`, which has no concept of one, so no configuration on this side ever
produces one by itself. There are three ways to still get a real topology,
and what decides which one you can reach for is the privilege you hold, not
which is more elegant:

- **Relabel at scrape time**, if you administer the Prometheus behind this
  panel. The label then works in alerting, recording rules and every other
  dashboard, not only this one. If you write that rule by hand, do not
  reach for `sinfo`'s own range notation: Prometheus compiles a relabelling
  `regex` as RE2, where `c[1-40]` does not mean "c1 through c40". It means
  "c, followed by one of the characters 1, 2, 3, 4 or 0". That is right by
  accident on `c[1-5]` and silently wrong from `c[1-10]` onward, with
  nothing to say so. Write an expanded alternation of literal node names
  instead.
- **Join an inventory** onto the metric frame with Grafana's own
  transformations, if you only have Editor on the dashboard. This needs
  nothing upstream of Grafana.
- **Write a range table**, below, if you want the layout to live in the
  dashboard itself rather than anywhere upstream of it.

The full recipe for each, including the exact transformation chain the
join needs, is in this repository's `docs/grouping.md`.

**Grouping > Group by** groups nodes from one of four sources:

- **Label**: a label the data already carries, e.g. `partition`, or a rack
  label once one of the routes above has put one there.
- **Capture**: the first capture group of a regular expression run against
  the node name (`^(r\d+)` groups `r012n03` under `r012`). This only
  recovers structure the node name already spells out; it invents nothing
  that is not literally in the name.
- **Ranges**: a table you write by hand, one line per group, in Slurm
  hostlist syntax: `name: hostlist`. For example:

  ```
  rack1: c[1-40]
  rack2: c[41-80]
  ```

  Line order is display order: the table is the only place you get to say
  what order a machine-room floor is actually in, since it is rarely
  alphabetical. The value can be a dashboard variable instead of a literal
  table, so several panels can share one layout and it can be edited in one
  place. See `docs/grouping.md` for the full syntax.

- **Chunk**: bands the node ordinal — the trailing number in the name — into
  fixed-width slices. At 8, ordinals 1-8 make the first group, 9-16 the
  second, and so on.

  Fixed in _width_, not in population. Two nodes whose ordinals match are in
  the same band whatever their names, so `c001` and `g001` land together and
  a cluster numbered per family rather than end to end comes out uneven — a
  floor of `c001-c024` and `g001-g008` at size 8 gives groups of 16, 8 and 8,
  not four of 8. Where the numbering runs across the whole floor, which is
  the case chunking is for, the groups are even.

Chunking is the one source that invents structure the data never stated: HPC
node numbering usually follows the physical layout, but usually is not
always. Every group it produces carries an **assumed** marker, in the
grouping editor's live preview and in that group's header inside the panel
itself, so the claim travels with the data rather than staying only in the
editor.

A node that matches no group is drawn last, under a header marked
**unplaced**, inside a dashed frame, and it is named in the warnings strip.
That is deliberate: a node missing from a supervision view is a worse failure
than a node drawn in the wrong box. A range the table declares that matches no
node is the opposite problem, a box with no nodes rather than nodes with no
box: it is still drawn, empty, in its declared place, and named in the
warnings strip too.

The panel also measures whether some other label already on the data would
group the nodes more completely than the source configured today, and names
that label in the warnings strip if so. It never switches sources by
itself: a panel that reconfigured itself because a third party edited the
scrape would change behaviour with nothing in its own JSON to explain why.

**Grouping > Node may appear in several groups** draws a node once per
partition when grouping by the `partition` label, the only label this
fan-out supports, since it needs a per-node list of every value the label
takes, and the engine only builds that list for partitions.

### Showing part of the cluster

A panel for the cpu racks alone, or for one partition, is a query rather than
a panel option — `slurm_node_status{rack=~"cpu.*"}`, or
`slurm_node_status{partition="bigmem"}` — grouped by `rack` or `partition` as
usual. The grid names exactly what came back, and nothing is reported missing.

![Four cpu cabinets and nothing else, with an empty warnings strip](https://raw.githubusercontent.com/SckyzO/grafana-plugin-slurm-panel/main/plugins/nodegrid-panel/src/img/node-grid-filtered.png)

There is no "show only these groups" option, deliberately: it would hide nodes
the query returned, and a node that exists and is not drawn is a node nobody
is watching. Nodes the query never asked for are a different matter.

One thing has to follow the query: **the declaration tables**. Nodes per
blade, Slots per rack and a Ranges table each assert that those groups exist,
so one naming a cabinet the query no longer returns is reported — the same
line that catches a rack nobody plugged back in. Narrow the tables with the
query.

## Layout

**Layout** draws the grid one of two ways:

- **Wrap** (default): cells flow left to right, top to bottom.
- **Rack**: each group is drawn as a cabinet, one sled per node, stacked
  bottom to top the way a rack is actually read.

**Layout > Cell width** and **Layout > Cell height** are both in pixels.
Cell height is optional on purpose: Wrap and Rack disagree about what a
cell should look like by default, so leaving it empty derives a square in
Wrap and a sled (about half the cell width) in Rack. **Layout > Cell
gap** is the space between cells, which is what actually makes a dense grid
readable, not a border.

**Layout > Node count** prints how many nodes each group holds, under its
name. On by default, in both layouts. The group's name is always drawn; only
the count is yours to hide.

Rack mode draws each cabinet as a stack of sleds, bottom to top the way a
rack is actually read. Nodes from one physical chassis stay adjacent, since
a group's nodes are always sorted by the trailing number in their name, but
that adjacency is all Rack mode used to know about a chassis. **Nodes per
blade**, below, says how many of those adjacent nodes share one physical
chassis, so a site running quads or duos draws one row per blade instead of
one per node. **Slots per rack** says how tall the cabinet itself is, in
chassis positions: a property of the hardware, not of what is currently
plugged into it, and set separately.

**Layout > Centre the cabinets** centres the row of cabinets in the panel
instead of packing it against the left edge. Off by default, and offered only
in the Rack layout — Wrap is one column, so there is nothing to centre. Left
packing is the default because a floor plan read twice should have its
cabinets in the same place both times, and a centred row moves every cabinet
whenever the panel is resized or a group disappears from the query.

### Blades

In the Rack layout, **Nodes per blade** says how many nodes share one slot in
the cabinet. The default is 1, a single-node server, and it draws one sled
per node. Set it to 4 and a forty-node cabinet becomes ten rows instead of
forty.

**Nodes per blade, by group** overrides it for the groups it names, one line
per declaration:

```
rack[1-120]: 2
rack[121-125]: 3
gpu1: 4
```

The left-hand side is a Slurm hostlist of **group** names, so a floor of 125
cabinets is two lines. Note the mirror of the Ranges table, where the hostlist
is on the right and names nodes: here it is on the left and names groups. `#`
comments run to end of line.

Every cabinet is drawn the same width, taken from the densest blade in the
panel rather than its own, because a floor plan whose cabinets differ in width
does not read as a floor plan. A duo's sleds are simply wider than a quad's,
as they are in the hardware.

A blade here is a count of nodes in a row, and nothing else. A 4U chassis
holding two nodes above two more cannot be described by a count and is not
supported. Neither is a cabinet that mixes blade sizes within itself:
**declare it as two groups**, which costs nothing and keeps every position on
the drawing true. A group with no declaration keeps one sled per node, a
vertical stack that makes no claim about where anything sits sideways.

![A floor mixing one, two, three and four nodes to a blade, every cabinet standing on the same line](https://raw.githubusercontent.com/SckyzO/grafana-plugin-slurm-panel/main/plugins/nodegrid-panel/src/img/node-grid-blades.png)

### Cabinet height

In the Rack layout every cabinet stands on a common floor, levelled to the
tallest one drawn, unless you declare a height.

**Slots per rack** says how tall a cabinet is drawn, in slots: chassis
positions, not nodes and not rack units. A slot holds a whole blade, so a
42-slot cabinet holds 42 nodes of single-node servers and 168 of quads, which
is also true of the hardware. Leave it empty and every cabinet levels to the
tallest one drawn, so a half-full rack stands on the floor instead of hanging
from the ceiling.

**Slots per rack, by group** overrides it per group, one line per declaration,
the hostlist of group names on the left:

```
rack[1-120]: 42
rack[121-125]: 47   # the row we inherited
```

A declared cabinet keeps its height even when its neighbours are taller. A
declaration is an assertion about the hardware, and a genuinely small cabinet
stays small. A cabinet holding more than it declares is still drawn in full:
the rows that do not fit spill above the frame and the warnings strip names
it. Nothing is ever hidden, because a node that exists and is not drawn is a
node nobody is watching.

![A half-filled cabinet stands on the floor, its empty slots above it](https://raw.githubusercontent.com/SckyzO/grafana-plugin-slurm-panel/main/plugins/nodegrid-panel/src/img/node-grid-heights.png)

## Colour

**Display > Colour by** picks one encoding for the cell fill at a time:

- **State** (default): the Slurm state, coloured by the panel's own **Value
  mappings** section. Twenty-one rules are applied by default, covering every
  state in the `sinfo` man page in both its long and abbreviated spellings, so
  the grid is coloured before anything is configured. They are a default and
  not a lock: the rules appear in **Value mappings** and can be edited,
  reordered, duplicated or deleted like any other field config.
- **CPU**, **Memory**, **GPU**: a continuous fill driven by that facet's
  allocation, resolved through the panel's **Thresholds** section rather
  than a fixed colour scale.

Only one encoding is active at a time, deliberately: a cell carrying both
state and utilisation reads well at a couple hundred nodes and turns to
noise at a couple thousand. A cell always names its node and state in
words, in the tooltip and in its accessible label, regardless of which
colour mode is active, so meaning never rests on colour alone.

![GPU occupancy on the three cabinets that have GPUs, each node shaded by how much of it is in use](https://raw.githubusercontent.com/SckyzO/grafana-plugin-slurm-panel/main/plugins/nodegrid-panel/src/img/node-grid-gpu.png)

**Display > Shape channel** adds a second encoding: a notch or a diagonal cut
into the cell for the states that most need to stay visible without colour.
With it on, the grid stays readable in greyscale, in print, under
`forced-colors`, and for a red-green colour deficiency, whatever palette the
site chose.

It ships **off**, which is a trade rather than an oversight. The notches cost
a little legibility at fourteen pixels for every reader, and most readers do
not need them. Turn it on if you read with a red-green deficiency, in
greyscale, or on paper — the paragraph below says exactly which pair of states
makes that necessary.

The same floor drawn both ways — same nodes, same colours, one option apart.
A notch survives what hue does not:

**Off, the default:**

![Nine cabinets, flat fills only](https://raw.githubusercontent.com/SckyzO/grafana-plugin-slurm-panel/main/plugins/nodegrid-panel/src/img/node-grid-noshapes.png)

**On:** the drained and down cells carry a cut corner as well as a colour.

![The same nine cabinets, the drained and down cells notched](https://raw.githubusercontent.com/SckyzO/grafana-plugin-slurm-panel/main/plugins/nodegrid-panel/src/img/node-grid-shapes.png)

### The states, and the colour each one gets

Colour encodes the decision an operator makes about a node, not which of the
twenty-one states it is in. No palette separates that many at a glance. **Nine
colours, six decisions.** The hue says what to do; the shade inside a hue says
the degree, never the decision. The exact state is always spelled out in the
cell's tooltip and in its accessible label, in every colour mode.

| Default colour                                                                                                                         | Theme name        | What it decides              | States it covers                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ---------------------------- | ----------------------------------------------------------------------------------- |
| <span style="display:inline-block;width:34px;height:14px;border-radius:3px;background:#96D98D;vertical-align:middle"></span> `#96D98D` | `light-green`     | **it works**                 | `allocated`, `allocated+`, `allocated-`                                             |
| <span style="display:inline-block;width:34px;height:14px;border-radius:3px;background:#73BF69;vertical-align:middle"></span> `#73BF69` | `green`           | **it works**                 | `mixed`, `mix`, `mixed-`                                                            |
| <span style="display:inline-block;width:34px;height:14px;border-radius:3px;background:#56A64B;vertical-align:middle"></span> `#56A64B` | `semi-dark-green` | **it works**                 | `completing`, `comp`                                                                |
| <span style="display:inline-block;width:34px;height:14px;border-radius:3px;background:#5794F2;vertical-align:middle"></span> `#5794F2` | `blue`            | **capacity sitting free**    | `idle`, `idle-`                                                                     |
| <span style="display:inline-block;width:34px;height:14px;border-radius:3px;background:#8AB8FF;vertical-align:middle"></span> `#8AB8FF` | `light-blue`      | **capacity sitting free**    | `planned`, `plnd`                                                                   |
| <span style="display:inline-block;width:34px;height:14px;border-radius:3px;background:#8F3BB8;vertical-align:middle"></span> `#8F3BB8` | `dark-purple`     | **a human claimed it**       | `drained`, `draining`, `drng`, `maintenance`, `reserved`, `resv`, `npc`, `perfctrs` |
| <span style="display:inline-block;width:34px;height:14px;border-radius:3px;background:#FF9830;vertical-align:middle"></span> `#FF9830` | `orange`          | **not answering, or moving** | the `*` suffix, `blocked`, `reboot`                                                 |
| <span style="display:inline-block;width:34px;height:14px;border-radius:3px;background:#C4162A;vertical-align:middle"></span> `#C4162A` | `dark-red`        | **broken**                   | `down`, `fail`, `unknown`, `invalid`                                                |
| the theme's own ink                                                                                                                    | `text`            | **absent from the floor**    | the `~` suffix, `power_down`, `powering_up`, `future`, `futr`                       |

`future` and `futr` are one state under two spellings, both matched by a single rule: a node declared
in `slurm.conf` that does not exist yet, pre-defined so it can be brought into service later without
restarting the controller. Grey for the same reason `powered_down` is — there is nothing on the floor.

Hex values are the dark theme's. Every colour is a Grafana theme name rather
than a literal, so a light theme or a custom one resolves its own value and the
panel follows the dashboard around it.

**Why green rises and red darkens.** Protanopia and deuteranopia collapse the
red-green axis and keep light against dark. Measured on this theme, `green`
against `red` is ΔE 32 to a full-colour reader and **4.6** to a deuteranope,
while `light-green` against `dark-red` is 32 and **25**. A working node and a
broken one are the one pair nobody can afford to confuse, so what works is
drawn light and what is broken is drawn dark. Green also brightens as a node
fills, which puts the commonest state of a busy cluster at the highest contrast
against the background.

**Six hues are not enough on their own.** `not responding` against `allocated`
measures 4.8 under protanopia and no rearrangement of this palette fixed it,
which is why **Shape channel exists**. The shape is not a second
alphabet for all twenty-one states. It marks the two families the fill could
not be trusted to separate, cutting the top-right corner of `not responding`,
`drained` and `maintenance` and the bottom-right corner of `down` and `powered
down`. Every other state is drawn as a plain square. Turning it on is a choice
a reader makes; nobody else's grid changes.

**The shape reads the mapped text, not the raw state, and it is a
case-sensitive match.** That is worth knowing before you rename anything in
the colour table above: a rule whose result reads `Drained` rather than
`drained` loses its notch, and a healthy state relabelled to something
containing `down` gains one. Nothing warns about it, because from the panel's
side a renamed label is a legitimate choice. If you rely on the shape channel,
treat the wording of those rules as part of the encoding rather than as a
caption.

`sinfo` appends one of nine flags to a state: `*` not responding, `~` powered
off, `#` powering up, `!` pending power down, `%` powering down, `$`
reservation maintenance, `@` pending reboot, `^` reboot issued, and `-`
planned by the backfill scheduler. The two that mean the node cannot run work
at all, `*` and `~`, are matched first and override the state. The other
seven leave the state readable and are absorbed by the trailing `.*`, which is
why one rule covers `idle`, `idle#` and `idle@` together. `-` keeps its own
rule so the label can say "backfill", and shares its family's colour because an
operator does not act differently on a backfilled node.

![Every Slurm state the panel ships a rule for, each drawn in its colour](https://raw.githubusercontent.com/SckyzO/grafana-plugin-slurm-panel/main/plugins/nodegrid-panel/src/img/node-grid-states.png)

### Adding or changing a state

Everything lives in Grafana's standard **Value mappings** editor, the same one
every other panel uses, with drag handles to reorder, a colour picker per row,
duplicate and delete, and **Add a new mapping**. Nothing about state colour is
configured in this panel's own options, deliberately: value mappings are where
Grafana puts this, and a second mechanism would be invisible to field
overrides, to provisioning, and to anything else reading the dashboard JSON.

The editor offers four condition types. Two matter here:

- **Value**: an exact match. Enough when you do not care about flags:
  `blocked` → your text and colour.
- **Regex**: needed to cover a state together with its flags. Write it
  delimited and spanning the whole value: `/^blocked.*$/`.

Order matters: a rule for a state with a flag must come above the rule that
would otherwise swallow it, which is why `/^idle.*-$/` sits above `/^idle.*$/`.

Two ways of writing a regex rule fail silently, and neither is visible from the
editor. A bare pattern such as `^idle` is wrapped in `^...$` by Grafana and
becomes an exact match, so `idle*` falls straight through it. Delimit it with
slashes. And a regex mapping replaces the matched portion rather than labelling
the value, so `/^drain/ → drained` renders `drained` as `draineded`. Make the
pattern span the whole value with a trailing `.*$`.

You do not have to remember any of that. When the panel meets a state no rule
covers, it names the state in its warnings strip **and prints the rule to
paste**, correctly delimited, spanning the value, and escaped:

```
2 states matched no value mapping: blocked, completing (11 with flags)
Fix: Value mappings ▸ Regex, one per state, e.g. /^blocked.*$/
```

## Data links

Set a data link under the panel's own **Data links** section to make a cell
open a node dashboard on click. The link URL can use two template variables,
interpolated per node before navigation:

- `${__node}`: the node name.
- `${__state}`: the node's raw Slurm state.

Example: `/d/some-dash?var-node=${__node}&var-state=${__state}`.

Only the first configured data link is followed; a cell with no link
configured is not clickable.

## Scale

The panel draws one cell per node regardless of how many the query returns;
there is no built-in cell-count warning or cutoff. **Grouping** is what
keeps a very large cluster legible: splitting the grid into named boxes
reads better than one long wrap or one very tall rack once a cluster passes
a few hundred nodes.

## Warnings

A strip above the grid names, rather than hides, anything the panel could
not fully resolve:

- a query skipped for carrying no node identity;
- states that matched no value mapping (capped at eight named, then
  `and N more`), together with the exact rule to paste under Value mappings
  to fix it;
- nodes the active grouping source could not place, drawn under
  `ungrouped` and why, e.g.
  `3 nodes matched no range: c[41-43]. Drawn under "ungrouped".`;
- a declared range that matched no node, drawn empty in its place, e.g.
  `Range "rack5" matched no node: r[501-502].`;
- a label that would group the data more completely than the source
  configured today, e.g.
  `Label "rack" would group all 540. Grouping > Group by > Label.`
  It is measured, never acted on; the panel does not switch sources by
  itself.

![A warnings strip naming 460 unplaced nodes above a grid that still draws every one of them](https://raw.githubusercontent.com/SckyzO/grafana-plugin-slurm-panel/main/plugins/nodegrid-panel/src/img/node-grid-unplaced.png)

Four kinds of label are never proposed, however well they would score, so
their absence from that line is not a bug:

| Never proposed                                                | Why                                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| The **node label**                                            | One group per node is not a grouping.                                          |
| The **state label**                                           | It regroups the grid on every scrape.                                          |
| Any label with **as many distinct values as nodes it covers** | An identity in a different costume: `reason` on a set of drained nodes is one. |
| Any label with **fewer than two distinct values**             | One group for everything, which would win on coverage every single time.       |

Grouping set to **None** is also silent: it is a choice, not a failure to
group. And a label speaks only when it would place _strictly more_ nodes than
the active source does. One that merely ties says nothing.

A state matching no mapping keeps its raw text; Grafana would colour it with
the threshold base colour (green, by default) rather than a mapped one, so
the cell deliberately refuses that colour and draws a hollow ring instead.

## In a dashboard

The panel is a floor plan, not a summary: it sits below the counters rather
than replacing them, and answers the question they raise — _which_ nodes, and
_where_.

![A production dashboard: gauges and counters above, the floor plan and a table of drain reasons below](https://raw.githubusercontent.com/SckyzO/grafana-plugin-slurm-panel/main/plugins/nodegrid-panel/src/img/node-grid-dashboard.png)

## Documentation

- [`docs/grouping.md`](https://github.com/SckyzO/grafana-plugin-slurm-panel/blob/main/docs/grouping.md) — the three routes to
  a topology, ordered by the privilege each needs. Read this before deciding
  how to group; the panel is never the source of the topology.
- [`docs/value-mappings.md`](https://github.com/SckyzO/grafana-plugin-slurm-panel/blob/main/docs/value-mappings.md) — read
  before editing a Value mapping by hand. The obvious way to write one fails
  silently.
- [`dev/README.md`](https://github.com/SckyzO/grafana-plugin-slurm-panel/blob/main/dev/README.md) — the dev stack, its
  synthetic cluster and the provisioned dashboards this documentation's
  screenshots come from.

## Contributing and feedback

Bug reports and questions go to
[GitHub issues](https://github.com/SckyzO/grafana-plugin-slurm-panel/issues) — a dashboard JSON
that reproduces the problem is the single most useful thing you can attach,
since almost everything this panel does is decided by its options.

If you want to send code, [`CONTRIBUTING.md`](https://github.com/SckyzO/grafana-plugin-slurm-panel/blob/main/CONTRIBUTING.md)
has the toolchain contract: everything runs in containers through `make`, so
there is nothing to install but Docker, and `make check` on a fresh clone is
the whole build.
