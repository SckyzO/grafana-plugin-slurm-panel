# Slurm Node Grid

One cell per Slurm node, coloured by state — or by CPU, memory or GPU
utilisation — grouped and laid out to match how the cluster is actually
organised, rather than by counting Prometheus series.

`slurm_exporter` publishes one series per `(node, partition)` pair, so a node
in three partitions appears three times to any panel that just counts
series. This panel groups by node identity first, and says how many distinct
nodes and how many drawn cells that produced whenever the two numbers
disagree.

## Data

One required query, plus a set of optional named facet slots. Each is bound
to a query `refId`:

| Slot | Query (default) | Notes |
|---|---|---|
| `state` (required) | `slurm_node_status` | node identity and Slurm state; drives colour in State mode |
| `cpuAlloc` / `cpuTotal` | `slurm_node_cpu_alloc` / `slurm_node_cpu_total` | drives colour in CPU mode |
| `memAlloc` / `memTotal` | `slurm_node_mem_alloc` / `slurm_node_mem_total` | drives colour in Memory mode |
| `gresUsed` / `gresTotal` | `slurm_node_gres_used` / `slurm_node_gres_total` | keyed by the `gres_type` label; drives colour in GPU mode |
| `drainReason` | `slurm_node_drain_reason_info` | value read from the `reason` label, shown in the tooltip |
| `drainSince` | `time() - slurm_node_drain_since_timestamp_seconds` | age in seconds, shown in the tooltip |

Label names (`node`, `state`, `partition`, `gresType`, `reason`) are options
too, defaulting to what `slurm_exporter` emits.

The **Data** section of the panel options covers the node label, the state
label and the state query's `refId` — the required query. The optional facet
slots above, and the `partition` / `gresType` / `reason` label names, have no
field of their own in that editor; bind them by editing the panel's JSON
model instead (panel menu ▸ **Edit panel JSON**) or in a dashboard's
provisioning file. `dev/provisioning/dashboards/slurm-node-grid.json` in this
plugin's repository is a complete worked example — its panel's
`options.slots` and `options.labels` show every slot bound to a query.

## Grouping

`slurm_exporter` publishes no rack or location label of any kind — it reads
`sinfo`, which has no concept of one — so no configuration on this side ever
produces one by itself. There are three ways to still get a real topology,
and what decides which one you can reach for is the privilege you hold, not
which is more elegant:

- **Relabel at scrape time**, if you administer the Prometheus behind this
  panel. The label then works in alerting, recording rules and every other
  dashboard, not only this one. If you write that rule by hand, do not
  reach for `sinfo`'s own range notation: Prometheus compiles a relabelling
  `regex` as RE2, where `c[1-40]` does not mean "c1 through c40" — it means
  "c, followed by one of the characters 1, 2, 3, 4 or 0". That is right by
  accident on `c[1-5]` and silently wrong from `c[1-10]` onward, with
  nothing to say so. Write an expanded alternation of literal node names
  instead.
- **Join an inventory** onto the metric frame with Grafana's own
  transformations, if you only have Editor on the dashboard. This needs
  nothing upstream of Grafana.
- **Write a range table**, below, if you want the layout to live in the
  dashboard itself rather than anywhere upstream of it.

The full recipe for each — including the exact transformation chain the
join needs — is in this repository's `docs/grouping.md`.

**Grouping > Group by** groups nodes from one of four sources:

- **Label** — a label the data already carries, e.g. `partition`, or a rack
  label once one of the routes above has put one there.
- **Capture** — the first capture group of a regular expression run against
  the node name (`^(r\d+)` groups `r012n03` under `r012`). This only
  recovers structure the node name already spells out; it invents nothing
  that is not literally in the name.
- **Ranges** — a table you write by hand, one line per group, in Slurm
  hostlist syntax: `name: hostlist`. For example:

  ```
  rack1: c[1-40]
  rack2: c[41-80]
  ```

  Line order is display order — the table is the only place you get to say
  what order a machine-room floor is actually in, since it is rarely
  alphabetical. The value can be a dashboard variable instead of a literal
  table, so several panels can share one layout and it can be edited in one
  place. See `docs/grouping.md` for the full syntax.
- **Chunk** — slices nodes by ordinal into fixed-size groups.

Chunking is the one source that invents structure the data never stated: HPC
node numbering usually follows the physical layout, but usually is not
always. Every group it produces carries an **assumed** marker — in the
grouping editor's live preview, and in that group's header inside the panel
itself, so the claim travels with the data rather than staying only in the
editor.

