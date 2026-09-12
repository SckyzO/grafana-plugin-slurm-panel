# Slurm Node Grid — design

Slice 1 of `slurm-views`. Written 2026-09-12.

## Why this exists

`slurm_exporter` runs sixteen collectors over roughly 150 metrics and ships ten
Grafana dashboards. They cover the aggregate thoroughly: node states, job states, CPU/GPU/memory
utilisation, partitions, scheduler and backfill internals, RPC statistics,
fairshare, reservations, licences, exporter health.

What no stock panel can render is the per-node view, and the reason is
structural rather than a gap in the dashboards:

```
slurm_node_status{node,status,partition} = 1
```

One series per `(node, partition)` pair. On the test cluster that is 25 series
for 20 nodes: `c1` belongs to `cpu`, `debug` and `high`, so it appears three
times. A `stat` panel counting series reports 25 nodes. A `bargauge` over 2 000
nodes is unreadable. And neither can join `slurm_node_drain_reason_info{node,
reason}` or `slurm_node_drain_since_timestamp_seconds{node}`, which carry no
`partition` label at all.

The value of this panel is the join and the density, not new data.

## Scope

In:

- One Grafana panel plugin rendering one cell per Slurm node.
- Colour from node state, with an optional continuous mode (CPU / memory / GPU
  fill).
- Grouping by a key that comes from a label, a capture on the node name, or a
  chunk of the node ordinal — so a cluster can be read as racks without any
  inventory.
- A rack-shaped layout: each group as a vertical column, bottom-up, fixed width.
- A tooltip carrying the facts a drained node's owner needs: reason, age, CPU,
  memory, GRES per model, partitions.
- A data link so a click leaves the panel for a node dashboard.
- Prometheus as the only data source.

Out, deliberately, and each is its own later slice:

- **Named views** — switchable presets bundling a grouping, a colour mode and a
  filter, selected from the panel rather than from the options editor. A view is
  a small object, `{ name, groupBy, colorMode, filter }`, and the grid already
  has every mechanism it needs. It is deferred on purpose: which groupings
  actually deserve a preset is a question the real cluster answers better than we
  can now. This is slice 1bis, not "someday".
- `slurmrestd`, and therefore anything job-level: queue, pending reasons, job
  detail. No backend in this slice, no Go, no JWT, no secrets.
- **U-accurate rack elevation.** Racks can be grouped and drawn rack-shaped
  without any inventory, and that is in scope. Placing a node at its real U,
  with its real height and slot, is not: it needs `u_position`, `u_height` and a
  per-model slot matrix, none of which can be derived from anything Prometheus
  holds today. See Open questions.
- Write operations of any kind.
- Accounting history through `sacct` / `slurmdbd`.

## Decisions taken, and why

**A dedicated repository with its own engine.** `datacenter-view` next door
solves an adjacent problem — where hardware physically sits — and about 650 of
its 750 engine lines would be reusable here with three modifications. It is
nevertheless a different project with a different premise and its own release
cadence, so `slurm-views` carries its own engine rather than coupling the two.
The duplication is accepted knowingly; the two engines answer different
questions and are expected to diverge, not converge.

**Prometheus only.** Everything in this slice runs against metrics
`slurm_exporter` already publishes. No change to any cluster, no new service, no
credential. A site that already runs the exporter installs the panel and it
works.

**The panel owns node de-duplication.** Identity is the `node` label. Several
series for one node collapse into one cell, and the differing values of the
grouping label are collected into a list. The alternative — telling the operator
to de-duplicate in PromQL with `max by (node, status) (...)` — puts the trap back
on them and breaks the join with `reason`, which is the specific thing this panel
exists to fix.

**Grouping may duplicate, and says so.** When the grouping label is one a node
can hold several values of, the node appears in each group. That is correct
behaviour, so the header states both numbers: `20 nodes · 25 slots`. A count
that silently disagrees with `sinfo` is worse than no count.

## Architecture

An npm workspaces monorepo, Apache-2.0, Node >= 22.

```
slurm-views/
├── packages/core/            the engine. No Grafana import, no DOM.
│   ├── ingest/frames.ts      Prometheus frames -> SlurmNode[]
│   ├── state/parse.ts        "idle*" -> { base, modifiers }
│   ├── state/severity.ts     Severity type and rollup
│   ├── state/classify.ts     buckets + modifier floors -> Severity
│   ├── group/keys.ts         label | capture | chunk -> a grouping key
│   └── group/build.ts        grouping, overlap allowed
├── plugins/nodegrid-panel/   tomzone-slurmnodegrid-panel
│   ├── src/module.ts         panel registration and options
│   ├── src/components/       grid, cell, tooltip, group header
│   └── src/editor/           the two drag-and-drop lists, the key source
├── dev/                      docker compose, provisioning, dashboards
└── docs/
```

