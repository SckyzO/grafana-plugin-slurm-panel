# Getting a real topology out of a cluster that has none

This panel groups nodes. If the data already carries a label worth grouping
by, that is the whole story: **Grouping > Group by > Label**. The rest of
this document is for the more common case: a Slurm cluster whose metrics
say nothing about where a node physically sits.

## Why there is no rack label

`slurm_exporter` reads `sinfo`, and `sinfo` has no concept of a rack, a row
or a room. Slurm tracks partitions, states and resources, not physical
layout. No relabelling rule, no panel option and no amount of configuration
on this side produces a rack label, because the exporter never had one to
give in the first place.

What it does publish, checked against the exporter's own `docs/metrics.md`
and a running instance:

| Metric | Labels |
|---|---|
| `slurm_node_status` | `node`, `status`, `partition` |
| the CPU and memory series (`slurm_node_cpu_alloc` / `cpu_total`, `slurm_node_mem_alloc` / `mem_total`) | `node`, `status`, `partition` |
| the GRES series (`slurm_node_gres_used` / `gres_total`) | `node`, `status`, `partition`, `gres_type` |
| `slurm_node_drain_reason_info` | `node`, `reason` |
| `slurm_node_drain_since_timestamp_seconds` | `node` |

Nothing there says where a node sits. If you want a cell to mean "top of
rack 12", something has to add that meaning from outside the exporter. There
are three ways to do it, and what actually decides which one you can use is
not which is more elegant. It is which privilege you hold.

## The three rungs

### Rung 1: relabel at scrape time

**Needs:** admin access to the Prometheus that scrapes `slurm_exporter`.

Attach a label (`rack`, or whatever you want to call it) with a
`metric_relabel_configs` rule keyed on `node`, the one label every series
above carries. Once it is there, `Grouping > Group by > Label` reads it
directly; nothing else in the panel changes.

This is the best rung whenever you can reach it, because the label does not
belong to this panel. The same `rack` label works in an alerting rule, a
recording rule, or any other dashboard in the org. It is a fact recorded
once, at the source, rather than something reconstructed per panel.

**The trap a hand-written rule falls into.** An operator writing this rule
reaches for the same range syntax `sinfo` prints all day: `regex:
c[1-40]`. Prometheus compiles a relabelling `regex` as
[RE2](https://github.com/google/re2/wiki/Syntax) and anchors it whole, and
in RE2 a bracket is a character class, not a range: `c[1-40]` does not mean
"c1 through c40", it means "c, followed by exactly one of the characters 1,
2, 3, 4 or 0". That rule is right by accident on `c[1-5]` (which really
does only contain the digits 1 through 5) and silently wrong from `c[1-10]`
onward, and nothing about a Prometheus reload or a `/targets` page says so.
The rule just quietly stops matching `c10`, `c11`, and every node after it.
Write it as an expanded alternation of literal node names instead,
`regex: c1|c2|c3|...|c40`, not a range.

### Rung 2: join an inventory

**Needs:** Editor on the dashboard. Nothing upstream of Grafana.

For a Prometheus you cannot or do not want to touch, the alternative is a
second query (a CSV, a SQL table, any tabular datasource) carrying `node`
plus whatever dimension you want, joined onto the metric frame with
Grafana's own transformations. This is the rung that serves the reader of
this document most often: you have Editor on a dashboard, you do not
administer the Prometheus behind it, and you still want a topology.

The chain below is not what Grafana's own transformation docs describe from
memory. It was built and verified panel by panel against a live stack, and
two things about it do not match a first guess:

1. **The panel's own datasource has to be `-- Mixed --`**, not Prometheus.
   Grafana only honours a per-target datasource override, the thing that
   lets query A read Prometheus and query B read something else, when the
   *panel's* datasource is Mixed. Set it on the panel, leave each target's
   own datasource as it already is. Get this wrong and the second query
   never runs at all, silently: no error, no warning, just a panel that
   behaves as if the join were never configured.
2. **Query A needs `Format: Table`**, not the default Time series. An
   instant Prometheus query returns one frame per series; `Format: Table`
   is what turns that into a single frame with `node` and every label
   already a column, before any transformation runs. Without it, a
   transformation such as `Labels to fields` still leaves one frame per
   series, and a join across that many same-refId frames produces a result
   sized by how many series matched the query, not something you can name
   in a panel option.
