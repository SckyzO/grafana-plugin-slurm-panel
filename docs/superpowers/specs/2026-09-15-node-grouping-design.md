# Node grouping — design

Written 2026-09-15, after establishing that `slurm_exporter` publishes no rack
or location label and cannot be made to: it reads `sinfo`, and `sinfo` has no
concept of one. The node grid was designed around a `rack` label that never
existed. This document replaces that assumption with a mechanism.

It also folds in two small option changes that land in the same slice, because
they touch the same editor section and the same tests.

## The principle

**The panel is never the source of topology. It consumes topology from wherever
it lives, and offers a last resort that says out loud that it is one.**

This is already the panel's posture elsewhere. An unmapped state keeps its raw
text and gets named in the warnings strip rather than being hidden. A `chunk`
group carries an `assumed` marker in its own header, because chunking infers
structure the data never stated. Grouping follows the same rule: the panel may
place a node on a claim it cannot verify, but it must say which claim.

## The three rungs

Where the truth lives, ordered by how well it travels beyond this one view.
What separates them in practice is not elegance — it is **which privilege the
operator needs**.

### Rung 1 — in the data (Prometheus relabelling)

A `metric_relabel_configs` block attaches `rack` at scrape time. The label then
serves alerting, recording rules, `sum by (rack)`, and every other dashboard,
not only this panel.

Privilege: Prometheus admin.
Panel support: **already complete** — `Group by ▸ Label ▸ rack`. No code.
What this slice owes it: a recipe in the plugin README, and a generator (below).

This is the recommended rung, and the documentation says so everywhere it can.

### Rung 2 — in the query (a join transformation)

Grafana's own answer to "my data lacks the dimension my view needs": a second
query carrying the inventory (Infinity against a URL, or the built-in TestData
datasource with pasted CSV), then *Labels to fields* followed by *Join by field*
on `node`. The rack arrives as a column, and the panel already reads string
columns of a table frame as labels.

Privilege: Editor on the dashboard. Nothing more. This is the rung that serves
the Grafana catalogue user who reads a Prometheus somebody else administers.

Panel support: believed complete, **not verified**. Verifying the full chain end
to end is a task in this slice, not an assumption.
What this slice owes it: that verification, and a worked example in `dev/`.

### Rung 3 — in the dashboard (a range table)

A compact node-to-group table written by hand, in Slurm hostlist syntax.

Privilege: Editor on the dashboard.
Panel support: **this is the new mechanism.** Everything below specifies it.

Rung 3 is the only rung that requires development, and the only one that works
when the operator has neither Prometheus access nor the patience to discover a
three-transformation chain.

## Rung 3 — the range table

### Syntax

```
# Row A — machine room north
rack1: c[1-5]
rack2: c[6-10]

# GPU row
gpu:   g[1-10]
```

1. **The right-hand side is one Slurm hostlist expression, and nothing else.**
   No invented grammar: `c[1-10,20,30-35]`, `node[001-100]` with zero padding
   preserved, and comma-joined lists outside brackets — `c[1-10],g[1-5]`. It is
   what `sinfo` prints, so `sinfo -h -o '%N'` output pastes in directly and
   every Slurm administrator already reads it.
2. **The left-hand side is the group's display name**, free text up to the first
   colon, trimmed, spaces allowed: `Rack A3: c[1-40]`.
3. **Line order is display order.** This is a feature, not a side effect: rack
   order on a machine-room floor is not alphabetical, and this table is the only
   place an operator can state it. Neither rung 1 nor rung 2 can express it.
4. **`#` comments to end of line; blank lines are ignored.** A 200-line table
   wants section headings.
5. **An invalid line is skipped and named in the warnings strip; the rest still
   renders.** Same reasoning as the `capture` pattern, which is already compiled
   defensively: this string is typed by hand and is invalid for most of the time
   it is being typed. A grid that vanishes on every keystroke is unusable.
6. **A node listed in two ranges goes to the first line, and the strip says so.**
   Not an error — that would hide the whole grid over a typo. Not silent either —
   a duplicate is a real authoring mistake.
7. **The table is expanded, not matched.** `c[1-5]` becomes five names, then a
   dictionary; lookup is O(1) per node. Expansion needs a hard cap against
   `node[1-100000]`; the cap is a constant, not an option.