React stays on 18 and the `create-plugin` toolchain stays pinned. Grafana 13
shares its own React instance with plugins, so moving to 19 breaks at runtime.

The engine runs under plain Node. Most of the behaviour is verifiable without
starting Grafana at all, which is what keeps the panel thin.

## Data contract

One required query, and a set of optional named facet slots. Each slot is bound
to a query `refId` in the panel options; the shipped dashboard provides the
queries.

| Slot | Default query | Shape |
|---|---|---|
| `state` (required) | `slurm_node_status` | identity `node`, state read from the `status` label |
| `cpuAlloc` / `cpuTotal` | `slurm_node_cpu_alloc` / `slurm_node_cpu_total` | scalar |
| `memAlloc` / `memTotal` | `slurm_node_mem_alloc` / `slurm_node_mem_total` | scalar |
| `gresUsed` / `gresTotal` | `slurm_node_gres_used` / `slurm_node_gres_total` | keyed by `gres_type` |
| `drainReason` | `slurm_node_drain_reason_info` | value read from the `reason` label |
| `drainSince` | `time() - slurm_node_drain_since_timestamp_seconds` | scalar, seconds |

Named slots rather than a generic facet system: the tooltip has to know that
`gresUsed` is keyed per GPU model and that `drainSince` is an age in seconds, and
a generic mechanism would push that knowledge into panel options the operator
would have to configure correctly before seeing anything.

Label names are options, defaulting to what `slurm_exporter` emits. The engine
never hardcodes a label name.

Ingest handles both shapes Prometheus returns — the labels-on-field shape of a
`numeric-multi` result, and the table shape with label columns — because a panel
that reads only one of them sees no labels at all on the other.

```ts
type SlurmNode = {
  name: string;
  state: NodeState;
  partitions: string[];              // collected, de-duplicated, sorted
  facets: Partial<Record<FacetSlot, Facet>>;
};

type Facet =
  | { kind: 'scalar'; value: number }
  | { kind: 'label'; value: string }
  | { kind: 'keyed'; values: Record<string, number> };
```

## The state model

`sinfo` reports a base state and may glue one modifier character onto it. This is
not a formatting quirk: `scontrol show node` exposes the same thing expanded, as
`State=DOWN+DYNAMIC_NORM+NOT_RESPONDING`. `sinfo` compresses the flags into a
single character, and `slurm_exporter` passes that character through into the
`status` label verbatim.

For Prometheus, `idle` and `idle*` are two unrelated strings. The engine splits
them before any rule is applied:

```
"idle*"   -> { base: "idle",    modifiers: ["not_responding"] }
"mixed-"  -> { base: "mixed",   modifiers: ["planned"] }
"drained" -> { base: "drained", modifiers: [] }
```

Without the split, `idle*` matches no rule and the cell falls to UNKNOWN; with a
loose `^idle` rule it would go green while the node is unreachable.

Base states, from the `sinfo` documentation:

```
allocated  blocked  completing  down  drained  draining  fail  failing
future  idle  maint  mixed  perfctrs  planned  power_down  power_up
reserved  unknown
```

`inval` is not in that list but `slurm_exporter` emits it, so the engine accepts
it as a base state.

Modifiers:

| Char | Name | Meaning |
|---|---|---|
| `*` | `not_responding` | the controller has lost contact |
| `~` | `powered_down` | powered down |
| `#` | `powering_up` | powering up |
| `!` | `power_down_pending` | pending power down |
| `%` | `powering_down` | powering down |
| `$` | `maintenance` | in a maintenance reservation |
| `@` | `reboot_pending` | reboot pending |
| `^` | `reboot_issued` | reboot issued |
| `-` | `planned` | planned by the backfill scheduler |

An unrecognised trailing character is kept as part of the base state rather than
guessed at, so a modifier added by a future Slurm release shows up as an
unclassified state and is visible, instead of being silently dropped.

### Severity

Severity comes from the base state. A modifier may then raise it, never lower it.

The default classification:

| | Base states |
|---|---|
| OK | `idle` `mixed` `allocated` `completing` |
| WARNING | `drained` `draining` `maint` `planned` `reserved` `power_down` `power_up` `blocked` `perfctrs` `future` |
| CRITICAL | `down` `fail` `failing` `inval` `unknown` |

The line between WARNING and CRITICAL is who decided. CRITICAL means Slurm has
ruled the node unusable. WARNING means something is under way that may or may not
resolve itself.

