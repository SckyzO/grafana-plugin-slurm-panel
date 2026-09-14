# Slurm Node Grid — design

Slice 1 of `slurm-views`. Written 2026-09-12, revised 2026-09-14 after checking
every mechanism against the Grafana plugin documentation rather than against
memory. What changed and why is recorded in *Revision*, at the end.

## Why this exists

`slurm_exporter` runs sixteen collectors over roughly 150 metrics and ships ten
Grafana dashboards. They cover the aggregate thoroughly: node states, job states,
CPU/GPU/memory utilisation, partitions, scheduler and backfill internals, RPC
statistics, fairshare, reservations, licences, exporter health.

What no stock panel can render is the per-node view, and the reason is
structural rather than a gap in the dashboards:

```
slurm_node_status{node,status,partition} = 1
```

One series per `(node, partition)` pair. On the test cluster that is 25 series
for 20 nodes: `c1` belongs to `cpu`, `debug` and `high`, so it appears three
times. A `stat` panel counting series reports 25 nodes. A `bargauge` over 2 000
nodes is unreadable. And neither can join `slurm_node_drain_reason_info{node,
reason}` or `slurm_node_drain_since_timestamp_seconds{node}`, which carry no
`partition` label at all.

The value of this panel is the join and the density, not new data.

## Scope

In:

- One Grafana panel plugin rendering one cell per Slurm node.
- Grouping by a key that comes from a label, a capture on the node name, or a
  chunk of the node ordinal — so a cluster can be read as racks without any
  inventory.
- A rack-shaped layout: each group as a fixed-width column of wide, short slots.
- A tooltip carrying the facts a drained node's owner needs: reason, age, CPU,
  memory, GRES per model, partitions.
- Data links, so a click leaves the panel for a node dashboard.
- A provisioned dashboard that uses the panel, which doubles as the end-to-end
  test fixture.
- Prometheus as the only data source.

Out, deliberately, and each is its own later slice:

- **Named views** — switchable presets bundling a grouping, a colour mode and a
  filter, selected from the panel rather than from the options editor. Deferred
  on purpose: which groupings deserve a preset is a question the real cluster
  answers better than we can now. Slice 1bis, not "someday".
- `slurmrestd`, and therefore anything job-level: queue, pending reasons, job
  detail. No backend in this slice, no Go, no JWT, no secrets.
- **U-accurate rack elevation.** Racks can be grouped and drawn rack-shaped
  without any inventory, and that is in scope. Placing a node at its real U, with
  its real height and slot, is not. See Open questions.
- Write operations of any kind.
- Accounting history through `sacct` / `slurmdbd`.

## Decisions taken, and why

**A dedicated repository with its own engine.** `datacenter-view` next door
solves an adjacent problem — where hardware physically sits — and some of its
engine would be reusable. It is a different project with a different premise and
its own release cadence, so `slurm-views` carries its own engine. The duplication
is accepted knowingly; the two answer different questions and are expected to
diverge.

**Prometheus only.** Everything in this slice runs against metrics
`slurm_exporter` already publishes. No change to any cluster, no new service, no
credential.

**Grafana's mechanisms, not our own.** Where Grafana already has a first-class
way to do something — colour from field config, value mappings, thresholds, data
links, standard options — the panel uses it rather than inventing a parallel one.
This is the decision that shrank the slice the most; see *Colour and options*.

**The panel owns node de-duplication.** Identity is the `node` label. Several
series for one node collapse into one cell, and the differing values of the
grouping label are collected into a list. Telling the operator to de-duplicate in
PromQL with `max by (node, status) (...)` puts the trap back on them and breaks
the join with `reason`, which is the specific thing this panel exists to fix.

**Grouping may duplicate, and says so.** When the grouping label is one a node
can hold several values of, the node appears in each group. The header states
both numbers: `20 nodes · 25 slots`. A count that silently disagrees with `sinfo`
is worse than no count.

## Toolchain and compatibility

