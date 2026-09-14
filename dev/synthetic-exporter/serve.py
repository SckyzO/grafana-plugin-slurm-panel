#!/usr/bin/env python3
"""Publish a synthetic Slurm cluster in the Prometheus text format.

Shape is set by environment variable, so one image covers a 240-node smoke
test and a 3000-node scale test:

    NODES=3000 RACKS=75 PARTITIONS=cpu,gpu,debug
"""
import os
import random
from http.server import BaseHTTPRequestHandler, HTTPServer

NODES = int(os.environ.get("NODES", "240"))
RACKS = int(os.environ.get("RACKS", "6"))
PARTITIONS = os.environ.get("PARTITIONS", "cpu,gpu,debug").split(",")
SEED = int(os.environ.get("SEED", "1"))

# Weighted so a healthy cluster looks healthy, with every awkward state present.
BASE_STATES = [
    "idle", "idle", "idle", "idle", "mixed", "mixed", "allocated",
    "drained", "draining", "down", "fail", "maint", "planned",
    "blocked", "perfctrs", "reserved", "completing", "inval",
]
MODIFIERS = ["", "", "", "", "", "*", "~", "#", "!", "%", "$", "@", "^", "-"]


def cluster():
    rng = random.Random(SEED)
    nodes = []
    per_rack = max(1, NODES // max(1, RACKS))
    for i in range(1, NODES + 1):
        rack = (i - 1) // per_rack + 1
        state = rng.choice(BASE_STATES) + rng.choice(MODIFIERS)
        parts = [PARTITIONS[i % len(PARTITIONS)]]
        if i % 7 == 0:
            parts.append("debug")
        nodes.append({
            "name": "r%03dn%04d" % (rack, i),
            "rack": "r%03d" % rack,
            "state": state,
            "partitions": sorted(set(parts)),
            "cpus": 128,
            "cpu_alloc": rng.choice([0, 16, 64, 128]),
            "mem": 512000,
            "mem_alloc": rng.choice([0, 64000, 256000]),
            "gpus": 8 if "gpu" in parts else 0,
            "gpu_used": rng.choice([0, 2, 8]) if "gpu" in parts else 0,
            "drained": state.startswith("drain"),
        })
    return nodes


NODES_CACHE = cluster()


def render():
    out = [
        "# HELP slurm_node_status Node state, one series per (node, partition).",
        "# TYPE slurm_node_status gauge",
    ]
    for n in NODES_CACHE:
        for p in n["partitions"]:
            out.append(
                'slurm_node_status{node="%s",partition="%s",status="%s",rack="%s"} 1'
                % (n["name"], p, n["state"], n["rack"])
            )
    for metric, key in (
        ("slurm_node_cpu_alloc", "cpu_alloc"),
        ("slurm_node_cpu_total", "cpus"),
        ("slurm_node_mem_alloc", "mem_alloc"),
        ("slurm_node_mem_total", "mem"),
    ):
        out.append("# TYPE %s gauge" % metric)
        for n in NODES_CACHE:
            for p in n["partitions"]:
                out.append('%s{node="%s",partition="%s"} %d' % (metric, n["name"], p, n[key]))

    out.append("# TYPE slurm_node_gres_used gauge")
    out.append("# TYPE slurm_node_gres_total gauge")
    for n in NODES_CACHE:
        if n["gpus"]:
            out.append('slurm_node_gres_used{node="%s",gres_type="gpu:model_a"} %d' % (n["name"], n["gpu_used"]))
            out.append('slurm_node_gres_total{node="%s",gres_type="gpu:model_a"} %d' % (n["name"], n["gpus"]))

    # No partition label on these two, which is the join the panel exists to do.
    out.append("# TYPE slurm_node_drain_reason_info gauge")
    out.append("# TYPE slurm_node_drain_since_timestamp_seconds gauge")
    for n in NODES_CACHE:
        if n["drained"]:
            out.append(
                'slurm_node_drain_reason_info{node="%s",reason="healthcheck: /scratch not mounted"} 1' % n["name"]
            )
            out.append('slurm_node_drain_since_timestamp_seconds{node="%s"} 1789000000' % n["name"])

    return "\n".join(out) + "\n"


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = render().encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; version=0.0.4")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    HTTPServer(("", 9341), Handler).serve_forever()