Default modifier floors:

| Modifier | Floor | Why |
|---|---|---|
| `not_responding` | WARNING | abnormal, and an operator should see it |
| `maintenance` | WARNING | planned, but worth seeing |
| `reboot_pending`, `reboot_issued` | WARNING | a transition someone started |
| `planned` | none | normal on any busy cluster running backfill |
| `powered_down`, `powering_up`, `powering_down`, `power_down_pending` | none | normal steady state on a power-saving site |

`not_responding` is WARNING and not CRITICAL on purpose. `idle*` is bounded by
`SlurmdTimeout`, 300 seconds by default. Slurm reaches the logical state on its
own — the node becomes `down*` with `Reason=Not responding`, which is already
CRITICAL — so painting the transient red would duplicate a decision Slurm makes
five minutes later, at the cost of a cell that flickers on every `slurmd`
restart.

The four power modifiers and `planned` default to no effect for the same reason
defaults matter at all: on a site with power saving, half the cluster is `idle~`
in normal operation, and a default that paints it orange is a default that gets
turned off rather than tuned.

Everything above is a default. All of it is configurable.

## Grouping, and reading a cluster as racks

Grouping is by a key, and the key comes from one of three sources, listed here
from most to least trustworthy. This is the model `datacenter-view` arrived at
for the same problem, and it holds here for the same reason: how much structure
is reachable depends entirely on what the data carries.

| Source | Example | What it costs |
|---|---|---|
| **label** | `partition`, `gres_type`, or a `rack` label a site provides through `file_sd` | nothing; the value is read |
| **capture** | a regex on the node name: `r012c04n03` → `r012`, `x1000c0s0b0n0` → `x1000c0` | nothing, where the name encodes position — a vendor convention, not a norm |
| **chunk** | slice the ordinal by N: `compute0421` → rack 11 at 40 per rack | it **invents** structure |

`slurm_exporter` publishes `partition`, `status` and `gres_type`, so label
grouping works out of the box. Nothing it publishes carries a rack, which is why
the other two sources exist at all.

Chunking is the only source that asserts something the data does not say. In HPC
the numbering usually does follow the floor; usually is not always. So every
group built by chunking keeps an **assumed** marker visible in the panel itself,
not only in the editor — a wrong rack drawn confidently is worse than no rack.

### Three levels of rack fidelity

```
Level 1 — rack as a group              Level 2 — the card shaped as a rack
┌─ R01 ──────────┐ ┌─ R02 ──────────┐   ┌ R01 ┐ ┌ R02 ┐ ┌ R03 ┐ ┌ R04 ┐
│ ■■■■■■■■■■■■■■ │ │ ■■■□■■■■■■▨■■■ │   │ ■ ■ │ │ ■ ■ │ │ ■ ■ │ │ □ □ │
│ ■■■■■■■■■■■■■■ │ │ ■■■■■■■■■■■■■■ │   │ ■ ■ │ │ ■ ▨ │ │ ■ ■ │ │ □ □ │
│ ■■■■■■■■■■■■   │ │ ■■■■■■■■■■■■   │   │ ■ ■ │ │ ■ ■ │ │ ▩ ■ │ │ □ □ │
└────────────────┘ └────────────────┘   └─────┘ └─────┘ └─────┘ └─────┘
```

**Level 1** needs only "which node is in which rack", which the three key
sources provide. **Level 2** adds an intra-rack order, which the ordinal in the
node name provides, and renders each group as a fixed-width vertical column read
bottom-up. Both are in this slice, and together they are the `compact` mode of
the Rackscope wallboard — the one that produces the wall-of-racks reading.

**Level 3**, placing each node at its true U with its true height, is not in this
slice and is not derivable. Rackscope's `rack` and `columns` modes reach it by
resolving a topology YAML against a device-template catalogue with a per-model
slot matrix; that is inventory, not inference. See Open questions.

Ordering within a group is by the ordinal in the node name where there is one,
falling back to a natural sort of the name. A node whose name ends in no number
still lands somewhere stable across refreshes, which matters more than being
right about a position nothing told us.

## The options editor

Two lists, not one. States and modifiers are configured separately because
combining them is combinatorial: 18 base states times 9 modifiers is up to 162
entries to classify, against 18 plus 9 when they are kept apart.

The state list is populated from the data actually present, so the operator
classifies the states their cluster produces rather than a theoretical list.