Verified against the plugin documentation on 2026-09-14, not assumed.

| | |
|---|---|
| Current Grafana | **13.2.1** (`grafana/grafana:latest`), which runs **React 19** |
| `grafanaDependency` | `>=12.3.0` |
| `react` / `react-dom` | `^18.3.0` — the plugin does **not** move to 19 |
| `react/jsx-runtime`, `react/jsx-dev-runtime` | externalised via `create-plugin add externalize-jsx-runtime` |
| `@grafana/data`, `runtime`, `schema`, `ui` | `^12.2.0` or later |
| Lint | ESLint 9 flat config (`eslint.config.js`) |
| Compatibility check | `npx @grafana/react-detect@latest` in CI |

Grafana shares its own React instance with plugins, so a plugin that bundles
React 19 breaks at runtime. The correct posture is *forward compatible*, not *up
to date*: declare 18.3, externalise the JSX runtime, and let the host provide
React. A plugin started today should be born that way rather than migrated into
it later.

## Architecture

An npm workspaces monorepo, Node >= 22.

```
slurm-views/
├── packages/core/            the engine. No Grafana import, no DOM.
│   ├── ingest/frames.ts      Prometheus frames -> SlurmNode[]
│   ├── state/parse.ts        "idle*" -> { base, modifiers } — for display text
│   ├── group/keys.ts         label | capture | chunk -> a grouping key
│   └── group/build.ts        grouping, overlap allowed
├── plugins/nodegrid-panel/   tomzone-slurmnodegrid-panel
│   ├── src/module.ts         panel registration, useFieldConfig, options
│   ├── src/components/       grid, cell, tooltip, group header
│   └── src/editor/           grouping key editor with live preview
├── dev/                      docker compose, provisioning, dashboards
├── tests/e2e/                @grafana/plugin-e2e specs
└── docs/
```

The engine runs under plain Node and imports nothing from Grafana, which keeps
most of the behaviour verifiable without starting Grafana at all, and keeps the
panel thin.

## Data contract

One required query, and a set of optional named facet slots. Each slot is bound
to a query `refId` in the panel options; the provisioned dashboard supplies the
queries.

| Slot | Default query | Shape |
|---|---|---|
| `state` (required) | `slurm_node_status` | identity `node`, state read from the `status` label |
| `cpuAlloc` / `cpuTotal` | `slurm_node_cpu_alloc` / `slurm_node_cpu_total` | scalar |
| `memAlloc` / `memTotal` | `slurm_node_mem_alloc` / `slurm_node_mem_total` | scalar |
| `gresUsed` / `gresTotal` | `slurm_node_gres_used` / `slurm_node_gres_total` | keyed by `gres_type` |
| `drainReason` | `slurm_node_drain_reason_info` | value read from the `reason` label |
| `drainSince` | `time() - slurm_node_drain_since_timestamp_seconds` | scalar, seconds |

Named slots rather than a generic facet system: the tooltip has to know that
`gresUsed` is keyed per GPU model and that `drainSince` is an age in seconds, and
a generic mechanism would push that knowledge into options the operator would
have to configure correctly before seeing anything.

Label names are options, defaulting to what `slurm_exporter` emits. The engine
never hardcodes a label name.

Ingest handles both shapes Prometheus returns — the labels-on-field shape of a
`numeric-multi` result, and the table shape with label columns — because a panel
that reads only one of them sees no labels at all on the other.

## Reading a Slurm state

`sinfo` reports a base state and may glue one modifier character onto it. This is
not a formatting quirk: `scontrol show node` exposes the same thing expanded, as
`State=DOWN+DYNAMIC_NORM+NOT_RESPONDING`. `sinfo` compresses the flags into a
single character, and `slurm_exporter` passes that character through into the
`status` label verbatim.

Observed live on the test cluster under load: **7 of 25 nodes carry `mixed-`**,
the backfill-planned suffix. This is not a rare edge case.

