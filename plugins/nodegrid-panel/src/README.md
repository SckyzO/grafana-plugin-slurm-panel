# Slurmnodegrid

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

**Grouping > Group by** groups nodes from one of three sources:

- **Label** — a label the data already carries, e.g. `partition`. Note that
  `slurm_exporter` publishes no rack or location label of any kind: it reads
  `sinfo`, which has no concept of one. Unless you add such a label yourself
  through relabelling or an inventory join, use a capture instead.
- **Capture** — the first capture group of a regular expression run against
  the node name (`^(r\d+)` groups `r012n03` under `r012`).
- **Chunk** — slices nodes by ordinal into fixed-size groups.

Chunking is the one source that invents structure the data never stated: HPC
node numbering usually follows the physical layout, but usually is not
always. Every group it produces carries an **assumed** marker — in the
grouping editor's live preview, and in that group's header inside the panel
itself, so the claim travels with the data rather than staying only in the
editor.

**Grouping > Node may appear in several groups** draws a node once per
partition when grouping by the `partition` label — the only label this
fan-out supports, since it needs a per-node list of every value the label
takes, and the engine only builds that list for partitions.

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

Past about 3,000 cells the panel keeps rendering, but says so: the warnings
strip reports the cell count and suggests filtering the query or splitting
the view. The threshold is itself an option, **Layout > Cell warning
threshold**.

## Warnings

A strip above the grid names, rather than hides, anything the panel could
not fully resolve: a query skipped for carrying no node identity, states
that matched no value mapping (capped at eight named, then `and N more`),
and the cell count once it passes the warning threshold above. A state
matching no mapping keeps its raw text; Grafana would colour it with the
threshold base colour (green, by default) rather than a mapped one, so the
cell deliberately refuses that colour and draws a hollow ring instead.
