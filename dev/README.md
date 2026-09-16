# Development stack

Self-contained and fully containerised: a toolchain image, Grafana, Prometheus
and a synthetic Slurm exporter. Driven from the repository root with `make`.

```bash
make scrape  # regenerate the Prometheus scrape config from dev/relabel/racks.txt
make up      # build the panel, start the stack, wait for Grafana (runs make scrape first)
make e2e     # browser tests against it
make down    # stop, keeping the volumes
```

Grafana on <http://localhost:3000>, dashboard **Slurm / Node grid**;
Prometheus on <http://localhost:9090>. `make up` prints the address it
actually published, which is not always that one — see below.

## If those ports are taken

A machine that already runs a Grafana or a Prometheus — the `slurm_exporter`
test stack does both — needs this one published beside it rather than on top
of it. Set the two ports in `dev/.env`, which is not tracked:

```ini
GRAFANA_PORT=3001
PROM_PORT=9091
```

Nothing inside the compose network moves: Grafana still answers on 3000 and
Prometheus on 9090 there, which is how the browser tests reach them. Only a
host browser sees the difference, and `make up` reads the published port back
from compose rather than assuming it.

## A dashboard's uid and its panel ids are a contract

The browser suite navigates by `uid` — `/d/slurm-node-grid/...` — and isolates a
panel with `viewPanel=<id>`, which is the panel's own `id` field and not its
position. That is deliberate: it is what let the grouping dashboard be resized
and a ninth panel added without touching a test.

So the titles here are free to change and the layout is free to move, but
**renaming a `uid` or renumbering a panel `id` breaks the suite**. It breaks
loudly, which is the point — but do it knowing that, and update the specs that
name them in the same commit.

None of these files carries a numeric `id` at dashboard level, and none should:
Grafana assigns that, and `allowUiUpdates: false` makes the file the truth.

## The services

| | |
|---|---|
| `tools` | the toolchain: Node, pnpm, Chromium. Not a running service — `docker compose run` starts it for one command and removes it |
| `grafana` | pinned in `.env`, with `dist/` mounted as an unsigned plugin |
| `prometheus` | scrapes the exporter below |
| `synthetic-exporter` | any cluster shape on demand |

The compose project is named `slurm-views` explicitly. Left to Docker it would
be taken from this directory — `dev` — which is neither unique on a machine
hosting several repositories nor recognisable in `docker compose ls`.

## The dashboards

Four, provisioned into the **Slurm** folder. Two read Prometheus outright,
one carries its own data and needs nothing running but Grafana, and one
mixes both — four panels on a hand-written CSV, plus four that read this
dev cluster's live Prometheus.

| Dashboard | Source | What it is for |
|---|---|---|
| Node grid | Prometheus | The overview: one panel, every node, grouped by the `rack` label `make scrape` relabels in (falls back to a capture, a join or a range table on a Prometheus without that relabelling) |
| Utilisation | Prometheus | State beside CPU, memory and GPU occupancy, driven by Thresholds |
| Scenarios | CSV + Prometheus | Hand-written situations that render identically every time, plus one live panel showing what a real, unstaged distribution looks like |
| Grouping and layout | CSV + Prometheus | The same nodes grouped four ways on a hand-written CSV, plus the three live routes to a real topology proven against this dev cluster, plus one panel that deliberately covers less, to prove the coverage warning |

The **scenarios** dashboard uses Grafana's built-in TestData source for its
first four panels, so there is no exporter, no Prometheus and no scrape
timing between the dashboard and what those four show — which is what makes
a scenario reproducible rather than merely seeded. Its fifth panel is the
opposite by design: it reads this dev cluster's live Prometheus, grouped by
rack, against the synthetic exporter's default `PROFILE=production` shape, so
the reader can see what a real, unstaged distribution looks like next to the
staged ones — and it is the one panel on that dashboard that carries no
warnings, on purpose. The first four panels of
**grouping and layout** use the same CSV and the same TestData source, for
the same reason: a side-by-side comparison of Label, Capture, Chunk and
None should render identically on every run, not drift with whatever the
synthetic exporter happens to generate that session. That dashboard's other
four panels are the opposite by design — they read this dev cluster's live
Prometheus, because proving the three routes to a real topology means
proving them against a real scrape.

None of the four configures value mappings. The Slurm state colours
are the panel's own default, so a panel added to a new dashboard is coloured
before anything is configured.

## Two data sources

