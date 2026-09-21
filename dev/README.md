# Development stack

Self-contained and fully containerised: a toolchain image, Grafana, Prometheus
and a synthetic Slurm exporter. Driven from the repository root with `make`.

```bash
make scrape  # regenerate the Prometheus scrape config from dev/relabel/racks.txt
make up      # build the panel, start the stack, wait for Grafana (runs make scrape first)
make e2e     # browser tests against it
make down    # stop, keeping the volumes
```

Grafana on <http://localhost:3000>, dashboard **Slurm / Production example**;
Prometheus on <http://localhost:9090>. `make up` prints the address it
actually published, which is not always that one. See below.

## If those ports are taken

A machine that already runs a Grafana or a Prometheus (the `slurm_exporter`
test stack does both) needs this one published beside it rather than on top
of it. Set the two ports in `dev/.env`, which is not tracked:

```ini
GRAFANA_PORT=3001
PROM_PORT=9091
```

Nothing inside the compose network moves: Grafana still answers on 3000 and
Prometheus on 9090 there, which is how the browser tests reach them. Only a
host browser sees the difference, and `make up` reads the published port back
from compose rather than assuming it.

## A dashboard's uid, its panel ids and its titles are a contract

The browser suite navigates by `uid`, as in `/d/slurm-prod/...`, isolates
a panel with `viewPanel=<id>`, which is the panel's own `id` field rather than
its position, and resolves a panel by its **title**. Position is the one thing
it never depends on, which is what lets a dashboard be resized or gain a panel
without touching a test.

The layout is therefore free to move, but **renaming a `uid`, renumbering a
panel `id`, or renaming a panel the suite names breaks it**. It breaks loudly,
which is the point, but do it knowing that, and update the specs that name them
in the same commit. The titles pinned today are `State`, `CPU occupancy`,
`Memory occupancy` and `GPU occupancy` on **utilisation**, and `By a label, in
rack layout`, `By a capture, splitting compute from GPU`, `By a chunk of the
ordinal` and `Not grouped at all` on **grouping and layout**.

None of these files carries a numeric `id` at dashboard level, and none should:
Grafana assigns that, and `allowUiUpdates: false` makes the file the truth.

## The services

| | |
|---|---|
| `tools` | the toolchain: Node, pnpm, Chromium. Not a running service; `docker compose run` starts it for one command and removes it |
| `grafana` | pinned in `.env`, with `dist/` mounted as an unsigned plugin |
| `prometheus` | scrapes the exporter below |
| `synthetic-exporter` | any cluster shape on demand |

The compose project is named `slurm-views` explicitly. Left to Docker it would
be taken from this directory, `dev`, which is neither unique on a machine
hosting several repositories nor recognisable in `docker compose ls`.

## The dashboards

They are laid out for a 2560px-wide screen — a 27-inch 2K, which is what a
cluster gets watched on. That is a decision, not an accident, and it is
worth knowing before anyone "fixes" a panel that looks clipped: measured
across widths, nothing overflows at 2560, four panels do at 1920 and eleven
at 1280. A cabinet is drawn in pixels while Grafana's grid is twenty-four
proportional columns, so a floor of nine cabinets needs a real width and
cannot shrink to fit — narrowing the cells barely helps, because most
cabinets are floored by the width of their own group header rather than by
their cells. Shrink the cells to suit a laptop and the dashboards stop
showing what the panel does at the size it is meant for.


Three, provisioned into the **Slurm** folder, one per axis of the panel:
what it looks like in service, how a cell gets its colour, and how the grid
is structured. **Production example** reads Prometheus outright; the other
two mix a hand-written CSV with live queries.

| Dashboard | Source | What it is for |
|---|---|---|
| Production | Prometheus | The one to open first, in five bands: how much of the cluster still works and how much of it is working, where the nodes have been over the window, the floor itself, capacity per partition, and the reasons no stock panel can join. Every count goes through `count by (node)` before it is counted |
| Colour and state | CSV + Prometheus | How a cell gets its colour: the twenty-one states and the nine colours they resolve to, the same states drawn live, the three continuous modes that colour by occupancy instead, and the shape channel with and without |
| Grouping and layout | CSV + Prometheus | The same nodes grouped four ways on a hand-written CSV, plus the three live routes to a real topology proven against this dev cluster, plus one panel that deliberately covers less, to prove the coverage warning |

