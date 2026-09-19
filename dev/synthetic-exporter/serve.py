#!/usr/bin/env python3
"""Publish a synthetic Slurm cluster in the Prometheus text format.

Shape is set by environment variable, so one image covers a 400-node smoke
test, a 3000-node scale test, and everything between:

    RACKS=4  NODES_PER_RACK=80          # 320 nodes
    RACKS=75 NODES=3000                 # 3000 nodes
    RACKS=3  NODES=100                  # 100 nodes

Give RACKS with NODES_PER_RACK when the total you want is a multiple of some
group size, or NODES directly when it is not. RACKS no longer shapes a node's
name. It exists so dev/relabel/racks.txt, the range table
dev/relabel/generate.mjs turns into Prometheus relabelling, can describe the
same number of groups this cluster is meant to have.

Node names deliberately carry no location: every node is `c<n>` or `g<n>`,
flat, counting within its own family, the same shape the real slurm_exporter
publishes. It reads sinfo, and sinfo has no concept of a rack, so a node name
here that encoded one would hand the panel a location it never had to work
for: the invented rack label this project already removed once, in a
different costume.

PROFILE picks the shape of the state distribution itself, independent of
node count:

    PROFILE=production   # default. A cluster that is working.
    PROFILE=incident      # production, plus one rack down and a drain storm.
    PROFILE=showcase      # every base state and every modifier, uniformly.
                           # Today's old default, kept for demos that want to
                           # show every colour the panel can paint at once.

An unrecognised PROFILE value falls back to production and says so on
stderr, rather than crashing or silently picking something the caller did
not ask for.
"""
import os
import random
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

RACKS = max(1, int(os.environ.get("RACKS") or "6"))
NODES_PER_RACK = int(os.environ.get("NODES_PER_RACK") or "0")
NODES = RACKS * NODES_PER_RACK if NODES_PER_RACK > 0 else int(os.environ.get("NODES") or "540")
# The cluster's four node families. A family is one kind of hardware bought
# in bulk, which is how a real floor is filled: a partition name, the prefix
# its nodes are named with, a share of the cluster, and what one of them is.
#
# Share rather than count, so NODES stays the single knob for cluster size: a
# smoke test at 1080 nodes splits the same way a 540-node one does. The
# default weights are 16:6:1:4 over 540, which comes out at exactly
# 320/120/20/80 - four cabinets of eighty quad-blade nodes, two of sixty
# triples, one of twenty single-node servers and two of forty duos, every
# cabinet twenty slots and every one full. dev/relabel/racks.txt cuts those
# names into the racks that hold them.
FAMILIES = (
    # partition  prefix  weight  memory MB  gpus
    ("cpu",      "c",    16,     512_000,   0),
    ("bigmem",   "b",    6,      4_096_000, 0),
    ("visu",     "v",    1,      512_000,   2),
    ("gpu",      "g",    4,      512_000,   8),
)
SEED = int(os.environ.get("SEED", "1"))

_KNOWN_PROFILES = ("production", "incident", "showcase")
_requested_profile = os.environ.get("PROFILE", "production")
if _requested_profile in _KNOWN_PROFILES:
    PROFILE = _requested_profile
else:
    print(
        "warning: unrecognised PROFILE %r, falling back to 'production' "
        "(known: %s)" % (_requested_profile, ", ".join(_KNOWN_PROFILES)),
        file=sys.stderr,
    )
    PROFILE = "production"

# The full, unweighted spread. Used only by the `showcase` profile: every
# base state and every modifier, uniformly likely, so a dashboard built to
# show every colour the panel can paint still gets the full set at once. This
# used to be the only shape the exporter produced; measured against a real
# cluster it left 3.8% of nodes with an invalid registration, 2.7% down, 1.9%
# failed and only 8.7% idle, which is not a working cluster, it is one in
# permanent crisis. `production` and `incident` below are what a real one
# looks like.
BASE_STATES = [
    "idle", "idle", "idle", "idle", "mixed", "mixed", "allocated",
    "drained", "draining", "down", "fail", "maint", "planned",
    "blocked", "perfctrs", "reserved", "completing", "inval",
]
MODIFIERS = ["", "", "", "", "", "*", "~", "#", "!", "%", "$", "@", "^", "-"]