### Consequence of expansion, deliberately left open

Expanding means the table states **which nodes are supposed to exist**. A node
listed in the table but absent from Prometheus is a node that stopped being
scraped — roughly the most serious condition a cluster has, and one neither
rung 1 nor rung 2 can see, since both only know nodes that still speak.

This slice does not implement that detection. The syntax and the parsed model
must not foreclose it.

### Where the table is stored

A panel option of type string, carried by the `KeySource` itself, so its path is
`grouping.table` — the same shape `capture` already uses for `grouping.pattern`.

Because it is a string, it may be `$racks` and resolve a dashboard variable:
the panel interpolates with `replaceVariables` from `PanelProps` before parsing.
This is Grafana's documented path — `plugin-tools/how-to-guides/panel-plugins/
interpolate-variables` describes `replaceVariables` as being for "user-defined
template strings for display **or processing** within the panel". Parsing a
range table is processing.

That gives one topology per dashboard, shared by every panel on it, present in
the dashboard JSON, provisionable and versionable with the rest.

### Why a panel option is acceptable here, when it was not for colour

A bespoke colour editor was rejected in the previous slice because Grafana has a
native store for that — value mappings — and a second store would have been
invisible to field overrides, to provisioning, and to every other consumer of
the dashboard JSON.

**Grafana has no native store for node-to-group topology.** A panel option
therefore duplicates nothing; it is the only store. The objection that survives
is per-dashboard duplication, and the dashboard variable above is the answer to
that.

## Changes to the grouping model

`KeySource` gains a fourth variant:

```ts
| { kind: 'ranges'; table: string }
```

`assumed` is **false** for `ranges`. A range table is an explicit human
assertion, not an inference. `chunk` remains the only source that invents.

### Declared order, and groups that are empty

`buildGroups` today derives its groups from the nodes it is given and sorts them
with a natural-order collator, with `UNGROUPED` forced last. Two things break
under a range table:

- line order is meaningless if the result is re-sorted alphabetically;
- a range that matches no node produces no bucket at all, so an empty rack
  cannot be drawn.

Both are solved by one addition to `BuildOptions`:

```ts
/**
 * Group keys declared by the source, in the order they were declared. Groups
 * named here are emitted in this order, and emitted even when empty. Keys not
 * named here keep the natural sort, after them. UNGROUPED stays last.
 */
