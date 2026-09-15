# Development stack

Self-contained and fully containerised: a toolchain image, Grafana, Prometheus
and a synthetic Slurm exporter. Driven from the repository root with `make`.

```bash
make up      # build the panel, start the stack, wait for Grafana
make e2e     # browser tests against it
make down    # stop, keeping the volumes
```

Grafana on <http://localhost:3001>, dashboard **Slurm / Slurm node grid**.
Port 3001 because `slurm_exporter`'s own stack holds 3000, and Prometheus is
on 9091 for the same reason.

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

Four, provisioned into the **Slurm** folder. Two read Prometheus; two carry
their own data and need nothing running but Grafana.

| Dashboard | Source | What it is for |
|---|---|---|
| Slurm node grid | Prometheus | The overview: one panel, every node, grouped by a capture on the node name |
| Slurm node grid - utilisation | Prometheus | State beside CPU, memory and GPU occupancy, driven by Thresholds |
| Slurm node grid - scenarios | CSV | Hand-written situations that render identically every time |
| Slurm node grid - grouping and layout | CSV | The same nodes grouped four ways, side by side |

The two CSV dashboards use Grafana's built-in TestData source. Each panel
carries its own rows, so there is no exporter, no Prometheus and no scrape
timing between the dashboard and what it shows — which is what makes a
scenario reproducible rather than merely seeded. They are also the honest
place to demonstrate the grouping a real cluster needs: `slurm_exporter`
publishes no `rack` label, so structure has to come from a capture on the
node name.

None of the four configures value mappings. The Slurm state colours
are the panel's own default, so a panel added to a new dashboard is coloured
before anything is configured.

## Two data sources

**Synthetic** (default) produces any cluster shape on demand, including the
states a 20-node docker cluster cannot reach — `blocked`, `perfctrs`, and all
nine state modifiers. Shape it from whichever end you are thinking in:

```bash
SYNTH_RACKS=4  SYNTH_NODES_PER_RACK=80 make up   # 4 racks of 80
SYNTH_RACKS=75 SYNTH_NODES=3000        make up   # 3000 nodes over 75 racks
SYNTH_RACKS=3  SYNTH_NODES=100         make up   # 3 racks of 34, 33, 33
```

You get exactly `SYNTH_RACKS` racks in every case. `SYNTH_SEED` fixes which
node lands in which state, so a screenshot or a failing e2e run reproduces
exactly; `SYNTH_PARTITIONS` renames the partitions.

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

## Versions are pinned, never floating

`.env` pins `GRAFANA_VERSION`; `docker-compose.yml` pins Prometheus; the
Dockerfile pins Node, pnpm and the Playwright browser. `docker compose up -d`
does not recreate a running container when a tag moves, so a floating `:latest`
silently stays where it was — `slurm_exporter`'s own stack sat nine days behind
on exactly this. Bump deliberately and say so in the commit. CI reads the same
two Grafana variables.