**Colour and state** puts the twenty-one states and the nine colours they
resolve to side by side: a table of the mappings the panel ships, and the
same states drawn live beside it, so a rule and its result are read
together. Under them the three continuous modes, which colour by occupancy
through Thresholds rather than by state at all, and then the shape channel
with and without over one floor.

The first four panels of
**grouping and layout** use Grafana's built-in TestData source, for
the same reason: a side-by-side comparison of Label, Capture, Chunk and
None should render identically on every run, not drift with whatever the
synthetic exporter happens to generate that session. That dashboard's other
six panels go the other way, on purpose: they read this dev cluster's live
Prometheus, because proving the three routes to a real topology means
proving them against a real scrape.

None of the five configures value mappings. The Slurm state colours
are the panel's own default, so a panel added to a new dashboard is coloured
before anything is configured.

## Two data sources

**Synthetic** (default) produces any cluster shape on demand. `SYNTH_PROFILE`
picks the shape of the state *distribution* itself, independent of node
count. Three values, `production` the default:

| `SYNTH_PROFILE` | What it is |
|---|---|
| `production` (default) | A cluster that is working: weighted mostly `allocated` and `mixed`, real idle capacity behind it, and only a sliver of `drained`, `down`, `maint` and `fail`, percentages measured against a real cluster, not invented. |
| `incident` | The same weighted shape, except every node in `cpu2` (`c81`..`c160`, the block `dev/relabel/racks.txt` names that way) is `down`, and roughly 15% of the remaining nodes are `drained` or `draining`. |
| `showcase` | A uniform draw over every base state and every one of the nine state modifiers, including states a 20-node docker cluster would otherwise rarely reach, like `blocked` and `perfctrs`. It is the shape to reach for when a dashboard has to show every colour the panel can paint at once. |

An unrecognised value falls back to `production` and says so on the
exporter's stderr, rather than crashing or picking something silently. Drain
reasons are picked per node from a short list of realistic causes (a failed
health check, a filesystem not mounted, a memory error, a thermal event, an
administrative hold) deterministically from `SYNTH_SEED`, so a drain storm
does not read as forty nodes sharing one copy-pasted reason.

Shape the node count from whichever end you are thinking in:

```bash
SYNTH_RACKS=4  SYNTH_NODES_PER_RACK=80 make up   # 320 nodes: RACKS * NODES_PER_RACK
SYNTH_RACKS=75 SYNTH_NODES=3000        make up   # 3000 nodes; SYNTH_RACKS has no effect here
SYNTH_NODES=100                        make up   # 100 nodes
SYNTH_PROFILE=incident                 make up   # the default node count, in incident shape
```

`SYNTH_RACKS` only multiplies with `SYNTH_NODES_PER_RACK` to produce a total
node count; set `SYNTH_NODES` directly instead and `SYNTH_RACKS` does nothing
at all. Either way, node names carry no location, just `c<n>` and `g<n>`, flat
and counting within their own family, because the real exporter's don't.
`SYNTH_SEED` fixes which node lands in which state, so a screenshot or a
failing e2e run reproduces exactly; `SYNTH_PARTITIONS` renames the
partitions.

**Real** points at the `slurm_exporter` test cluster instead. Start it with
`make -C <slurm_exporter>/scripts/testing setup`, then change the Prometheus
scrape target to that cluster's exporter. Drive it with the targets that repo
already ships: `workload N=`, `node-fail`, `node-restore`, `cancel-all`,
`gpu-workers`. Neither path modifies the `slurm_exporter` repository.

## There is no rack label, and nowhere for one to come from

slurm_exporter reads `sinfo`, and sinfo has no concept of a rack. Checked
against the exporter's own `docs/metrics.md` and against a running instance,
the node metrics carry exactly this and nothing else:

| Metric | Labels |
|---|---|
| `slurm_node_status` | `node`, `status`, `partition` |
| `slurm_node_cpu_alloc` / `cpu_idle` / `cpu_other` / `cpu_total` | `node`, `status`, `partition` |
| `slurm_node_mem_alloc` / `mem_total` | `node`, `status`, `partition` |
| `slurm_node_gres_used` / `gres_total` | `node`, `status`, `partition`, `gres_type` |
| `slurm_node_drain_reason_info` | `node`, `reason` |
| `slurm_node_drain_since_timestamp_seconds` | `node` |