order?: string[];
```

One mechanism covers both needs: it declares the order *and* declares which
groups must exist regardless of occupancy. The other three sources pass nothing
and keep today's behaviour exactly — this is an addition, not a change, and an
unconfigured user sees no difference.

### Orphans

A node matching no range goes to the existing `UNGROUPED` group.

- **Drawn last.** `buildGroups` already forces this. The table's order is the
  operator's floor plan; one stray node must not push all 240 others down the
  screen.
- **One group, not one per cause.** The concept is identical across sources:
  the panel could not place these. The *strip* names the cause, which differs.
- **Its header carries a marker**, in the same place `chunk` carries `assumed`,
  and for the same reason: nobody reads the strip while looking at the grid, so
  the admission must travel with the data. It is a different admission and takes
  different words — `assumed` means "I invented this group", an orphan group
  means "I could not place these".
- **Its frame is dashed rather than solid**, the same idiom as the hollow ring
  on an unmapped state: the panel refuses to render as normal what it did not
  resolve.
- **The renderer identifies both cases from what already exists** — orphan is
  `group.key === UNGROUPED`, empty is `group.nodes.length === 0`. No new field
  on `NodeGroup`.

**Silence when `Group by` is `none`.** Every node is then in `UNGROUPED` and
that is precisely what was asked for. The strip says nothing. The warning fires
only when a source was chosen and left nodes behind.

### Warning lines

Two independent conditions, two lines, because a cluster mid-recabling shows
both and they must be readable apart:

```
12 nodes matched no range: c[201-212]. Drawn under "ungrouped".
Range "rack7" matched no node: c[213-224].
```

Node lists are collapsed back to hostlist syntax rather than printed one by one,
and capped the way the unmapped-state line is capped.

## The coverage signal

Delivers "Prometheus first" as guidance, with no hidden rule that decides for
the user.

**The panel measures; it does not advise.** "You should use a label" is an
opinion and becomes noise on second reading. "Label `rack` would group all 240"
is a fact, and a fact extinguishes itself when it stops being true.

### What is computed

One pass over the nodes per render. For each candidate label, how many nodes it
would classify; for the active source, how many it actually classified.

Candidates are the labels already kept in `SlurmNode.labels` — those whose value
agrees across every series for that node — **minus** three exclusions:

- the node label itself, which has a distinct value per node;
- the state label, which changes between scrapes: that is a measurement, not a
  topology;
- any label whose distinct-value count equals the node count — an identity in
  disguise, not a group.

`partition` excludes itself already: the model drops it from `labels` because it
varies per series, and models it separately as `partitions`.

### When it speaks

**Only when some candidate label covers strictly more nodes than the active
source does.** Otherwise, silence. No special cases are needed to get the right
behaviour:

| Situation | Result |
|---|---|
| no labels at all | silent, permanently |
| relabelling done, grouping by that label | active source covers as much — silent |
| `ranges` with a complete table | silent, even though a label exists |
| `ranges`, 12 orphans, a label covers them | **speaks** |
| `chunk`, which invents, while a label exists | **speaks** |

This is the strip's existing philosophy: the panel speaks when it is unsure and
stays quiet when it is not.

### What it prints

In the warnings strip, in the same voice as the rest:

```
Label "rack" would group all 240. Grouping ▸ Group by ▸ Label.
```

It does **not** claim that `rack` means rack — the panel cannot know that. It
names a label and a number; the human recognises the name.

It changes nothing automatically. Ever. A panel that reconfigures itself is
exactly what was rejected when runtime precedence was rejected: a Ranges panel
must not start grouping from somewhere else because a third party added a label
to the scrape, with nothing in its JSON to explain it.

## The relabel generator

Turns a range table into rung 1.

**Input:** a file in the rung-3 format — the same text one would paste into the
panel.

**Output**, on stdout, one rule per group:

```yaml
metric_relabel_configs:
  - source_labels: [node]
    regex: c1|c2|c3|c4|c5
    target_label: rack
    replacement: rack1