A node that matches no group is drawn last, under a header marked
**unplaced**, inside a dashed frame — deliberately, because a node missing
from a supervision view is a worse failure than a node drawn in the wrong
box — and it is named in the warnings strip. A range the table declares
that matches no node is the opposite problem, a box with no nodes rather
than nodes with no box: it is still drawn, empty, in its declared place, and
named in the warnings strip too.

The panel also measures whether some other label already on the data would
group the nodes more completely than the source configured today, and names
that label in the warnings strip if so. It never switches sources by
itself: a panel that reconfigured itself because a third party edited the
scrape would change behaviour with nothing in its own JSON to explain why.

**Grouping > Node may appear in several groups** draws a node once per
partition when grouping by the `partition` label — the only label this
fan-out supports, since it needs a per-node list of every value the label
takes, and the engine only builds that list for partitions.

## Layout

**Layout** draws the grid one of two ways:

- **Wrap** (default) — cells flow left to right, top to bottom.
- **Rack** — each group is drawn as a cabinet, one sled per node, stacked
  bottom to top the way a rack is actually read.

**Layout > Cell width** and **Layout > Cell height** are both in pixels.
Cell height is optional on purpose: Wrap and Rack disagree about what a
cell should look like by default, so leaving it empty derives a square in
Wrap and a sled — about half the cell width — in Rack. **Layout > Cell
gap** is the space between cells, which is what actually makes a dense grid
readable, not a border.

Rack mode draws exactly one sled per node and has no idea what a chassis
is. A site running 2, 3 or 4 nodes per blade sees a cabinet taller than the
real one, because every one of those nodes still gets its own sled — nothing
marks where one chassis ends and the next begins. Nodes from one physical
chassis do stay adjacent, since a group's nodes are always sorted by the
trailing number in their name, but the boundary itself is not drawn.
**Layout > Cell height** can correct the cabinet's overall height to match
reality; it cannot draw the missing chassis lines.

### Blades

In the Rack layout, **Nodes per blade** says how many nodes share one slot in
the cabinet. The default is 1 — a single-node server — and it draws one sled
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
supported. Neither is a cabinet that mixes blade sizes within itself —
**declare it as two groups**, which costs nothing and keeps every position on
the drawing true. A group with no declaration keeps one sled per node, a
vertical stack that makes no claim about where anything sits sideways.

## Colour

**Display > Colour by** picks one encoding for the cell fill at a time:

- **State** (default) — the Slurm state, coloured by the panel's own **Value
  mappings** section. Twenty-one rules are applied by default, covering every
  state in the `sinfo` man page in both its long and abbreviated spellings, so
  the grid is coloured before anything is configured. They are a default and
  not a lock: the rules appear in **Value mappings** and can be edited,
  reordered, duplicated or deleted like any other field config.
- **CPU**, **Memory**, **GPU** — a continuous fill driven by that facet's
  allocation, resolved through the panel's **Thresholds** section rather
  than a fixed colour scale.

Only one encoding is active at a time, deliberately: a cell carrying both
state and utilisation reads well at a couple hundred nodes and turns to
noise at a couple thousand. A cell always names its node and state in
words — in the tooltip and in its accessible label — regardless of which
colour mode is active, so meaning never rests on colour alone.

**Display > Shape channel** adds a second encoding, off by default: a notch
or a diagonal cut into the cell for the states that most need to stay
visible without colour. With it on, the grid stays readable in greyscale, in
print, under `forced-colors`, and for a red-green colour deficiency,
whatever palette the site chose.

### The states, and the colour each one gets

Colour encodes what an operator can do with a node, not which of the
twenty-one states it is in — no palette separates that many at a glance. The
exact state is always spelled out in the cell's tooltip and in its accessible
label, in every colour mode.

| Rule | Shown as | Colour |
|---|---|---|
| `/^.*\*$/` | not responding | `semi-dark-orange` |
| `/^.*~$/` | powered down | `text` |
| `/^idle.*-$/` | idle, backfill | `semi-dark-green` |
| `/^idle.*$/` | idle | `green` |
| `/^(planned\|plnd).*$/` | planned | `light-green` |
| `/^comp.*$/` | completing | `super-light-blue` |
| `/^mix.*-$/` | mixed, backfill | `light-blue` |
| `/^mix.*$/` | mixed | `blue` |
| `/^alloc.*-$/` | allocated, backfill | `semi-dark-blue` |
| `/^alloc.*$/` | allocated | `dark-blue` |
| `/^(drain\|drng).*$/` | drained | `yellow` |
| `/^maint.*$/` | maintenance | `purple` |
| `/^res.*$/` | reserved | `semi-dark-purple` |
| `/^(npc\|perfctrs).*$/` | perf counters | `light-purple` |
| `/^(down\|fail).*$/` | down | `red` |
| `/^unk.*$/` | unknown | `semi-dark-red` |
| `/^inval.*$/` | invalid registration | `semi-dark-red` |
| `/^block.*$/` | blocked | `orange` |
| `/^reboot.*$/` | reboot | `light-orange` |
| `/^pow.*$/` | power management | `text` |
| `/^fut.*$/` | future | `text` |