```
States — detected in your data, drag to classify

  OK                 WARNING            CRITICAL
 ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
 │ idle        │    │ drained     │    │ down        │
 │ mixed       │    │ draining    │    │ fail        │
 │ allocated   │    │ maint       │    │ failing     │
 │ completing  │    │ planned     │    │ inval       │
 └─────────────┘    │ reserved    │    │ unknown     │
                    │ power_down  │    └─────────────┘
                    │ power_up    │
                    │ blocked     │
                    │ perfctrs    │
                    │ future      │
                    └─────────────┘
 Unclassified:  (none) — a state this panel does not know lands here

Modifiers — severity floor applied on top of the state

  *  not responding ......... WARNING  ▾
  -  planned (backfill) ..... none     ▾
  ~  powered down ........... none     ▾
  #  powering up ............ none     ▾
  $  maintenance reservation  WARNING  ▾
  @  reboot pending .......... WARNING ▾
  ^  reboot issued ........... WARNING ▾
  %  powering down ........... none    ▾
  !  power down pending ...... none    ▾

Grouping — where the group key comes from

  ( ) Label      [ partition        ▾ ]   detected: partition, status, gres_type
  (•) Capture    [ ^([a-z]+\d+)c    ] on the node name
                 preview:  r012c04n03 → r012      18 groups
  ( ) Chunk      [ 40 ] nodes per group, named [ rack{n} ]
                 ⚠ invents structure — groups will be marked as assumed
  ( ) None       flat grid

  Layout  ( ) wrap   (•) rack-shaped columns
```

The capture and chunk sources show a live preview against the node names
actually present, because a regex typed blind into a panel option is a regex
nobody can tell is wrong until the panel is empty.

An unclassified state renders UNKNOWN grey, never green, and the panel shows a
count of them. A state that appears after a Slurm upgrade has to be visible, not
absorbed.

## Rendering and interaction

One cell is one `div`. Rendering is DOM, not canvas.

`colorMode` selects a single encoding at a time:

- `state` (default) — solid fill from the severity.
- `cpu`, `mem`, `gpu` — continuous fill from allocated over total, answering
  "where is there room left" rather than "what is broken".

One encoding at a time is a legibility decision. A cell carrying state as
background and utilisation as an inner bar reads well at 200 nodes and turns to
noise at 2 000.

Grouping is by the key described above, `partition` by default, with overlapping
groups allowed. Each group header carries its name, a node count, a severity
rolled up from its members, and the assumed marker when the group was chunked.

`layout` chooses how a group is drawn: `wrap` fills the available width, and
`rack` renders a fixed-width vertical column read bottom-up, which is what makes
a row of groups read as a row of racks. The two differ only in how cells are laid
out inside a group; the cell, the tooltip and the link are identical.

The tooltip carries: node name, readable state (`mixed, planned by backfill`),
partitions, CPU allocated over total, memory allocated over total, GRES used over
total per model, drain reason, and drain age.

A click follows a Grafana data link, with the node name and the state available
as variables.

### Scale

The realistic target is around 3 000 cells in one panel. Beyond that the answer
is to split the view by region rather than to change the renderer: a single grid
of 10 000 cells is not readable even when it is fast.

Past the threshold the panel renders what it has and shows a warning suggesting a
filter, rather than refusing or silently truncating. The renderer sits behind an
interface so a canvas implementation can replace the DOM one later without
touching the engine or the options.

## Error handling

The rule throughout: never paint a node green for lack of information.

- A node with no value for the state query is UNKNOWN, and stays distinguishable
  from a node whose state matched no rule. Collapsing the two is how a dead node
  ends up green.
- Unclassified states are counted and reported in the panel, not only in the
  editor.
- A query carrying neither a `node` column nor a `node` label is reported as
  skipped, by `refId`, with its name.
- When a facet query returns several rows for one node and the slot expects a
  scalar, the panel reports it rather than keeping an arbitrary row. A plausible
  panel built on one row out of five is worse than a visible complaint.
- Grouping that places a node in several groups reports both counts.

Warnings are rendered in the panel, not logged to a console nobody opens.

## Verification

**Engine** — plain TypeScript under Node, table-driven. Covered: both Prometheus
frame shapes; a node in several partitions; the nine modifiers plus an unknown
trailing character; absent versus unclassified; the GRES fan-out with two models
on one node; severity rollup; grouping with and without overlap; the three key
sources, including a regex that does not compile, a capture group that matches
nothing, a chunk over names carrying no ordinal, and the stability of both
grouping and intra-group order across two refreshes that return rows in a
different order.

Fixtures come from the real exporter output captured against the test cluster,
not hand-written, so the parsers are tested against the shape Prometheus actually
returns.

**End to end** — a Playwright test that loads the panel in Grafana against the
dev stack, from the first slice. This is not optional. `datacenter-view` records
that its two worst defects — a missing `useFieldConfig()` call that painted every
cell UNKNOWN, and an ingest path blind to the shape Prometheus returns — were
both found by running the panel and neither by testing the engine.