```

Expanded alternation is mandatory, and it is the trap a human writing this by
hand falls into: Prometheus regexes are RE2, not hostlists. `c[1-40]` there does
not mean "c1 through c40" — it means "c followed by one of 1, 2, 3, 4, 0". It
works by accident on `c[1-5]` and is silently wrong from `c[1-10]` onward. That
is the generator's reason to exist.

**Written in TypeScript, importing the parser from `packages/core`.** Not in
Python despite the synthetic exporter being Python: a second implementation of
the hostlist grammar is how the two drift apart, and the claim "one table, two
destinations" does not survive two parsers. The generator owns no grammar — it
expands through the shared parser, then prints the alternation.

**It is not dead code, because the dev stack depends on it.** The synthetic
exporter publishes no rack label, by design, since it mirrors the real exporter.
So the dev stack currently cannot demonstrate rung 1 at all. Generating `dev/`'s
`metric_relabel_configs` from a checked-in range table means the generator runs
on every `make up`, all three rungs become demonstrable against the same data,
and the format gains a second consumer — the only proof that it is a format
rather than an internal structure with punctuation.

**It does not write anyone's `prometheus.yml`.** It prints; `dev/` redirects.

**Documented cost:** one rule per rack, evaluated per sample. 200 racks against
18,000 series is 3.6M regex evaluations per scrape. Prometheus anchors and
optimises these, so it holds — but it belongs in the documentation rather than
in a production surprise. Worth noting that on a very large cluster this is an
argument *for* rung 3, where the table is parsed once per render instead of
re-evaluated on every scrape.

## Two option changes in the same slice

### `maxCells` is removed

Verified: it does nothing but print one strip line. That line warns about the
single property of the panel that is impossible to miss — that there are a lot
of cells. Worse, it is an *option*, so the user configures the threshold at
which they will be told what is already in front of them. Configuration with
zero information.

Removed: one option, one strip branch, two tests. Nothing replaces it. The one
case where the count is not self-evident is a grid that overflows into scroll,
and the answer to that would be a neutral count, not a tunable warning — not
built here.

### `cellSize` splits into `cellWidth` and `cellHeight`

A node is a 1U sled: wider than tall. The code already concedes this privately —
`rackWidthFor = cellSize × 4`, `sledHeightFor = cellSize ÷ 2`. The non-square
proportion exists; it is merely derived instead of stated.

Both are **optional**, and that is what keeps the change non-breaking, because
the two layouts disagree about the natural shape of a cell:

```ts
const width  = options.cellWidth  ?? options.cellSize ?? 14;
const height = options.cellHeight ?? (layout === 'rack' ? sledHeightFor(width) : width);
```

- `wrap` renders a square today, so an unset height falls back to the width.
- `rack` renders a sled at `sledHeightFor(width)` — 7px at the default — so an
  unset height keeps deriving it.

A fixed default of 14 for both would silently double the sled height in `rack`
layout; a fixed default of 7 would flatten every cell in `wrap`. Leaving them
unset preserves both layouts byte-for-byte for anyone who has configured
nothing, which is the majority. `cellSize` is read as the fallback for width, so
a dashboard carrying the old option keeps working — phase 1 of the two-phase
rule.

`rackWidthFor` survives unchanged, deriving the cabinet frame from the width.
`sledHeightFor` survives too, demoted from "the rule" to "the default when the
operator has not said".

## Testing

Non-regression is a test, not an intention. Each of these fails before its
change and passes after.

**Hostlist parser** (`packages/core`, no Grafana):
- ranges, lists, nested commas, zero padding preserved
- comment and blank-line handling
- an invalid line is skipped and reported, and the valid lines still parse
- a node in two ranges resolves to the first, and the duplicate is reported
- the expansion cap trips on an absurd range rather than hanging

**Grouping** (`packages/core`):
- declared order is honoured, and unnamed keys sort naturally after it
- a declared group with no nodes is emitted, empty, in its declared position
- `UNGROUPED` stays last regardless of the declared order
- the other three sources are byte-identical with no `order` passed

**Coverage signal** (`packages/core`):
- silent when the active source covers as much as the best candidate
- silent with `Group by ▸ none`
- speaks when a label strictly beats the active source
- never nominates the node label, the state label, or an identity label

**Generator contract** (the test that earns the generator):
- for a given table, every node the parser places in group `R` is matched by the
  generated regex for `R`, and by no other. It fails if emission mis-escapes a
  character or drops a zero padding. This is the contract between the panel and
  Prometheus, made executable.

**Panel** (jest + Playwright against the dev stack):
- an orphan group renders last, dashed, with its marker
- an empty declared group renders in position
- the two strip lines appear independently
- a `$variable` in the range option is interpolated before parsing
- with `cellWidth`/`cellHeight` unset, `wrap` still renders a square and `rack`
  still renders `sledHeightFor(width)` — the non-breaking claim, asserted
- a dashboard carrying only the old `cellSize` renders as it did

**Rung 2 verification** (a task, not an assumption):
- the Prometheus → *Labels to fields* → *Join by field* chain produces a frame
  whose `rack` column the panel groups by, proven against the dev stack

## Out of scope, deliberately

- Detecting nodes present in the table but absent from Prometheus. The syntax
  allows it; this slice does not build it.
- Runtime precedence between sources. Rejected: it makes a panel change
  behaviour because of an edit made elsewhere, with nothing in its JSON to
  explain it.
- Any automatic switching of `Group by`. The signal informs; it never acts.
- A UI builder for the range table. It is text, in a syntax its audience
  already reads and writes daily.
- Shipping the generator as a supported product. It is `dev/` furniture that the
  stack happens to depend on; nobody is promised its maintenance.

## Decisions taken in the brainstorming session, for the record

| Question | Decision |
|---|---|
| Where should topology live? | Prometheus first; the panel never sources it |
| Is rung 3 in? | In |
| Orphan nodes? | Stay visible — drawn, marked, and named |
| A range matching no node? | Drawn empty **and** named in the strip |
| Prometheus-first: guidance or runtime precedence? | Guidance, plus a measured signal |
| Range table in a dashboard variable? | Yes — Grafana documents `replaceVariables` for it |
| Does the repo ship the generator? | Yes, in `dev/`, because the dev stack uses it |
| `maxCells`? | Removed |
| `cellSize`? | Splits into width and height |