**Synthetic** (default) produces any cluster shape on demand. `SYNTH_PROFILE`
picks the shape of the state *distribution* itself, independent of node
count — three values, `production` the default:

| `SYNTH_PROFILE` | What it is |
|---|---|
| `production` (default) | A cluster that is working: weighted mostly `allocated` and `mixed`, real idle capacity behind it, and only a sliver of `drained`, `down`, `maint` and `fail` — percentages measured against a real cluster, not invented. |
| `incident` | The same weighted shape, except every node in `rack3` — `c81`..`c120`, the block `dev/relabel/racks.txt` names that way — is `down`, and roughly 15% of the remaining nodes are `drained` or `draining`. |
| `showcase` | A uniform draw over every base state and every one of the nine state modifiers, including states a 20-node docker cluster would otherwise rarely reach, like `blocked` and `perfctrs`. This was the exporter's only shape before this branch; keep it for a dashboard built to show every colour the panel can paint at once. |

An unrecognised value falls back to `production` and says so on the
exporter's stderr, rather than crashing or picking something silently. Drain
reasons are picked per node from a short list of realistic causes — a failed
health check, a filesystem not mounted, a memory error, a thermal event, an
administrative hold — deterministically from `SYNTH_SEED`, so a drain storm
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
at all. Either way, node names carry no location — `c<n>` and `g<n>`, flat,
counting within their own family — because the real exporter's don't.
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
if you put the label there yourself — Prometheus relabelling, a recording rule,
or a join against an inventory — and that is a decision about your scrape
config, not something the panel can do for you.

The synthetic exporter reproduces those label sets exactly, `rack` included in
the sense that it does not have one. An earlier revision invented a `rack`
label, which made every dashboard here work and none of them portable.

This dev stack gets a real `rack` label anyway, through rung 1:
`dev/relabel/racks.txt` declares the floor plan by hand, and
`dev/relabel/generate.mjs` turns it into the `metric_relabel_configs` block
Prometheus reads at scrape time (`make scrape`, which `make up` runs for
you). Neither file ships with the plugin or is maintained for anyone else's
Prometheus — they are this repository's own fixture for standing up a
cluster that has a rack label to demonstrate against. The next section
covers what each of the three rungs actually needs from you.

## Three ways to a topology, and how each one is wired

`dev/relabel/racks.txt` gives this dev cluster a real `rack` label — six
groups, `rack1..rack4` over `c1..c160` and `gpu1..gpu2` over `g1..g80` — by
turning the same table into Prometheus relabelling (`make scrape`, run by
`make up`) that also pastes into the panel's Grouping > Ranges option. That
one file is the input to two of the three routes below; **grouping and
layout** provisions one panel per rung, all three read from a Prometheus
query on that live cluster, and the panel plugin's own e2e suite
(`the three ways to get a topology`) asserts each of them.

The dashboard's nine panels, in provisioned order:

| # | Panel | Grouping | Data |
|---|---|---|---|
| 1 | By a label, in rack layout | Label `rack` | CSV, hand-written — the best case, exporter already publishes the structure |
| 2 | By a capture, splitting compute from GPU | Capture `^([a-z]+)` | CSV, hand-written — recovers node class, not a location |
| 3 | By a chunk of the ordinal | Chunk, size 8 | CSV, hand-written — invents structure, marked `assumed` |
| 4 | Not grouped at all | None | CSV, hand-written — one flat grid |
| 5 | Rung 1 — label, against live Prometheus | Label `rack` | Prometheus, relabelled by `make scrape` |
| 6 | Rung 2 — join, against an inventory the metrics do not carry | Label `zone` | Prometheus (query A) joined to a CSV inventory (query B) |
| 7 | Rung 3 — ranges, against live Prometheus | Ranges, `$racks` dashboard variable | Prometheus |
| 8 | Deliberately incomplete — a range table covering one rack of six | Ranges, `rack1: c[1-40]` | Prometheus, the full 240-node cluster |
| 9 | Blades -- a mixed floor | Label `rack` | Prometheus, with `rack[1-4]: 4` and `gpu[1-2]: 2` declared per group |

Panels 1-4 are the same 20-node CSV, grouped four ways, and need nothing
running but Grafana. Panels 5-8 are rungs 1-3 plus the coverage signal,
proven live against this dev cluster's Prometheus.

**Rung 1 — label.** The plain case, once a `rack` label exists: Prometheus
datasource, `slurm_node_status`, Grouping > Group by > Label, label `rack`.
Nothing else to configure.