`sinfo` appends one of nine flags to a state: `*` not responding, `~` powered
off, `#` powering up, `!` pending power down, `%` powering down, `$`
reservation maintenance, `@` pending reboot, `^` reboot issued, and `-`
planned by the backfill scheduler. The two that mean the node cannot run work
at all — `*` and `~` — are matched first and override the state. The other
seven leave the state readable and are absorbed by the trailing `.*`, which is
why one rule covers `idle`, `idle#` and `idle@` together.

### Adding or changing a state

Everything lives in Grafana's standard **Value mappings** editor — the same one
every other panel uses, with drag handles to reorder, a colour picker per row,
duplicate and delete, and **Add a new mapping**. Nothing about state colour is
configured in this panel's own options, deliberately: value mappings are where
Grafana puts this, and a second mechanism would be invisible to field
overrides, to provisioning, and to anything else reading the dashboard JSON.

The editor offers four condition types. Two matter here:

- **Value** — an exact match. Enough when you do not care about flags:
  `blocked` → your text and colour.
- **Regex** — needed to cover a state together with its flags. Write it
  delimited and spanning the whole value: `/^blocked.*$/`.

Order matters: a rule for a state with a flag must come above the rule that
would otherwise swallow it, which is why `/^idle.*-$/` sits above `/^idle.*$/`.

Two ways of writing a regex rule fail silently, and neither is visible from the
editor. A bare pattern such as `^idle` is wrapped in `^...$` by Grafana and
becomes an exact match, so `idle*` falls straight through it — delimit it with
slashes. And a regex mapping replaces the matched portion rather than labelling
the value, so `/^drain/ → drained` renders `drained` as `draineded` — make the
pattern span the whole value with a trailing `.*$`.

You do not have to remember any of that. When the panel meets a state no rule
covers, it names the state in its warnings strip **and prints the rule to
paste**, correctly delimited, spanning the value, and escaped:

```
2 states matched no value mapping: blocked, completing (11 with flags)
Add one per state under Value mappings — condition Regex, e.g.
/^blocked.*$/ — then set its text and colour.
```

## Data links

Set a data link under the panel's own **Data links** section to make a cell
open a node dashboard on click. The link URL can use two template variables,
interpolated per node before navigation:

- `${__node}` — the node name.
- `${__state}` — the node's raw Slurm state.

Example: `/d/some-dash?var-node=${__node}&var-state=${__state}`.

Only the first configured data link is followed; a cell with no link
configured is not clickable.

## Scale

The panel draws one cell per node regardless of how many the query returns;
there is no built-in cell-count warning or cutoff. **Grouping** is what
keeps a very large cluster legible — splitting the grid into named boxes
reads better than one long wrap or one very tall rack once a cluster passes
a few hundred nodes.

## Warnings

A strip above the grid names, rather than hides, anything the panel could
not fully resolve:

- a query skipped for carrying no node identity;
- states that matched no value mapping (capped at eight named, then `and N
  more`), together with the exact rule to paste under Value mappings to fix
  it;
- nodes the active grouping source could not place, drawn under
  `ungrouped` and why, e.g. `3 nodes matched no range: c[41-43]. Drawn
  under "ungrouped".`;
- a declared range that matched no node, drawn empty in its place, e.g.
  `Range "rack5" matched no node: r[501-502].`;
- a label that would group the data more completely than the source
  configured today, e.g. `Label "rack" would group all 240. Grouping >
  Group by > Label.` — measured, never acted on: the panel does not switch
  sources by itself.

Four kinds of label are never proposed, however well they would score, so
their absence from that line is not a bug:

| Never proposed | Why |
|---|---|
| The **node label** | One group per node is not a grouping. |
| The **state label** | It regroups the grid on every scrape. |
| Any label with **as many distinct values as nodes it covers** | An identity in a different costume — `reason` on a set of drained nodes is one. |
| Any label with **fewer than two distinct values** | One group for everything, which would win on coverage every single time. |

Grouping set to **None** is also silent: it is a choice, not a failure to
group. And a label speaks only when it would place *strictly more* nodes than
the active source does — one that merely ties says nothing.

A state matching no mapping keeps its raw text; Grafana would colour it with
the threshold base colour (green, by default) rather than a mapped one, so
the cell deliberately refuses that colour and draws a hollow ring instead.