**Non-regression** — every bug fix lands with a test that fails before it and
passes after. A test that was green all along protects nothing.

## Development environment

`dev/docker-compose.yml` runs its own Grafana on the `slurm_slurm-network`
network created by the `slurm_exporter` test cluster, reads that cluster's
Prometheus, mounts the built plugin, and allows unsigned plugin loading. The
`slurm_exporter` repository is not modified in any way.

Bringing the data up, from `slurm_exporter`:

```sh
make -C scripts/testing setup        # cluster, exporter, Prometheus, Grafana
make -C scripts/testing workload N=30
make -C scripts/testing gpu-workers  # 10 fake GPU nodes, two models
```

The cluster produces the awkward cases on demand: `make node-fail` for drain and
down, `gpu-workers` for nodes carrying two GPU models at once, and stopping a
worker container for a node the controller cannot reach.

## Known upstream issue

`slurm_exporter` passes the `sinfo` state suffix into the `status` label verbatim
and its aggregates fold it into the base state, so `slurm_nodes_planned` never
counts a node that is planned while partially busy. Filed as
[SckyzO/slurm_exporter#243](https://github.com/SckyzO/slurm_exporter/issues/243).

This panel does not depend on that being fixed. Splitting base from modifier at
parse time makes it correct against the exporter as it is today, and against the
history already in Prometheus. If the exporter later exposes the modifier as its
own label, the parser keeps working and the label becomes an alternative source.

## Open questions

Recorded rather than decided, so they are not rediscovered from scratch later.

### Slurm state at a node's true U position

Levels 1 and 2 — racks as groups, drawn rack-shaped — are in this slice and need
no inventory. What stays open is level 3: each node at its real U, with its real
height, in a rack of a known size.

**`slurm_exporter` emits no placement label at all.** Not rack, not room, not U
position. Slurm does not know them, so the exporter cannot report them. Levels 1
and 2 work around that by deriving the rack from the node name; a true elevation
cannot, because height and slot are properties of the hardware, not of the name.

Three ways placement could reach a panel, none of them free:

1. **Derived from the node name.** Already done in this slice, and it is what
   gets levels 1 and 2. It does not reach level 3: a name can say which rack a
   node is in and in what order, never how many U it occupies or which slot of a
   chassis it sits in. Two nodes named consecutively may be two 1U servers or two
   blades of a 2U quad, and no regex can tell them apart.
2. **Per-target labels through Prometheus `file_sd`.** The standard, tool-agnostic
   answer, and the one a site with an inventory (Ansible, BlueBanquise, NetBox)
   can already generate. Nothing to change in Slurm or in the exporter; the cost
   is a generator to write and maintain on the Prometheus side.
3. **A placement file read by `slurm_exporter`.** The exporter already holds the
   node list, so it could join a static mapping onto it and publish, say,
   `slurm_node_location_info{node,rack,room,u}`. Every site running the exporter
   would get placement with no Prometheus plumbing.

Option 3 is tempting and is the one to be careful with. The exporter's contract
is *expose what Slurm knows*, and Slurm knows nothing about racks; adding a
static inventory turns a metrics exporter into an inventory database. It also
brings a reconciliation problem nobody asked for — a node in the file but not in
Slurm, and the reverse — and makes fixing a typo in a rack name a redeployment.
The lighter variant, a pattern mapping with wildcards in the style of Rackscope's
`node_mapping.yaml`, is a handful of lines for a homogeneous cluster but still
plants the inventory concept in the wrong layer.

And which panel draws the elevation is a second, independent question.
`datacenter-view` already has `tomzone-rackview-panel` on its roadmap, and its
`STATUS.md` records that Rackscope's `RackElevation` is pure CSS that ports
directly. What that panel lacks in order to colour by Slurm state is one generic
capability: reading state from a **label** rather than from the series value,
since `slurm_node_status` is always `1` and the state lives in `status`. That is
a change worth making there on its own merits — `node_systemd_unit_state`,
`ipmi_sensor_state` and `ceph_health_status` have the same shape.

So the choice is between `slurm-views` growing its own elevation renderer, and
`datacenter-view` gaining label-sourced state. Both are defensible; neither is
decided here, and neither is needed for this slice.

## What comes after this slice

Named views first, once the grid has run against a real cluster long enough to
show which groupings earn a preset. Then the drain board, then a `slurmrestd`
data source, then the live queue, then pages, then cross-tool correlation, then
accounting, then write operations.

Each is usable on its own; none is started before the previous one ships.