# `production` and `incident` share this weighted table: a cluster that is
# mostly doing work, with idle capacity behind it and only a sliver of
# anything that needs attention. Weights are percentages measured against a
# real cluster, not invented. See dev/README.md.
PRODUCTION_STATE_WEIGHTS = [
    ("allocated", 54), ("mixed", 20), ("idle", 15), ("drained", 4),
    ("completing", 2), ("planned", 2), ("down", 1), ("maint", 1), ("fail", 1),
]
# `incident` sweeps 15% of its non-forced nodes into drained/draining
# explicitly (see _pick_state below); the other 85% draw from this table,
# the production shape minus `drained`, so that band is what puts drained
# nodes at roughly 15%, rather than stacking on top of production's own 4%.
INCIDENT_BACKGROUND_WEIGHTS = [(s, w) for s, w in PRODUCTION_STATE_WEIGHTS if s != "drained"]

# Flags are rare on a cluster that is working: the large majority of nodes
# carry none at all, with what is left spread evenly across the flags sinfo
# actually prints.
PRODUCTION_MODIFIER_WEIGHTS = [("", 92.0)] + [
    (m, 8.0 / 6) for m in ("-", "*", "~", "#", "@", "$")
]

# dev/relabel/racks.txt calls c[81-160] "cpu2". The exporter itself has no
# way to know that: it reads sinfo, which has no concept of a rack, the same
# reason it has no rack label to publish in the first place. An `incident`
# that wants to take a whole rack down therefore has to pick the block out by
# node ordinal, matching that table by hand, rather than by asking the
# exporter something it structurally cannot answer.
INCIDENT_DOWN_RACK_FIRST = 81
INCIDENT_DOWN_RACK_LAST = 160

# A drain storm where forty nodes share one reason reads as a copy-paste
# artefact, not an incident. Picked per node, deterministically from SEED.
DRAIN_REASONS = [
    "healthcheck: NHC failed",
    "healthcheck: /scratch not mounted",
    "memory error: uncorrectable ECC fault",
    "thermal event: GPU over temperature",
    "administrative hold: pending maintenance",
]


def _weighted_choice(rng, table):
    states, weights = zip(*table)
    return rng.choices(states, weights=weights, k=1)[0]


def _pick_state(rng, name):
    """One node's state, shaped by PROFILE and (for incident) its name."""
    if PROFILE == "incident" and name[0] == "c":
        ordinal = int(name[1:])
        if INCIDENT_DOWN_RACK_FIRST <= ordinal <= INCIDENT_DOWN_RACK_LAST:
            return "down"

    if PROFILE == "showcase":
        return rng.choice(BASE_STATES) + rng.choice(MODIFIERS)

    if PROFILE == "incident" and rng.random() < 0.15:
        return "drained" if rng.random() < 0.5 else "draining"

    table = INCIDENT_BACKGROUND_WEIGHTS if PROFILE == "incident" else PRODUCTION_STATE_WEIGHTS
    return _weighted_choice(rng, table) + _weighted_choice(rng, PRODUCTION_MODIFIER_WEIGHTS)


def _cpus_state(rng, state, total):
    """One node's CPUsState the way `sinfo -O CPUsState` reports it: A/I/O/T,
    with A + I + O == T always.

    `Other` is sinfo's bucket for cores on a node that cannot take work --
    drained, down, reserved, powering off. It is the reason a drained node
    reads zero allocated without being idle, and drawing it beside the state
    rather than from it is what produced twenty-nine `allocated` nodes holding
    nothing at all in this fixture. A stand-in easier than the cluster teaches
    a shape no cluster can produce.

    The suffix never changes the arithmetic: `allocated*` is a node that stopped
    answering while fully allocated, and its cores are still allocated.
    """
    base = state.rstrip("*~#!%$@^-")
    if base in ("idle", "planned", "plnd"):
        return 0, total, 0
    if base in ("allocated", "alloc"):
        return total, 0, 0
    if base in ("mixed", "mix"):
        alloc = rng.choice([16, 32, 64, 96])
        return alloc, total - alloc, 0
    if base in ("completing", "comp"):
        alloc = rng.choice([16, 64])
        return alloc, total - alloc, 0
    if base in ("draining", "drng"):
        # Still finishing what it was given; the rest is already withdrawn.
        alloc = rng.choice([16, 64])
        return alloc, 0, total - alloc
    # Everything left is a node that cannot take work at all.
    return 0, 0, total