3. **One transformation: `Join by field`**, `byField: node`, `mode: outer`,
   over query A (now one table frame) and query B (the inventory, also one
   frame). Two frames in, one frame out.
4. **The joined frame's `refId` is not `A`.** `Join by field` names its
   output `joinByField-<refId>-<refId>-...`, one segment per frame it
   joined, so for exactly two queries named `A` and `B` it is deterministically
   `joinByField-A-B`. The panel's **State query** option (under **Data**)
   has to name that string, not the query's own `A`, or the panel reads
   zero frames and shows "No nodes" with nothing in the warnings strip to
   explain why: ingest only warns about a query it can see and cannot
   read, not one it never receives.
5. **Name the inventory's column something the metrics do not already
   carry.** If you join a column called `rack` onto a frame that already
   has a `rack` label from partial relabelling, both sides agree and the
   panel renders identically whichever value the join actually kept, which
   means you cannot tell, by looking at the panel, whether the join is
   doing anything at all. Give the inventory a name of its own.

Written out as the panel JSON actually carries it:

```json
{
  "datasource": { "type": "datasource", "uid": "-- Mixed --" },
  "targets": [
    {
      "refId": "A",
      "datasource": { "type": "prometheus", "uid": "<your-prometheus>" },
      "expr": "slurm_node_status",
      "instant": true,
      "format": "table"
    },
    {
      "refId": "B",
      "datasource": { "type": "grafana-testdata-datasource", "uid": "<your-testdata-or-sql-source>" },
      "scenarioId": "csv_content",
      "csvContent": "node,zone\nc1,aisleA\nc2,aisleA\ng1,aisleC\n"
    }
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

This repository's own dev stack runs exactly this chain against live
Prometheus data. See `dev/README.md`, "Three ways to a topology", for the
worked panel with real node names.

### Rung 3: a range table

**Needs:** Editor on the dashboard. Nothing else.

No relabelling and no second query: type the layout directly into
**Grouping > Group by > Ranges**, in Slurm hostlist syntax (below). The
value can be a literal table or a dashboard variable, so several panels can
share one layout and it can be edited in one place. See "Why a range table
is a panel option" below for why that is the option's actual escape hatch
from feeling like a duplicate of something Grafana should already store.

## Showing part of the cluster

A panel for the cpu racks alone, or for one partition, is a query, not a
panel option. Ask for less:

```promql
slurm_node_status{rack=~"cpu.*"}
slurm_node_status{partition="bigmem"}
```

and group by `rack` or `partition` as usual. The grid names exactly what came
back and the warnings strip stays empty.

There is deliberately no "show only these groups" option. It would hide nodes
the query *did* return, and a node that exists and is not drawn is a node
nobody is watching — the one failure this panel is built to prevent. Nodes the
query never asked for were never the panel's to show, which is a different
thing and an honest one.

**Every declaration table has to follow the query.** Nodes per blade, Slots
per rack and a Ranges table are all inventories: they assert that those groups
exist. One naming a cabinet the query no longer returns says so, and it is
right to:

```
Nodes per blade named 5 groups that are not drawn: bigmem[1-2],gpu[1-2],visu1.
Range "bigmem1" matched no node: b[1-60].
```

That is the same line that catches a rack nobody plugged back in after
maintenance. On a filtered panel it is noise, so filter the tables alongside
the query — `cpu[1-4]: 4` rather than the whole floor — or hold one table per
view in a dashboard variable.

## The hostlist syntax

The range table borrows `sinfo`'s own notation, `c[1-40]`, rather than
inventing a grammar, so it reads the way a Slurm administrator already
reads and writes node sets. The panel and `dev/relabel/generate.mjs` (see
below) share one parser for it, checked directly against
`packages/core/src/group/hostlist.ts` and `packages/core/src/group/ranges.ts`:

1. **One line per group**, `name: hostlist`. The name is whatever you want
   the header to say; the hostlist is everything after the first colon.
2. **A comma outside brackets starts a new item.** `c[1-5],g[1-3]` is one
   hostlist naming two separate node sets.
3. **An item is `prefix[body]suffix`, with exactly one bracket group.**
   `rack[1-2]slot[1-4]`, a second bracket pair in the same item, cannot be
   read; the parser reports it as a bad line and skips it rather than
   guessing. A multi-dimensional floor plan has to be written as one flat
   list of ranges, not a nested expression.
4. **Inside the brackets, comma-separated entries: a bare number, or an
   ascending `start-end` range.** `c[1,5,10-12]` is `c1`, `c5`, `c10`,
   `c11`, `c12`. A descending range such as `c[5-1]` is rejected as
   "counts backwards" rather than silently producing nothing.
5. **A zero-padded start fixes the width of everything it produces.**
   `node[001-100]` expands to `node001` .. `node100`, not `node1`: Slurm
   keeps the written width, and so does this parser.
6. **`#` starts a comment to end of line; blank lines are skipped.** A
   200-line table wants section headings, and this is how you get them
   without breaking the parser.