Base states, from the `sinfo` documentation:

```
allocated  blocked  completing  down  drained  draining  fail  failing
future  idle  maint  mixed  perfctrs  planned  power_down  power_up
reserved  unknown
```

`inval` is not in that list but `slurm_exporter` emits it, so the engine accepts
it as a base state.

Modifiers: `*` not responding · `~` powered down · `#` powering up · `!` power
down pending · `%` powering down · `$` maintenance reservation · `@` reboot
pending · `^` reboot issued · `-` planned by the backfill scheduler.

The engine parses `status` into `{ base, modifiers }` **for the display text
only** — so the tooltip can say `mixed, planned by backfill` instead of `mixed-`.
It does not derive severity from it; that is Grafana's job. An unrecognised
trailing character is kept as part of the base state rather than guessed at.

## Colour and options — the Grafana way

Colour is never chosen by this panel and never hardcoded. It comes out of the
field config, resolved against the theme:

```ts
const theme = useTheme2();
field.display = getDisplayProcessor({ field, theme });
const dv = field.display(value);        // dv.text, dv.color
```

The panel registers `.useFieldConfig()` so the standard sections appear in the
editor. A missing `useFieldConfig()` call is a known way to paint every cell the
same colour, so it is covered by an end-to-end test rather than trusted.

| Question | Grafana section | Not ours |
|---|---|---|
| which state is which colour | **Value mappings** — exact and regex, ordered, first match wins, with a theme colour picker | a custom drag-and-drop editor |
| continuous colour for CPU / memory / GPU fill | **Thresholds** | our own scale |
| click-through | **Data links** — `DataLinksContextMenu`, `displayValue.getLinks` | a custom link option |
| units, min/max, display name | **Standard options** | — |

This replaces the two drag-and-drop lists an earlier draft specified. Grafana's
value mappings already express state-to-colour with regex support, in a UI
operators know, with a colour picker bound to the theme palette. Building a
parallel editor would mean writing, testing, documenting and supporting a worse
version of something already there.

The panel contributes **defaults**, not a mechanism: an action that writes a
starting set of value mappings for Slurm states.

Writing those defaults correctly turned out to need two things the Value
mappings UI does not tell you, both established by running
`getDisplayProcessor` rather than by reading about it.

**A bare pattern is anchored at both ends.** Grafana compiles a value-mapping
pattern with `stringToJsRegex`, which wraps anything not delimited by slashes in
`^...$`:

```
"^idle"        compiles to  /^^idle$/        — an exact match on "idle"
"^down|^fail"  compiles to  /^^down|^fail$/  — branch 1 unanchored, branch 2 exact
"/^idle/"      compiles to  /^idle/          — the prefix rule actually intended
```

So a rule typed as `^idle` silently stops being a prefix rule, and `idle*` falls
through it. The delimited form is the only one that means what it looks like.

**`RegexToText` replaces the match, it does not label the value.** The result
text is substituted for the matched portion, and whatever the pattern did not
consume stays glued to it — `/^drain/ → "drained"` turns `drained` into
`draineded`, and `/\*$/ → "not responding"` turns `idle*` into
`idlenot responding`. The pattern must therefore span the whole value.

Both corrections together give the shipped set: delimited, whole-value, specific
before general.

```
 1.  /^.*\*$/            →  "not responding"    a modifier rule must precede
 2.  /^.*~$/             →  "powered down"      the base rule that would
 3.  /^idle.*-$/         →  "idle, backfill"    otherwise swallow it
 4.  /^idle.*$/          →  "idle"
 5.  /^mixed.*-$/        →  "mixed, backfill"
 6.  /^mixed.*$/         →  "mixed"
 7.  /^alloc.*-$/        →  "allocated, backfill"
 8.  /^alloc.*$/         →  "allocated"
 9.  /^drain.*$/         →  "drained"
10.  /^(down|fail).*$/   →  "down"
11.  /^maint.*$/         →  "maintenance"
```

