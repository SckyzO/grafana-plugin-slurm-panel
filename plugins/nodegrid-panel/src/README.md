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

- **Label** — a label the data already carries, e.g. `rack` or `partition`.
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

- **State** (default) — the mapped Slurm state, from the panel's own **Value
  mappings** section. See [`docs/value-mappings.md`](../../../docs/value-mappings.md)
  in this repository for the shipped mappings and three traps that make a
  hand-written rule fail silently.
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
matching no mapping keeps its raw text and Grafana's default grey rather
than a mapped colour.