So physical structure has to be recovered from the node name, which is where
a real cluster encodes it: `^(r\d+)` against `r001n0042`, `^([a-z]+)` against
a cluster named `c1..c10` and `g1..g10`. Grouping by a label is available only
if you put the label there yourself, through Prometheus relabelling, a recording
rule or a join against an inventory, and that is a decision about your scrape
config, not something the panel can do for you.

The synthetic exporter reproduces those label sets exactly, `rack` included in
the sense that it does not have one. An earlier revision invented a `rack`
label, which made every dashboard here work and none of them portable.

This dev stack gets a real `rack` label anyway, through rung 1:
`dev/relabel/racks.txt` declares the floor plan by hand, and
`dev/relabel/generate.mjs` turns it into the `metric_relabel_configs` block
Prometheus reads at scrape time (`make scrape`, which `make up` runs for
you). Neither file ships with the plugin or is maintained for anyone else's
Prometheus; they are this repository's own fixture for standing up a
cluster that has a rack label to demonstrate against. The next section
covers what each of the three rungs actually needs from you.

## Three ways to a topology, and how each one is wired

`dev/relabel/racks.txt` gives this dev cluster a real `rack` label: nine groups,
one per cabinet, named for the node family that fills it — `cpu1..cpu4` over
`c1..c320`, `bigmem1..bigmem2` over `b1..b120`, `visu1` over `v1..v20` and
`gpu1..gpu2` over `g1..g80` — by
turning the same table into Prometheus relabelling (`make scrape`, run by
`make up`) that also pastes into the panel's Grouping > Ranges option. That
one file is the input to two of the three routes below; **grouping and
layout** provisions one panel per rung, all three read from a Prometheus
query on that live cluster, and the panel plugin's own e2e suite
(`the three ways to get a topology, proven against the same live data`)
asserts each of them.

The dashboard's fourteen panels, in provisioned order:

| # | Panel | Grouping | Data |
|---|---|---|---|
| 1 | Grouped by label, rack layout | Label `rack` | CSV, hand-written; the best case, exporter already publishes the structure |
| 2 | Grouped by name capture | Capture `^([a-z]+)` | CSV, hand-written; recovers node class, not a location |
| 3 | Grouped by ordinal chunk | Chunk, size 8 | CSV, hand-written; invents structure, marked `assumed` |
| 4 | Ungrouped | None | CSV, hand-written; one flat grid |
| 5 | Topology 1: relabelled Prometheus label | Label `rack` | Prometheus, relabelled by `make scrape` |
| 6 | Topology 2: joined inventory | Label `zone` | Prometheus (query A) joined to a CSV inventory (query B) |
| 7 | Topology 3: range table | Ranges, `$racks` dashboard variable | Prometheus |
| 8 | Incomplete range table | Ranges, `cpu1: c[1-80]` | Prometheus, the full 540-node cluster |
| 9 | Blade density by rack | Label `rack` | Prometheus, four densities declared per group - `cpu` quad, `bigmem` triple, `visu` single, `gpu` duo - every cabinet at twenty slots |
| 10 | Declared cabinet heights | Label `rack` | Prometheus, same blades, the panel-wide twenty slots against `gpu[1-2]: 26` |
| 11 | Filtered to CPU racks | Label `rack`, query narrowed to `rack=~"cpu.*"` | Prometheus, four cabinets of the nine |
| 40 | Slot declaration too small | Label `rack`, `cpu1` declared at twelve slots | Prometheus, the full 540-node cluster |
| 12 | Shape channel | Label `rack` | Prometheus, the one grid in this stack with `shapeChannel: true` |
| 41 | Grouped by partition | Label `partition`, `multiValueLabel: true` | Prometheus, 617 cells over 540 nodes - a node in two partitions is drawn in both |

Panels 1-4 are the same 32-node CSV, grouped four ways, and need nothing
running but Grafana. The rest read this dev cluster's live Prometheus:
the three rungs, the coverage signal, and the ones that pin blade density,
cabinet height, query-side filtering and the shape channel.