A modifier rule anchors the modifier at the **end**, not after the base: the
suffix follows the *full* state name, and several of these rules abbreviate it.
`/^alloc-.*$/` looks right and matches nothing, because the state is `allocated-`
and the `-` never follows `alloc` directly. `/^alloc.*-$/` is the form that works,
and it is used uniformly so no rule depends on whether its prefix happens to be a
complete base state.

Ordering is still load-bearing — rule 4 placed before rule 1 puts an unreachable
node back to reading as healthy — but the anchoring trap is the one that bites
first, because it fails silently and looks right. States matching nothing
(`perfctrs`, `blocked`, `inval`) keep their raw text and Grafana's default grey,
which is the behaviour *Error handling* asks for.

**Colours use theme names** (`green`, `semi-dark-orange`, `red`, `text`),
resolved through `theme.visualization.getColorByName`. No hex anywhere in the
plugin — the documented best practice is to use theme variables for colour,
spacing and typography rather than hardcoding values.

### The string-field assumption, now tested

`status` is a **string** field, and the mechanism above assumed
`getDisplayProcessor` applies value mappings to string fields. **It does.**
Verified against `@grafana/data` 12.4.10 by resolving the eleven rules above over
nineteen real state values; every one resolved to the intended text and a theme
colour. The numeric-field fallback the earlier draft held in reserve is not
needed and is dropped.

One practical consequence for the test setup: `@grafana/data` touches `window`
and `document` at import time, so any test that imports it runs under
`jsdom`, not under the plain Node environment `packages/core` uses.

### Custom options

What remains genuinely ours, because Grafana has no equivalent:

- identity and state label names (default `node`, `status`)
- the facet slot bindings
- the grouping key source — label, capture or chunk — with a **live preview**
  against the node names actually present, because a regex typed blind into a
  panel option is one nobody can tell is wrong until the panel is empty
- layout (`wrap` or `rack`), cell size, gap
- an optional shape channel (see below), off by default

### The shape channel

A cell can carry its state as a shape as well as a fill — a notch, a diagonal, a
hollow ring. Measured against the palette validator, a green/amber/red grid
separates by only ΔE 4.1 under deuteranopia and Grafana's own default threshold
colours by 6.2 under protanopia, so a shape channel is what makes such a grid
readable in greyscale, in print, under `forced-colors`, and by the roughly 8% of
men with a red-green deficiency.

It ships as an **option, off by default**. The default follows Grafana's
conventions so the panel looks like its neighbours; a site that needs the second
channel turns it on. The measurements are recorded in `docs/design/DESIGN.md` so
the choice is informed rather than forgotten.

## Grouping, and reading a cluster as racks

Grouping is by a key, and the key comes from one of three sources, listed from
most to least trustworthy.

| Source | Example | What it costs |
|---|---|---|
| **label** | `partition`, `gres_type`, or a `rack` label from `file_sd` | nothing; the value is read |
| **capture** | a regex on the node name: `r012c04n03` → `r012` | nothing, where the name encodes position — a vendor convention, not a norm |
| **chunk** | slice the ordinal by N: `compute0421` → rack 11 at 40 per rack | it **invents** structure |

`slurm_exporter` publishes `partition`, `status` and `gres_type`, so label
grouping works out of the box. Nothing it publishes carries a rack, which is why
the other two sources exist.

Chunking is the only source that asserts something the data does not say. In HPC
the numbering usually does follow the floor; usually is not always. So every
group built by chunking keeps an **assumed** marker visible in the panel itself,
not only in the editor.

### Three levels of rack fidelity

**Level 1** — rack as a group — needs only "which node is in which rack", which
the three key sources provide. **Level 2** — the card shaped as a rack — adds an
intra-rack order, which the ordinal in the node name provides, and renders each
group as a fixed-width column of wide, short slots read bottom-up. Both are in
this slice, and together they are the `compact` mode of the Rackscope wallboard.

