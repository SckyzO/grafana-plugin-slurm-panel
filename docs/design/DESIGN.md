# Design notes: the Slurm node grid

What was measured, and what the panel does with it. This is **not** a token file:
the plugin hardcodes no colour. Grafana's documented best practice is to take
colour, spacing and typography from theme variables rather than from literals,
and the state colours come from the field config. See the *Colour and options*
section of the spec.

## What the panel owns

A Grafana panel inherits its background, its typeface and its theme. Grafana
draws the frame, the title and the padding. So this design covers **the cell
geometry, the grid, the group header, the node card and the layout**, and
nothing else. No brand surface, no display face, no imported font, no palette.

```ts
const theme = useTheme2();
// spacing, colour, typography all come from here
```

## Where colour comes from

| Question | Mechanism |
|---|---|
| which state is which colour | **Value mappings** (exact + regex, ordered, first match wins) |
| continuous fill for CPU / memory / GPU | **Thresholds** |
| resolving either to a colour | `getDisplayProcessor({ field, theme })` → `field.display(v).color` |
| a named colour to a hex | `theme.visualization.getColorByName('semi-dark-orange')` |

The panel ships **default value mappings**, not a palette. Defaults use theme
colour names, never hex.

The shipped defaults, in order, are delimited whole-value regexes. They are
transcribed from `plugins/nodegrid-panel/data/mappings.json`, the one file
both the panel and the contract suite load; if the two disagree, that file is
right:

```
 1.  /^.*\*$/              →  not responding
 2.  /^.*~$/               →  powered down
 3.  /^alloc.*-$/          →  allocated, backfill
 4.  /^alloc.*$/           →  allocated
 5.  /^mix.*-$/            →  mixed, backfill
 6.  /^mix.*$/             →  mixed
 7.  /^comp.*$/            →  completing
 8.  /^idle.*-$/           →  idle, backfill
 9.  /^idle.*$/            →  idle
10.  /^(planned|plnd).*$/  →  planned
11.  /^(drain|drng).*$/    →  drained
12.  /^maint.*$/           →  maintenance
13.  /^res.*$/             →  reserved
14.  /^(npc|perfctrs).*$/  →  perf counters
15.  /^block.*$/           →  blocked
16.  /^reboot.*$/          →  reboot
17.  /^(down|fail).*$/     →  down
18.  /^unk.*$/             →  unknown
19.  /^inval.*$/           →  invalid registration
20.  /^pow.*$/             →  power management
21.  /^fut.*$/             →  future
```

Four rules govern that list, and three of them are not visible from the Value
mappings UI:

- **Specific before general.** Rule 4 placed before rule 1 swallows `idle*`, and
  a node the controller cannot reach reads as healthy.
- **Delimit the pattern.** A bare `^idle` is compiled by Grafana as `/^^idle$/`,
  an exact match. It fails silently and looks correct.
- **Anchor a modifier at the end, not after the base.** The suffix follows the
  *full* state name. `/^alloc-.*$/` looks right and matches nothing, because the
  state is `allocated-` and the `-` never follows `alloc` directly.
- **Span the whole value.** `RegexToText` substitutes the result for the matched
  portion; `/^drain/ → "drained"` renders `drained` as `draineded`.


## The colour-vision measurements

Run with the `dataviz` palette validator against both Grafana surfaces:
`#ffffff` light, `#181b1f` dark, all pairs. Kept here because they inform an
option, not because the plugin implements them.

| Palette | Worst pair, deficient vision | Contrast on white |
|---|---|---|
| green `#0ca30c` / amber `#fab219` / red `#d03b3b` | ΔE **4.1** deutan | amber 1.83:1 |
| Grafana defaults `#73bf69` / `#ff9830` / `#f2495c` | ΔE **6.2** protan | 2.24:1 · 2.15:1 |
| desaturated OK `#3f7f96` / `#c98500` / `#d03b3b` | ΔE **10.2** deutan · 13.9 tritan | all ≥ 3:1 |

Two things follow.

**No choice of hue rescues a traffic light.** Red against green measures 4.1; red
against a desaturated slate measures 13.0. Separation comes from dropping chroma
on the healthy state, not from hunting a better green. Roughly 8% of men have a
red-green deficiency, and on a wallboard read across a room that is a functional
failure rather than an aesthetic one.

**A wall of saturated green hides what matters.** On a healthy cluster nearly
every cell is OK. Loud green fills the screen and the three red cells the panel
exists to reveal become three pixels in a shouting field. A car dashboard has no
green light for "the engine is fine".

The panel does **not** impose this. Colour follows Grafana, and a site that wants
green sets green. What the measurements justify is the option below.

## The shape channel, an option that ships off

A cell can carry its state as a shape as well as a fill. With it on, the grid
stays readable in greyscale, in print, under `forced-colors`, and with a
red-green deficiency, whatever palette the site chose.

The shape is not a second alphabet for every state. It marks the two families
the fill could not be trusted to separate and leaves the rest alone:

```
not responding, drained, maintenance   top-right corner cut
down, powered down                     bottom-right corner cut
everything else                        plain square
```

It exists because no fill-only arrangement of this palette separated `not
responding` from `allocated`: the two sit at ΔE 4.8 under protanopia. It
nonetheless ships **off**, which is the trade recorded beside the default in
`types.ts` — the notches cost a little legibility at fourteen pixels for every
reader, most readers do not need them, and the rest of the palette is measured
safe. A reader who reads in greyscale, on paper, or with a red-green
deficiency turns it on, and nobody else's grid changes.

A cell with nothing to show, a state no mapping covers or a node with no data in
a continuous mode, is drawn as a hollow ring rather than filled. That one does
not depend on the option: refusing a colour is not a second channel, it is the
absence of the first.

## Geometry

| Element | Rule |
|---|---|
| Cell | square, no border radius below 20px; rounding eats the colour that carries the meaning |
| Cell gap | `theme.spacing(0.25)` to `(0.5)`; the gap is what makes a grid readable, not a border |
| Group header | one line, a rail carrying the rolled-up state |
| Rack slot | wide and short (a 1U sled), stacked bottom-up inside a frame with a heavier bottom edge |
| Chrome | no cards, no shadows, no radius on containers |

A rack slot is drawn wide and short because that is what a rack slot is. Drawing
it square turns an elevation back into a list.

Below 10px a notch stops being legible and a cell stops being a usable hover
target. That is the honest floor of the density ladder, and the panel says so
rather than shrinking past it.

## Type

The inherited Grafana UI face for everything, with one exception: **node
identifiers are monospaced**. `c04`, `r012c04n03` and `g10` are fixed-width
tokens that get aligned in columns and compared character by character: tabular
data, not a small-label decoration. Use the stack Grafana already ships; import
no font.

No display face. A panel has no headline.

## Motion

None, except hover and focus. A wallboard refreshing every 30 seconds that
animates its transitions produces noise, not information. `prefers-reduced-motion`
is respected regardless.

## Accessibility floor

- Every cell carries an `aria-label` naming the node and its state in words.
- The node card spells the state out, so meaning never rests on colour alone even
  with the shape channel off.
- Focus is visible on every cell; the grid is keyboard reachable.
- Contrast is verified in both themes against the real Grafana surfaces.