The three rungs are the panels titled **Topology 1**, **Topology 2** and
**Topology 3**: "rung" is this repository's word for them, and a panel title
is not the place to teach it.

**Rung 1, label.** The plain case, once a `rack` label exists: Prometheus
datasource, `slurm_node_status`, Grouping > Group by > Label, label `rack`.
Nothing else to configure.

**Rung 2, join.** The Grafana-native answer for anyone whose Prometheus
carries no location dimension at all, with no relabelling and nothing to group
by, so the dimension has to come from a second query the panel joins on. The
chain below was built from Grafana's transformation docs and then verified
panel by panel against a live stack; two things about it do not match a first
reading of those docs:

1. **The panel's own datasource must be `-- Mixed --`.** A panel whose
   datasource is Prometheus and that also carries a TestData target simply
   never sends that second query; Grafana only executes per-target
   datasource overrides when the panel itself is Mixed. Query A stays
   Prometheus, query B stays TestData; only the panel-level `datasource`
   changes.
2. **Query A needs Format: Table**, not the default Time series. An instant
   vector query returns one frame per series. `labelsToFields` turns each
   series' labels into columns in place, but that still leaves one frame per
   series, and `Join by field` folds those into a synthetic `refId` string
   with one `-A` per series, which changes size with the query and is not
   something to hardcode. Format: Table asks Prometheus's own datasource to
   hand back a single frame, one row per series with `node` and every label
   already a column, before the transformation pipeline runs at all, so
   there is nothing left for `labelsToFields` to do.
3. **Join by field, `byField: node`, `mode: outer`**, over query A (now one
   table frame) and query B (the CSV, also one frame). Two input frames in,
   one frame out, the part of the docs that did hold.
4. **The joined frame's `refId` is not `A`.** `Join by field` names its
   output `joinByField-<refId>-<refId>-...` for every frame it joined, so here
   it is deterministically `joinByField-A-B`. The panel's **State query**
   option (Data > State query, `options.queries.state`) has to name that
   string, not the query's own `A`, or the panel reads zero frames and prints
   "No nodes"
   with no warning to explain why (ingest only warns about a query it can
   see and cannot read; a query it never receives is silent).
5. **The inventory's column is `zone`, not `rack`.** The first working version
   named it `rack` with the same `cpu1`/`cpu2`/`gpu1` values relabelling
   already carries on query A. Both frames agreed, so the panel rendered
   identically whichever one Grafana's join happened to keep, and nothing
   short of reading `joinByField`'s source said which that was. The CSV now
   carries a `zone` (`aisleA`/`aisleB`/`aisleC`) that appears nowhere else in
   the stack: it can only have reached the panel through the join, which is
   what makes the demonstration provable rather than merely plausible.

Written as the panel JSON actually carries it:

```json
{
  "datasource": { "type": "datasource", "uid": "-- Mixed --" },
  "targets": [
    { "refId": "A", "datasource": { "type": "prometheus", "uid": "..." },
      "expr": "slurm_node_status{...}", "instant": true, "format": "table" },
    { "refId": "B", "datasource": { "type": "grafana-testdata-datasource", "uid": "..." },
      "scenarioId": "csv_content", "csvContent": "node,zone\n..." }
  ],
  "transformations": [
    { "id": "joinByField", "options": { "byField": "node", "mode": "outer" } }
  ],
  "options": {
    "queries": { "state": "joinByField-A-B" },
    "grouping": { "kind": "label", "label": "zone" }
  }
}
```

**Rung 3, ranges.** No label and no join: a range table typed straight into
the panel (or, here, held in the `$racks` dashboard variable, which only this
panel references), Grouping > Group by > Ranges. The panel resolves it as a
plain string, so an uninterpolated `$racks` parses as one bad line and places
no node at all rather than failing loudly, which is why the panel's own e2e
test also asserts `ungrouped` stays empty, not only that the three named
groups appear.