**Rung 2 — join.** The Grafana-native answer for anyone whose Prometheus
carries no location dimension at all — no relabelling, nothing to group by —
so the dimension has to come from a second query the panel joins on. This was
designed from Grafana's transformation docs and had never been run before
this task; two things about it turned out not to match the docs, and the
working chain is:

1. **The panel's own datasource must be `-- Mixed --`.** A panel whose
   datasource is Prometheus and that also carries a TestData target simply
   never sends that second query — Grafana only executes per-target
   datasource overrides when the panel itself is Mixed. Query A stays
   Prometheus, query B stays TestData; only the panel-level `datasource`
   changes.
2. **Query A needs Format: Table**, not the default Time series. An instant
   vector query returns one frame per series — `labelsToFields` turns each
   series' labels into columns in place, but that still leaves one frame per
   series, and `Join by field` folds those into a synthetic `refId` string
   with one `-A` per series, which changes size with the query and is not
   something to hardcode. Format: Table asks Prometheus's own datasource to
   hand back a single frame — one row per series, `node` and every label
   already a column — before the transformation pipeline runs at all, so
   there is nothing left for `labelsToFields` to do.
3. **Join by field, `byField: node`, `mode: outer`**, over query A (now one
   table frame) and query B (the CSV, also one frame). Two input frames in,
   one frame out — the part of the docs that did hold.
4. **The joined frame's `refId` is not `A`.** `Join by field` names its
   output `joinByField-<refId>-<refId>-...` for every frame it joined — here,
   deterministically, `joinByField-A-B`. The panel's **State query** option
   (Data > State query, `options.slots.state`) has to name that string, not
   the query's own `A`, or the panel reads zero frames and prints "No nodes"
   with no warning to explain why (ingest only warns about a query it can
   see and cannot read; a query it never receives is silent).
5. **The inventory's column is `zone`, not `rack`.** The first working version
   named it `rack` with the same `rack1`/`rack2`/`gpu1` values relabelling
   already carries on query A — both frames agreed, so the panel rendered
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
    "slots": { "state": "joinByField-A-B" },
    "grouping": { "kind": "label", "label": "zone" }
  }
}
```

**Rung 3 — ranges.** No label and no join: a range table typed straight into
the panel (or, here, held in the `$racks` dashboard variable, which only this
panel references), Grouping > Group by > Ranges. The panel resolves it as a
plain string, so an uninterpolated `$racks` parses as one bad line and places
no node at all rather than failing loudly — the reason the panel's own e2e
test also asserts `ungrouped` stays empty, not only that the three named
groups appear.

**The coverage signal, proven deliberately.** The panel prints a line when
some label would place strictly more nodes than the active source does. Every
demo above covers every node it queries, so that line never fires on any of
them — proving nothing is not the same as the signal working. One further
panel groups the *entire* 240-node cluster by a range table naming only
`rack1: c[1-40]`: 40 nodes land in `rack1`, the other 200 match no range and
draw under `ungrouped`, dashed and marked unplaced, and the warnings strip
both names the 200 and reports that `rack` would cover all 240. Deliberately
incomplete, not a broken panel — its own description says so.

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
hang and is not one. Inside the container none of that is true — the suite was
re-run with every flag removed and passed — so they were dropped rather than
carried forward, which also leaves Chromium's own sandbox switched on.

If renderer crashes ever come back under a much larger suite, the first thing
to reach for is the container's `/dev/shm`, which Docker caps at 64 MB by
default: `shm_size: '1gb'` on the `tools` service. It is deliberately not set
today, because three consecutive runs at the default passed and configuration
that does nothing is configuration that misleads the next reader.

## The React 19 scan is half a scan

`make react-detect`, which `make check` runs, prints `Failed to load
dependencies — expected a single document in the stream, but found more`
before announcing that no breaking changes were found. Both statements are
true and the second is narrower than it sounds: pnpm 12 writes
`pnpm-lock.yaml` as a two-document YAML stream, `@grafana/react-detect`'s
parser accepts a single document, and so the dependency half of the scan
never runs. The half that does run covers this plugin's own source and
bundle, which is the half we can act on. The warning is left visible rather
than silenced with `--skipDependencies`, so that it stops appearing by itself
the day either tool learns about the other.

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

`make sign` needs an Access Policy token from Grafana Cloud — *My Account >
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
absent and signs the moment it is present — no edit needed between the two.

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
silently stays where it was — `slurm_exporter`'s own stack sat nine days behind
on exactly this. Bump deliberately and say so in the commit. CI reads the same
two Grafana variables.
