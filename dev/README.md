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

## Two data sources

**Synthetic** (default) produces any cluster shape on demand, including the
states a 20-node docker cluster cannot reach — `blocked`, `perfctrs`, and all
nine state modifiers:

```bash
SYNTH_NODES=3000 SYNTH_RACKS=75 make up
```

**Real** points at the `slurm_exporter` test cluster instead. Start it with
`make -C <slurm_exporter>/scripts/testing setup`, then change the Prometheus
scrape target to that cluster's exporter. Drive it with the targets that repo
already ships: `workload N=`, `node-fail`, `node-restore`, `cancel-all`,
`gpu-workers`. Neither path modifies the `slurm_exporter` repository.

Note that the real exporter publishes no `rack` label — only `node`,
`partition`, `status`, `instance` and `job` — so a dashboard built for it
groups by a capture on the node name rather than by rack.

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
