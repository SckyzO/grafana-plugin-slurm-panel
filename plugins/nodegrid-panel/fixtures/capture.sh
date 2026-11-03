#!/usr/bin/env bash
# Capture real Prometheus frames from the slurm_exporter test cluster.
#   make -C ../slurm_exporter/scripts/testing setup
# Then: ./capture.sh > node-status.numeric-multi.json
set -euo pipefail

GRAFANA="${GRAFANA:-http://localhost:3000}"
AUTH="${AUTH:-admin:admin}"
DS_UID="${DS_UID:-$(curl -sf -u "$AUTH" "$GRAFANA/api/datasources" \
  | python3 -c 'import json,sys; print(next(d["uid"] for d in json.load(sys.stdin) if d["type"]=="prometheus"))')}"
EXPR="${1:-slurm_node_status}"

curl -sf -u "$AUTH" -H 'Content-Type: application/json' -X POST "$GRAFANA/api/ds/query" \
  -d "{\"queries\":[{\"refId\":\"A\",\"datasource\":{\"type\":\"prometheus\",\"uid\":\"$DS_UID\"},\"expr\":\"$EXPR\",\"instant\":true}],\"from\":\"now-5m\",\"to\":\"now\"}" \
  | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["results"]["A"]["frames"], indent=2))'