7. **Expansion is capped at 20,000 names.** A typo like `node[1-100000]` is
   one keystroke away in a table typed by hand; past the cap the line is
   rejected outright rather than hanging the render.

Worked example, exercising several of the rules above:

```
rack1: c[1-5],c[10-12]   # first five, plus three more
rack2: c[41-45]
```

`rack1` expands to `c1, c2, c3, c4, c5, c10, c11, c12`, eight names, from
one line with a comment and two bracket groups joined by a top-level comma.
`rack2` expands to `c41, c42, c43, c44, c45`.

Nothing here throws. A line the parser cannot read is skipped and reported
in the panel's own warnings strip, by line number, while every other line
in the table still parses, because a table typed by hand is invalid for
most of the time it is being typed.

## Why a range table is a panel option when a colour editor was not

This panel deliberately has no button of its own for editing state colour:
Grafana already has a first-class, shared home for that: the standard
**Value mappings** field config, the same one every panel uses. Building a
second, panel-local mechanism for the same thing would duplicate
what Grafana stores, diverge from it the moment someone used the real
editor instead, and be invisible to field overrides and provisioning. See
`docs/value-mappings.md` for the full reasoning.

A range table is a different case, because Grafana has no equivalent
first-class store for physical topology. There is no field config type that
represents "here is the floor plan of a cluster" the way `fieldConfig.defaults.mappings`
represents colour. Writing the range table as a panel option is not
duplicating a mechanism Grafana already provides. It is filling a gap
Grafana leaves, in the absence of anything better.

The objection that follows naturally, "now the layout lives in one panel's
JSON, not shared the way relabelling would be", is answered by the same
field accepting a dashboard variable instead of a literal table. Several
panels can all set **Grouping > Group by > Ranges** to `$racks`, and editing
the layout in **Dashboard settings > Variables** changes it everywhere at
once, on that dashboard, without touching Prometheus.

## The generator

`dev/relabel/generate.mjs` is this repository's own dev-stack fixture, not
a tool it ships or maintains for anyone else's Prometheus. It exists so the
dev stack (`dev/README.md`) can demonstrate rung 1 against a live cluster
without anyone hand-writing a scrape config, by turning a range table (same
syntax as above) into the `metric_relabel_configs` block that attaches
`rack` at scrape time, sidestepping the RE2 trap described under rung 1 by
writing an expanded alternation of literal node names instead of a range:

```
node dev/relabel/generate.mjs <table-file> <job-name> <target>
```

It is worth understanding even if you never run it, because of what it
costs. Prometheus evaluates every configured `metric_relabel_configs` rule
against every sample a scrape returns: one rule per declared rack (or
whatever the range table's groups represent), evaluated against every
series. At 200 racks and a cluster whose metrics amount to roughly 18,000
series, that is 200 × 18,000 = **3.6 million regex evaluations, every
single scrape**. Rung 3, a range table read once by this panel, client-side,
on render, pays none of that cost, because it never touches Prometheus's
scrape path at all. Past a few dozen groups, that difference is itself an
argument for rung 3 over rung 1, independent of which rung your privileges
would otherwise let you reach for.