**Level 3**, placing each node at its true U with its true height, is not in this
slice and is not derivable: height and slot are properties of the hardware, not
of the name. Two consecutively named nodes may be two 1U servers or two blades of
a 2U quad, and no regex tells them apart.

Ordering within a group is by the ordinal in the node name where there is one,
falling back to a natural sort. A node whose name ends in no number still lands
somewhere stable across refreshes, which matters more than being right about a
position nothing told us.

## Rendering and interaction

One cell is one `div`. Rendering is DOM, not canvas. Spacing, colour and
typography come from `useTheme2()` — `theme.spacing()`, `theme.colors.*` — never
from literals.

`layout` chooses how a group is drawn: `wrap` fills the available width, `rack`
renders a fixed-width vertical column read bottom-up. A rack slot is drawn wide
and short because that is what a rack slot is; drawing it square turns an
elevation back into a list. The two differ only in how cells are laid out inside
a group; the cell, the tooltip and the link are identical.

`colorMode` selects one encoding at a time: the mapped state (default), or a
continuous fill from CPU, memory or GPU allocation driven by thresholds. One at a
time is a legibility decision — a cell carrying state as background and
utilisation as an inner bar reads well at 200 nodes and turns to noise at 2 000.

Each group header is one line: a rail carrying the rolled-up state, the name, the
counts, the assumed marker, and the tally.

The tooltip carries: node name, readable state (`mixed, planned by backfill`),
partitions, CPU and memory allocated over total, GRES used over total per model,
drain reason, and drain age.

Node identifiers are monospaced. `c04`, `r012c04n03` and `g10` are fixed-width
tokens that get aligned in columns and compared character by character — tabular
data, not a small-label decoration. Everything else uses the inherited UI font.

### Scale

The realistic target is around 3 000 cells in one panel. Beyond that the answer
is to split the view by region rather than to change the renderer: a single grid
of 10 000 cells is not readable even when it is fast. Past the threshold the
panel renders what it has and shows a warning suggesting a filter, rather than
refusing or silently truncating. The renderer sits behind an interface so a
canvas implementation can replace the DOM one later without touching the engine.

## Error handling

Never paint a node healthy for lack of information.

- A node with no value for the state query stays distinguishable from a node
  whose state matched no mapping. Collapsing the two is how a dead node ends up
  green.
- States matching no value mapping are counted and named in the panel, not only
  in the editor, so a state that appears after a Slurm upgrade is visible.
- A query carrying neither a `node` column nor a `node` label is reported as
  skipped, by `refId`.
- When a facet query returns several rows for one node and the slot expects a
  scalar, the panel reports it rather than keeping an arbitrary row.
- Grouping that places a node in several groups reports both counts.

Warnings render in the panel, not in a console nobody opens.

## Verification

**Engine** — plain TypeScript under Node, table-driven. Covered: both Prometheus
frame shapes; a node in several partitions; the nine modifiers plus an unknown
trailing character; the GRES fan-out with two models on one node; the three key
sources, including a regex that does not compile, a capture that matches nothing,
and a chunk over names carrying no ordinal; and the stability of grouping and
intra-group order across two refreshes returning rows in a different order.

Fixtures come from real exporter output captured against the test cluster, not
hand-written, so the parsers are tested against the shape Prometheus returns.

**End to end** — `@grafana/plugin-e2e`, from the first slice, not added later.
It extends Playwright with fixtures that matter here:

- `gotoDashboardPage` + `readProvisionedDashboard` — the provisioned dashboard is
  the fixture, so the dashboard deliverable and the test are the same artefact.
- `panelEditPage` — exercises the options editor, including that
  `useFieldConfig()` is wired and the standard sections appear.
- `selectors` — resolves per Grafana version, so tests survive releases.

CI runs the matrix produced by `grafana/plugin-actions/e2e-version@main` rather
than a single pinned Grafana, with `wait-for-grafana` before the specs. This is
the mechanism that catches a break on a new Grafana before a user does.

