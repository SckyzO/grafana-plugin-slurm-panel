# Value mappings for Slurm states

The panel ships a starting set of mappings and then gets out of the way: state
colour is Grafana's **Value mappings**, edited in the panel like any other
field config.

**You do not have to write these.** The panel ships all twenty-one as the default
value of the standard **Value mappings** option, so a panel dropped on a new
dashboard is coloured before anything is configured, and none of the
provisioned dashboards carries a mappings block. They are a default and not a
lock: the rules appear in the panel's own **Value mappings** section and can
be edited, reordered or deleted like any others.

There is still no *button* that writes them, and there cannot be one. A custom
panel option editor — which is what would have to draw such a button —
receives a `StandardEditorContext`, and that interface carries `data`,
`options`, `instanceState` and a handful of others, but no
`onFieldConfigChange`. That handler exists only on `PanelProps`, a different
interface the options editor never sees. What the panel does instead is pass
`standardOptions: { [FieldConfigProperty.Mappings]: { defaultValue: ... } }`
to `useFieldConfig`, which is a supported route to a default and a different
mechanism entirely from an editor writing config at runtime.

The table below therefore documents what you already have rather than what you
must type. Read it when you are changing the rules, adding a state, or
debugging one that is not firing — because a rule edited by hand fails
silently in three distinct ways.

Three traps make hand-written rules fail silently. All three were found by
running `getDisplayProcessor` against real `@grafana/data`, not by reading
about it, and all three are pinned in
[`tests/contract/value-mappings.test.cjs`](../tests/contract/value-mappings.test.cjs)
so a future Grafana release that changes this behaviour breaks CI instead of
breaking a dashboard quietly.

## Delimit the pattern

Grafana compiles a value-mapping pattern with `stringToJsRegex`, which wraps
anything not already delimited by slashes in `^...$`:

| Typed | Compiled | Matches |
|---|---|---|
| `^idle` | `/^^idle$/` | `idle` only — **not** `idle*` |
| `^down\|^fail` | `/^^down\|^fail$/` | inconsistent: branch 1 a prefix, branch 2 exact |
| `/^idle/` | `/^idle/` | `idle`, `idle*`, `idle~` — the prefix rule intended |

A rule typed as `^idle` stops being a prefix rule without saying so, and a
node the controller cannot reach goes back to reading as healthy.

## Span the whole value

A regex mapping **replaces the matched portion**; it does not label the
value. Whatever the pattern did not consume stays glued to the result:

| Pattern | Result text | `drained` renders as |
|---|---|---|
| `/^drain/` | `drained` | `draineded` |
| `/^drain.*$/` | `drained` | `drained` |

## Anchor a modifier at the end, not after the base

`sinfo` glues its backfill suffix onto the *full* state name, not onto an
abbreviated prefix of it. The state Slurm reports is `allocated-`, so a rule
written as `/^alloc-.*$/` — which reads as "alloc, then a dash" — matches
nothing: the dash never follows `alloc` directly, only `allocated`. The
working form anchors the modifier at the end instead:

| Pattern | Matches `allocated-`? |
|---|---|
| `/^alloc-.*$/` | no — `alloc` is not immediately followed by `-` |
| `/^alloc.*-$/` | yes |

The `idle` and `mixed` rules in the shipped set look like they follow the
same shape as `alloc` and happen to work — but only because `idle` and
`mixed` are themselves already complete base states, so there is nothing
abbreviated to trip over. `alloc` is not a complete base state (`allocated`
is), which is what makes it the one that breaks.

## Order

Specific before general. A modifier rule must come before the base rule that
would otherwise swallow it — `/^idle.*-$/` placed above `/^idle.*$/` is what
keeps `idle-` reading as "idle, backfill" rather than falling into the plain
"idle" rule below it. Grafana evaluates value mappings top to bottom and
stops at the first match.

## The shipped set

Transcribed from
[`plugins/nodegrid-panel/src/defaults/mappings.ts`](../plugins/nodegrid-panel/src/defaults/mappings.ts) —
if the two ever disagree, the source file is right and this table is stale.

| # | Pattern | Text | Colour |
|---|---|---|---|
| 1 | `/^.*\*$/` | not responding | `semi-dark-orange` |
| 2 | `/^.*~$/` | powered down | `text` |
| 3 | `/^idle.*-$/` | idle, backfill | `semi-dark-green` |
| 4 | `/^idle.*$/` | idle | `green` |
| 5 | `/^(planned\|plnd).*$/` | planned | `light-green` |
| 6 | `/^comp.*$/` | completing | `super-light-blue` |
| 7 | `/^mix.*-$/` | mixed, backfill | `light-blue` |
| 8 | `/^mix.*$/` | mixed | `blue` |
| 9 | `/^alloc.*-$/` | allocated, backfill | `semi-dark-blue` |
| 10 | `/^alloc.*$/` | allocated | `dark-blue` |
| 11 | `/^(drain\|drng).*$/` | drained | `yellow` |
| 12 | `/^maint.*$/` | maintenance | `purple` |
| 13 | `/^res.*$/` | reserved | `semi-dark-purple` |
| 14 | `/^(npc\|perfctrs).*$/` | perf counters | `light-purple` |
| 15 | `/^(down\|fail).*$/` | down | `red` |
| 16 | `/^unk.*$/` | unknown | `semi-dark-red` |
| 17 | `/^inval.*$/` | invalid registration | `semi-dark-red` |
| 18 | `/^block.*$/` | blocked | `orange` |
| 19 | `/^reboot.*$/` | reboot | `light-orange` |
| 20 | `/^pow.*$/` | power management | `text` |
| 21 | `/^fut.*$/` | future | `text` |

Colours are theme colour names, resolved by the active theme — no hex, so the
defaults stay legible in both the light and dark Grafana surfaces.

States matching none of these keep their raw text, rather than disappearing
or erroring. With the panel's thresholds always configured, Grafana would
colour an unmatched value with the threshold base colour — green, by
default — the same colour a healthy node gets. The panel refuses that
colour for an unmapped state and draws a hollow ring instead, and names the
state in its warnings strip (capped at eight, `and N more` past that), so a
state introduced by a Slurm upgrade is visible instead of quietly reading as
healthy.
