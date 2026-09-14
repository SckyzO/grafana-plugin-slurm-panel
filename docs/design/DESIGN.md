# Design notes — Slurm node grid

What was measured, and what the panel does with it. This is **not** a token file:
the plugin hardcodes no colour. Grafana's documented best practice is to take
colour, spacing and typography from theme variables rather than from literals,
and the state colours come from the field config. See the *Colour and options*
section of the spec.

The companion review page is `nodegrid-mockups.html` — open it directly, add
`?theme=dark` or `?vision=protan`.

## What the panel owns

A Grafana panel inherits its background, its typeface and its theme. Grafana
draws the frame, the title and the padding. So this design covers **the cell
geometry, the grid, the group header, the node card and the layout** — and
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

The shipped defaults are delimited, whole-value regexes:

```
 1.  /^.*\*$/            →  not responding
 2.  /^.*~$/             →  powered down
 3.  /^idle-.*$/         →  idle, backfill
 4.  /^idle.*$/          →  idle
 5.  /^mixed-.*$/        →  mixed, backfill
 6.  /^mixed.*$/         →  mixed
 7.  /^alloc-.*$/        →  allocated, backfill
 8.  /^alloc.*$/         →  allocated
 9.  /^drain.*$/         →  drained
10.  /^(down|fail).*$/   →  down
11.  /^maint.*$/         →  maintenance
```

Three rules govern that list, and two of them are not visible from the Value
mappings UI:

- **Specific before general.** Rule 4 placed before rule 1 swallows `idle*`, and
  a node the controller cannot reach reads as healthy.
- **Delimit the pattern.** A bare `^idle` is compiled by Grafana as `/^^idle$/` —
  an exact match. It fails silently and looks correct.
- **Span the whole value.** `RegexToText` substitutes the result for the matched
  portion; `/^drain/ → "drained"` renders `drained` as `draineded`.


## The colour-vision measurements

Run with the `dataviz` palette validator against both Grafana surfaces —
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

**A wall of saturated green hides what matters.** On a healthy cluster 95% of
cells are OK. Loud green fills the screen and the three red cells the panel
exists to reveal become three pixels in a shouting field. A car dashboard has no
green light for "the engine is fine".

The panel does **not** impose this. Colour follows Grafana, and a site that wants
green sets green. What the measurements justify is the option below.

## The shape channel — an option, off by default

A cell can carry its state as a shape as well as a fill. With it on, the grid
stays readable in greyscale, in print, under `forced-colors`, and with a
red-green deficiency — whatever palette the site chose.

```
OK        plain square
WARN      top-right corner cut
CRIT      full diagonal
UNKNOWN   no fill, inset ring
```

Off by default: the default should look like every other Grafana panel in the
dashboard. On for sites that need the second channel, or that put the panel on a
wall.

## Geometry

| Element | Rule |
|---|---|
| Cell | square, no border radius below 20px — rounding eats the colour that carries the meaning |
| Cell gap | `theme.spacing(0.25)`–`(0.5)`; the gap is what makes a grid readable, not a border |
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
tokens that get aligned in columns and compared character by character — tabular
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