The two defects worth designing the tests around are both invisible to unit
tests: a missing `useFieldConfig()` that paints every cell identically, and an
ingest path blind to the shape Prometheus actually returns.

**Non-regression** — every bug fix lands with a test that fails before it and
passes after. A test that was green all along protects nothing.

## Development environment

`dev/docker-compose.yml` in this repository, self-contained: Grafana **13.x**,
Prometheus, the plugin mounted, unsigned plugin loading allowed, and the
dashboard provisioned from a file so a fresh clone shows something.

`GRAFANA_VERSION` and `GRAFANA_IMAGE` are variables, matching what the e2e
workflow sets, so the same compose file serves local work and CI.

**The image tag is pinned, not floating.** `slurm_exporter`'s own stack floats
Grafana on `:latest` so dashboards are authored against the current release, but
`docker compose up -d` does not recreate a container that is already running when
the tag moves — its Grafana has been 12.4.2 for nine days while `:latest` is
13.2.1. A pinned version that is visibly bumped is honest; a floating tag that
silently does not move is not.

Data comes from either source, by variable:

- **Synthetic** (default) — a small exporter in `dev/` producing any cluster shape
  on demand: 3 000 nodes, every base state, all nine modifiers, overlapping
  partitions, several GRES models. This is the only way to reach the awkward
  cases; a 20-node docker cluster cannot produce `blocked` or `perfctrs`.
- **Real** — point at the Prometheus of `slurm_exporter`'s test cluster
  (`make -C scripts/testing setup`), driven by its existing simulation targets:
  `workload N=`, `node-fail`, `node-restore`, `cancel-all`, `gpu-workers`.

Neither requires modifying the `slurm_exporter` repository.

## Supply chain

Configured at scaffolding time, not retrofitted. Whichever package manager is
chosen must meet the threshold and carry the controls:

| | Minimum | Controls |
|---|---|---|
| pnpm | 11.0.0 | `strictDepBuilds: true`, `dangerouslyAllowAllBuilds: false`, `allowBuilds: {}`, `minimumReleaseAge: 4320`, `blockExoticSubdeps: true` |
| npm | 11.15.0 | `ignore-scripts=true`, `allow-git=none`, `min-release-age=3` |
| yarn | 4.14.0 | `enableScripts: false`, `approvedGitRepositories: []`, `npmMinimalAgeGate: 4320` |

Every tool on this machine is currently below its threshold — npm 11.14.1, pnpm
10.28.2, yarn 1.22.22 — so whichever is picked needs an upgrade before the first
install. pnpm 11 is the recommendation: it has the richest controls, and the
plugin e2e CI template supports it directly.

Dependency ranges stay semver; no git URLs, tarballs, `file:` or `link:` entries.

## Known upstream issue

