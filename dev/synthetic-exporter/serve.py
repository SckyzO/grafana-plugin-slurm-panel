#!/usr/bin/env python3
"""Publish a synthetic Slurm cluster in the Prometheus text format.

Shape is set by environment variable, so one image covers a 240-node smoke
test, a 3000-node scale test, and everything between:

    RACKS=4  NODES_PER_RACK=80          # 320 nodes
    RACKS=75 NODES=3000                 # 3000 nodes
    RACKS=3  NODES=100                  # 100 nodes

Give RACKS with NODES_PER_RACK when the total you want is a multiple of some
group size, or NODES directly when it is not. RACKS no longer shapes a node's
name — it exists so dev/relabel/racks.txt, the range table
dev/relabel/generate.mjs turns into Prometheus relabelling, can describe the
same number of groups this cluster is meant to have.

Node names deliberately carry no location: every node is `c<n>` or `g<n>`,
flat, counting within its own family, the same shape the real slurm_exporter
publishes. It reads sinfo, and sinfo has no concept of a rack, so a node name
here that encoded one would hand the panel a location it never had to work
for — the invented rack label this project already removed once, in a
different costume.
"""
import os
import random
from http.server import BaseHTTPRequestHandler, HTTPServer

RACKS = max(1, int(os.environ.get("RACKS", "6")))
NODES_PER_RACK = int(os.environ.get("NODES_PER_RACK", "0"))
NODES = RACKS * NODES_PER_RACK if NODES_PER_RACK > 0 else int(os.environ.get("NODES", "240"))
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
    cpu_count = 0
    gpu_count = 0
    for i in range(1, NODES + 1):
        state = rng.choice(BASE_STATES) + rng.choice(MODIFIERS)
        parts = [PARTITIONS[i % len(PARTITIONS)]]
        if i % 7 == 0:
            parts.append("debug")
        is_gpu = "gpu" in parts
        # Named by family, not by index: c1..cN and g1..gN, counting within
        # each family in generation order. A rack index fed only the name, so
        # once the name no longer needs one there is nothing left to compute.
        if is_gpu:
            gpu_count += 1
            name = "g%d" % gpu_count
        else:
            cpu_count += 1
            name = "c%d" % cpu_count
        nodes.append({
            "name": name,
            "state": state,
            "partitions": sorted(set(parts)),
            "cpus": 128,
            "cpu_alloc": rng.choice([0, 16, 64, 128]),
            "mem": 512000,
            "mem_alloc": rng.choice([0, 64000, 256000]),
            "gpus": 8 if is_gpu else 0,
            "gpu_used": rng.choice([0, 2, 8]) if is_gpu else 0,
            "drained": state.startswith("drain"),
        })
    return nodes


NODES_CACHE = cluster()


def render():
    """Render the exact label sets slurm_exporter publishes.

    Checked against docs/metrics.md in the slurm_exporter repository and
    against a running instance, because a stand-in that invents a label
    teaches a shape no real cluster can produce:

        slurm_node_status                         node, status, partition
        slurm_node_cpu_alloc / cpu_total          node, status, partition
        slurm_node_mem_alloc / mem_total          node, status, partition
        slurm_node_gres_used / gres_total         node, status, partition, gres_type
        slurm_node_drain_reason_info              node, reason
        slurm_node_drain_since_timestamp_seconds  node

    In particular there is no `rack` label, and there is nowhere for one to
    come from: the exporter reads sinfo, and sinfo has no concept of a rack.
    Rack structure lives in the node name here, the same way it does on a real
    cluster, and is recovered by grouping on a capture.
    """
    out = [
        "# HELP slurm_node_status Node state, one series per (node, partition).",
        "# TYPE slurm_node_status gauge",
    ]
    for n in NODES_CACHE:
        for p in n["partitions"]:
            out.append(
                'slurm_node_status{node="%s",status="%s",partition="%s"} 1'
                % (n["name"], n["state"], p)
            )

    # These carry `status` as well, which matters: a node changing state
    # changes these series' identity, and a panel that assumed otherwise would
    # look correct here and break on a real cluster.
    for metric, key in (
        ("slurm_node_cpu_alloc", "cpu_alloc"),
        ("slurm_node_cpu_total", "cpus"),
        ("slurm_node_mem_alloc", "mem_alloc"),
        ("slurm_node_mem_total", "mem"),
    ):
        out.append("# TYPE %s gauge" % metric)
        for n in NODES_CACHE:
            for p in n["partitions"]:
                out.append(
                    '%s{node="%s",status="%s",partition="%s"} %d'
                    % (metric, n["name"], n["state"], p, n[key])
                )

    out.append("# TYPE slurm_node_gres_used gauge")
    out.append("# TYPE slurm_node_gres_total gauge")
    for n in NODES_CACHE:
        if not n["gpus"]:
            continue
        for p in n["partitions"]:
            for metric, value in (
                ("slurm_node_gres_used", n["gpu_used"]),
                ("slurm_node_gres_total", n["gpus"]),
            ):
                out.append(
                    '%s{node="%s",status="%s",partition="%s",gres_type="gpu:model_a"} %d'
                    % (metric, n["name"], n["state"], p, value)
                )

    # The two that carry no partition label, which is the join the panel exists
    # to do: no stock panel can put a drain reason next to a node's state.
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