**The coverage signal, proven deliberately.** The panel prints a line when
some label would place strictly more nodes than the active source does. Every
demo above covers every node it queries, so that line never fires on any of
them, and proving nothing is not the same as the signal working. One further
panel groups the *entire* 540-node cluster by a range table naming only
`cpu1: c[1-80]`: 80 nodes land in `cpu1`, the other 460 match no range and
draw under `ungrouped`, dashed and marked unplaced, and the warnings strip
both names the 460 and reports that `rack` would cover all 540. Deliberately
incomplete, not a broken panel; its own description says so.

## Browser tests

Chromium runs inside the toolchain container, on the compose network, and
reaches Grafana at `http://grafana:3000` rather than through the published
port. `make e2e` waits for Grafana's health endpoint before starting, so it is
the whole command.

`playwright.config.ts` passes **no Chromium launch flags**. It used to pass
`--no-sandbox --disable-gpu --disable-dev-shm-usage
--disable-software-rasterizer`, which were needed when the browser ran on a
WSL2 host: without them the renderer crashed partway through a navigation and
reported `Target page, context or browser has been closed`, which reads like a
hang and is not one. Inside the container none of that is true (the suite was
re-run with every flag removed and passed) so they were dropped rather than
carried forward, which also leaves Chromium's own sandbox switched on.

If renderer crashes ever come back under a much larger suite, the first thing
to reach for is the container's `/dev/shm`, which Docker caps at 64 MB by
default: `shm_size: '1gb'` on the `tools` service. It is deliberately not set
today, because three consecutive runs at the default passed and configuration
that does nothing is configuration that misleads the next reader.

## The React 19 scan is half a scan

`make react-detect`, which `make check` runs, prints `Failed to load
dependencies, expected a single document in the stream, but found more` before
announcing that no breaking changes were found. Both statements are true and
the second is narrower than it sounds: pnpm 12 writes `pnpm-lock.yaml` as a
two-document YAML stream, `@grafana/react-detect`'s parser accepts a single
document, and so the dependency half of the scan never runs. The half that
does run covers this plugin's own source and bundle, which is the half this
repository can act on. The warning is left visible rather than silenced with
`--skipDependencies`, so that it stops appearing by itself the day either tool
learns about the other.

## Cutting a release

Pushing a tag `v<version>` runs `.github/workflows/release.yml`, which builds
in the same toolchain image as everything else, signs if it can, packages the
archive with its SHA1, runs Grafana's validator against **that** archive, and
publishes a GitHub release carrying both files. Every step of it is a `make`
target you can run yourself:

```bash
make sign       # needs GRAFANA_ACCESS_POLICY_TOKEN; writes dist/MANIFEST.txt
make package    # tomzone-slurm-panel-<version>.zip and its .sha1
make validate   # Grafana's validator, on the archive a release would publish
```

The tag has to agree with `plugins/nodegrid-panel/package.json`; the workflow
refuses the release otherwise, because the archive is named from package.json
and a tag that disagrees publishes one version under another's name.

### Signing, and why the first release is not signed

`make sign` needs an Access Policy token from Grafana Cloud, under *My Account >
Security > Access Policies*, realm set to the organisation, scope
`plugins:write`. Export it as `GRAFANA_ACCESS_POLICY_TOKEN`; it is never
written to a file here and never reaches the repository.

Signing a **public** plugin only works once Grafana has reviewed a first
submission and granted a signature level. Before that the API answers

```
Field is required: rootUrls
```

which reads like a missing argument and is not one: it is Grafana saying it
does not yet know this plugin as a public one. A first submission is allowed
to be unsigned, so the release workflow publishes unsigned when the secret is
absent and signs the moment it is present, with no edit needed between the two.

To sign in CI later, add the token as a repository secret named
`GRAFANA_ACCESS_POLICY_TOKEN`. Nothing else changes.

### Submitting to the catalogue

*Grafana Cloud > Org Settings > My Plugins > Submit New Plugin* asks for the
archive's URL and its SHA1. The release job prints both in its job summary and
repeats them in the release notes.

## Versions are pinned, never floating

`.env` pins `GRAFANA_VERSION`; `docker-compose.yml` pins Prometheus; the
Dockerfile pins Node, pnpm and the Playwright browser. `docker compose up -d`
does not recreate a running container when a tag moves, so a floating `:latest`
silently stays where it was; `slurm_exporter`'s own stack sat nine days behind
on exactly this. Bump deliberately and say so in the commit. CI reads the same
two Grafana variables.