`slurm_exporter` passes the `sinfo` state suffix into the `status` label verbatim
and its aggregates fold it into the base state, so `slurm_nodes_planned` never
counts a node planned while partially busy — on the test cluster under load, 7 of
25 nodes are `mixed-` while that metric reads 0. Filed as
[SckyzO/slurm_exporter#243](https://github.com/SckyzO/slurm_exporter/issues/243).

This panel does not depend on it being fixed. Ordered value mappings make it
correct against the exporter as it is today and against the history already in
Prometheus. If the exporter later exposes the modifier as its own label, that
label becomes an alternative source and nothing here breaks.

## Open questions

Recorded rather than decided, so they are not rediscovered later.

### Licence — MIT, provisionally

Settled as **MIT** for now. It is permissive: commercial use, modification and
redistribution are all allowed with no obligation to republish anything.

That is deliberately looser than the requirement voiced earlier in the design
conversation — commercial use permitted, modification obliging republication —
which only GPL-3.0 (strong, whole-work) and MPL-2.0 (weak, file-level) satisfy.
The choice stands as made; it is recorded here so the gap is visible rather than
forgotten.

One practical consequence, since the decision is marked provisional: the
copyright holder can relicense their own code at any time, but once outside
contributions land under MIT, moving to a more restrictive licence needs each
contributor's agreement. The window to change direction cheaply closes with the
first accepted pull request, not with the first public commit.

### Slurm state at a node's true U position

Levels 1 and 2 are in this slice and need no inventory. Level 3 needs
`u_position`, `u_height` and a per-model slot matrix, none of which
`slurm_exporter` emits — it publishes no placement label at all. Three candidate
sources, none free:

1. **Derived from the node name.** Already done, and it is what gets levels 1 and
   2. It cannot reach level 3: a name can say which rack and in what order, never
   how many U a node occupies or which chassis slot it sits in.
2. **Per-target labels through `file_sd`.** The standard, tool-agnostic answer,
   and one a site with an inventory can already generate. The cost is a generator
   to write and maintain on the Prometheus side.
3. **A placement file read by `slurm_exporter`.** Tempting, and the one to be
   careful with: the exporter's contract is *expose what Slurm knows*, and Slurm
   knows nothing about racks. Adding a static inventory turns a metrics exporter
   into an inventory database, brings a reconciliation problem nobody asked for —
   a node in the file but not in Slurm, and the reverse — and makes fixing a typo
   in a rack name a redeployment.

Which panel draws the elevation is a second, independent question.

## What comes after this slice

Named views first, once the grid has run against a real cluster long enough to
show which groupings earn a preset. Then the drain board, then a `slurmrestd`
data source, then the live queue, then pages, then cross-tool correlation, then
accounting, then write operations.

Each is usable on its own; none is started before the previous one ships.

## Revision — 2026-09-14

Seven things were wrong or unverified in the first draft. Each was checked
against the Grafana plugin documentation and the plugin skills, not against
memory.

| Was | Is |
|---|---|
| "React stays on 18, toolchain pinned" — reasoning borrowed from another project | Grafana 13.2.1 runs React 19; the plugin declares `react ^18.3.0`, externalises `react/jsx-runtime`, sets `grafanaDependency >=12.3.0` |
| A validated palette with hex values in `DESIGN.md` | Colour comes from field config through `getDisplayProcessor` and `useTheme2`; theme colour names only, no hex |
| Two custom drag-and-drop lists classifying states | Grafana **Value mappings**, with shipped defaults and documented ordering |
| A severity engine, `state/classify.ts`, and a modifier-floor table | Deleted. `state/parse.ts` survives for the tooltip's display text only |
| "A Playwright test" | `@grafana/plugin-e2e` with a Grafana version matrix from `plugin-actions/e2e-version` |
| Dev stack with an unspecified Grafana | Grafana 13.x, version pinned and visibly bumped, `GRAFANA_VERSION`/`GRAFANA_IMAGE` shared with CI |
| Supply chain unmentioned | Thresholds and controls fixed at scaffolding time; every local tool is currently below its threshold |

## Revision — 2026-09-14, second pass

Written while turning the spec into a plan. Running the mechanism beat reading
about it: the assumption flagged above held, and two defects underneath it did
not.

| Was | Is |
|---|---|
| "`getDisplayProcessor` on a string field is unverified; numeric fallback in reserve" | Verified working against `@grafana/data` 12.4.10; the fallback is dropped |
| Defaults written as bare patterns `^idle`, `^mixed`, `^drain`, `^down\|^fail` | Grafana wraps a bare pattern in `^...$`, so four of the five were exact matches that silently never fired. Defaults are delimited: `/^idle.*$/` |
| Defaults assumed a regex mapping labels a value | `RegexToText` *replaces* the match; an unconsumed remainder stays glued to the result. Every pattern now spans the whole value |
| — | `@grafana/data` needs a DOM at import; tests importing it run under `jsdom` |
| "pnpm 11 is the recommendation" | pnpm's current release is **12.4.1**, comfortably above the 11.0.0 floor; the plan pins 12.x |
