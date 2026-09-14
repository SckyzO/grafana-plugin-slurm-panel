# Design tokens — Slurm node grid

The decisions the panel implements, and the measurements behind them. The
companion review page is `nodegrid-mockups.html` — open it directly, add
`?theme=dark` or `?vision=protan`.

## What the panel does and does not own

A Grafana panel inherits its background, its typeface and its theme. Grafana
draws the frame, the title and the padding. So this design defines **the cell,
the grid, the group, the node card, and the meaning of the colours** — and
nothing else. No brand surface, no display face, no imported font.

## State colours

Produced by the `dataviz` palette validator, not chosen by eye. Validated
against both Grafana surfaces: `#ffffff` light, `#181b1f` dark.

| Role | Hex | Fill | Shape |
|---|---|---|---|
| OK | `#3f7f96` | solid | plain square |
| WARN | `#c98500` | solid | top-right corner cut |
| CRIT | `#d03b3b` | solid | full diagonal |
| UNKNOWN | — | none | 1.5px inset ring, `#8e949c` |

Measured, all-pairs, both modes:

```
lightness band     PASS   all three inside the mode band
CVD separation     PASS   worst pair ΔE 10.2 deutan · 13.9 tritan
contrast vs surface PASS  all three ≥ 3:1 on white and on #181b1f
chroma floor       FAIL   #3f7f96 at 0.074, below the 0.1 floor
```

The chroma failure is deliberate. That floor exists so a categorical series is
not mistaken for a grid line; here the quiet **is** the signal, and UNKNOWN is
separated by shape rather than hue. Documented, not overlooked.

### Why not a traffic light

| Palette | Worst pair, deficient vision | Contrast on white |
|---|---|---|
| green `#0ca30c` / amber `#fab219` / red `#d03b3b` | ΔE **4.1** deutan | amber 1.83:1 |
| Grafana defaults `#73bf69` / `#ff9830` / `#f2495c` | ΔE **6.2** protan | 2.24:1 · 2.15:1 |
| quiet OK | ΔE **10.2** deutan | all ≥ 3:1 |

No choice of hue rescues a traffic light: red against green measures 4.1, red
against a desaturated slate measures 13.0. The separation comes from dropping
chroma on the healthy state. It also fixes a second problem — on a healthy
cluster 95% of cells are OK, and a loud green wall drowns the three red cells
the panel exists to reveal.

These are **defaults**. Colour is user-configurable through the panel options; a
site that wants green sets green, and the shape channel keeps it readable.

## The second channel

The validator permits a palette in the ΔE 6–8 band only with a secondary
encoding. Here the state changes the **shape** of the cell, not only its fill, so
the grid survives greyscale, print, `forced-colors`, deficient colour vision and
being read across a room.

```css
[data-s="WARN"] { clip-path: polygon(0 0, 66% 0, 100% 34%, 100% 100%, 0 100%); }
[data-s="CRIT"] { clip-path: polygon(0 0, 100% 0, 100% 62%, 62% 100%, 0 100%, 0 38%); }
[data-s="UNKNOWN"] { background: transparent; box-shadow: inset 0 0 0 1.5px var(--unknown); }
```

Below 10px the notch stops being legible and the fill carries alone — which is
also where a cell stops being a usable hover target. That is the honest floor of
the density ladder, and the panel says so rather than shrinking past it.

## Type

Grafana's inherited UI face for everything except one case: **node identifiers
are monospaced**. `c04`, `r012c04n03` and `g10` are fixed-width tokens that get
aligned in columns and compared character by character — that is tabular data,
not a small-label decoration. Use the stack Grafana already ships; import
nothing.

```
--id: "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
```

No display face. A panel has no headline.

## Geometry

| Element | Rule |
|---|---|
| Cell | square, `border-radius: 0` below 20px — rounding eats the colour that carries the meaning |
| Cell gap | 2–3px; the gap is what makes a grid readable, not a border |
| Group header | one line, 16px tall, a 2px rail carrying the rolled-up state |
| Rack slot | wide and short (a 1U sled), stacked bottom-up inside a 1px frame with a 3px bottom edge |
| Chrome | no cards, no shadows, no radius on containers |

A rack slot is drawn wide and short because that is what a rack slot is. Drawing
it square turns an elevation back into a list.

## Motion

None, except hover and focus. A wallboard that refreshes every 30 seconds and
animates its transitions produces noise, not information. `prefers-reduced-motion`
is respected anyway.

## Accessibility floor

- Every cell carries an `aria-label` naming the node and its state in words.
- State is never colour alone — shape is the second channel, and the node card
  spells the state out.
- Focus is visible on every cell; the grid is keyboard reachable.
- Contrast verified in both themes against the real Grafana surfaces.