def _family_counts(total):
    """Split `total` across the families by weight, exactly.

    Largest remainder rather than plain rounding: the shares have to add back
    up to `total` at any cluster size, and a rounding scheme that loses a node
    would leave it outside every range in racks.txt, which reads on the panel
    as an orphan rather than as the arithmetic slip it is.
    """
    weights = [f[2] for f in FAMILIES]
    scaled = [total * w / sum(weights) for w in weights]
    counts = [int(x) for x in scaled]
    for index in sorted(range(len(FAMILIES)), key=lambda k: scaled[k] - counts[k], reverse=True)[
        : total - sum(counts)
    ]:
        counts[index] += 1
    return counts


def cluster():
    rng = random.Random(SEED)
    nodes = []
    # One family at a time, in declaration order, so c1..cN are contiguous and
    # a range table can name a rack with one hostlist instead of a list.
    plan = []
    for family, count in zip(FAMILIES, _family_counts(NODES)):
        plan.extend([family] * count)
    seen = {}
    for i in range(1, NODES + 1):
        partition, prefix, _weight, mem, gpus = plan[i - 1]
        parts = [partition]
        if i % 7 == 0:
            parts.append("debug")
        is_gpu = gpus > 0
        # Named by family, not by index: c1..cN and g1..gN, counting within
        # each family in generation order. A rack index fed only the name, so
        # once the name no longer needs one there is nothing left to compute.
        # Counted in a dict, not by rescanning `nodes`: the obvious version
        # of this line is a linear search inside the loop that builds the list
        # it searches, which is quadratic in cluster size for no reason.
        seen[prefix] = seen.get(prefix, 0) + 1
        name = "%s%d" % (prefix, seen[prefix])

        state = _pick_state(rng, name)
        cpus = 128
        cpu_alloc, cpu_idle, cpu_other = _cpus_state(rng, state, cpus)
        nodes.append({
            "name": name,
            "state": state,
            "partitions": sorted(set(parts)),
            "cpus": cpus,
            "cpu_alloc": cpu_alloc,
            "cpu_idle": cpu_idle,
            "cpu_other": cpu_other,
            "mem": mem,
            # Memory follows the cores, loosely. It used to follow them
            # exactly - mem * cpu_alloc // cpus - and that made a "memory
            # allocated" panel a pixel-for-pixel copy of the cpu one, which
            # is a panel that cannot be wrong and therefore cannot be read.
            # Real jobs are not balanced: some fill the cores and barely
            # touch the memory, and a bigmem node exists precisely because
            # the opposite happens. The spread is drawn from SEED, so it is
            # the same on every run, and it is clamped because a node cannot
            # hold more memory than it has.
            "mem_alloc": 0 if cpu_alloc == 0 else min(mem, int(mem * cpu_alloc / cpus * rng.uniform(0.55, 1.35))),
            "gpus": gpus,
            # Never more than the node has: a visu node carries two, a gpu
            # node eight, and a fixed choice of [2, 4, 8] would have published
            # eight used out of two on every visu node that was working.
            "gpu_used": (rng.randint(1, gpus) if cpu_alloc > 0 else 0) if is_gpu else 0,
            "drained": state.startswith("drain"),
            "drain_reason": rng.choice(DRAIN_REASONS),
        })
    return nodes


NODES_CACHE = cluster()


def render():
    """Render the exact label sets slurm_exporter publishes.

    Checked against docs/metrics.md in the slurm_exporter repository and
    against a running instance, because a stand-in that invents a label
    teaches a shape no real cluster can produce:

        slurm_node_status                         node, status, partition
        slurm_node_cpu_alloc / cpu_idle / cpu_other / cpu_total
                                                  node, status, partition
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
        ("slurm_node_cpu_idle", "cpu_idle"),
        ("slurm_node_cpu_other", "cpu_other"),
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
                'slurm_node_drain_reason_info{node="%s",reason="%s"} 1'
                % (n["name"], n["drain_reason"])
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
