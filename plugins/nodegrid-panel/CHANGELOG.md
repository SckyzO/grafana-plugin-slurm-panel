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
source could place, a declared group that matched nothing, a continuous colour
mode whose facet no node carries, a state label nothing arrives under, a
capture pattern that does not compile, a chunk size of zero, and a label that
would group the data more completely than the source in use.

A cell's tooltip leads with the hostname and, on a node carrying one, ends with
the drain reason under its own heading.
