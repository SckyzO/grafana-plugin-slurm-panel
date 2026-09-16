# Changelog

## 0.1.0

First release, and an unofficial one: the plugin is not signed and is not in the
Grafana catalogue yet.

One cell per Slurm node, coloured by state out of the box or by CPU, memory or
GPU occupancy through Thresholds. Nodes are grouped by a label, a capture on the
node name, a chunk of its ordinal, or a declared range table, and drawn either
as a wrapping grid or as cabinets on a floor. Several nodes can share one
cabinet slot.

Everything the panel cannot resolve, it names: a query with no node identity, a
state matching no value mapping (with the rule to paste), nodes no grouping
source could place, a declared group that matched nothing, and a label that
would group the data more completely than the source in use.
