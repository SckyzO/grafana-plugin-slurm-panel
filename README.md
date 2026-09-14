# slurm-views

Grafana panels for reading a Slurm cluster per node rather than in aggregate.

`slurm_exporter` publishes one series per `(node, partition)` pair:

```
slurm_node_status{node="c1",partition="cpu",status="mixed-"} 1
```

On the test cluster that is **25 series for 20 nodes** — `c1` belongs to `cpu`,
`debug` and `high`, so it appears three times. A `stat` panel counting series
reports 25 nodes. And no stock panel can join `slurm_node_drain_reason_info{node,reason}`,
which carries no `partition` label at all, so the reason a node is drained
cannot be shown beside its state.

The value of this panel is the join and the density, not new data.

## What is here

| | |
|---|---|
| `plugins/nodegrid-panel` | `tomzone-slurmnodegrid-panel` — one cell per node |
| `packages/core` | the engine: ingest, state parsing, grouping. No Grafana import |
| `dev/` | the toolchain image, and a self-contained Grafana + Prometheus + synthetic exporter stack |

## Getting started

You need **Docker and make**. Nothing else — no Node, no pnpm, no browser.

```bash
make check   # lint, typecheck, every test, build
make up      # Grafana on http://localhost:3001, panel loaded
make e2e     # browser tests against that stack
```

`make` on its own lists every target. Everything runs inside the image built
from [`dev/Dockerfile.toolchain`](dev/Dockerfile.toolchain), including the
browser, and `node_modules` lives in Docker volumes rather than in the
checkout, so a clone leaves nothing behind on the machine that cloned it.

See [`dev/README.md`](dev/README.md) for the dev stack and its two data
sources, [`CONTRIBUTING.md`](CONTRIBUTING.md) for how the toolchain is pinned,
and [`docs/value-mappings.md`](docs/value-mappings.md) before touching a Value
mapping by hand — the rules that colour a Slurm state fail silently when
written the obvious way.

## Licence

Apache-2.0.
