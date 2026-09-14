# Development stack

Self-contained. Grafana, Prometheus and a synthetic Slurm exporter.

```bash
cp dev/.env.example dev/.env
pnpm --filter tomzone-slurmnodegrid-panel build
docker compose -f dev/docker-compose.yml up -d --build
```

Grafana on <http://localhost:3001>, dashboard **Slurm / Slurm node grid**.
Port 3001 because `slurm_exporter`'s own stack holds 3000.

## Two data sources

**Synthetic** (default) produces any cluster shape on demand, including the
states a 20-node docker cluster cannot reach — `blocked`, `perfctrs`, and all
nine state modifiers:

```bash
SYNTH_NODES=3000 SYNTH_RACKS=75 docker compose -f dev/docker-compose.yml up -d
```

**Real** points at the `slurm_exporter` test cluster instead. Start it with
`make -C <slurm_exporter>/scripts/testing setup`, then change the Prometheus
scrape target to that cluster's exporter. Drive it with the targets that repo
already ships: `workload N=`, `node-fail`, `node-restore`, `cancel-all`,
`gpu-workers`. Neither path modifies the `slurm_exporter` repository.

## Grafana version

Pinned in `.env`, never floating. `docker compose up -d` does not recreate a
running container when a tag moves, so `:latest` silently stays where it was.
Bump `GRAFANA_VERSION` deliberately and say so in the commit. CI uses the same
two variables.
