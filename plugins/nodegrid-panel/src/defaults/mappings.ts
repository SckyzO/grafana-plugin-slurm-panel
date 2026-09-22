import { MappingType } from '@grafana/data';
import type { ValueMapping } from '@grafana/data';
import RULES from '../../data/mappings.json';

const rule = (pattern: string, text: string, color: string): ValueMapping => ({
  type: MappingType.RegexToText,
  options: { pattern, result: { text, color } },
});

/**
 * Every node state sinfo can print, mapped. The list is taken from the NODE
 * STATE CODES section of the sinfo man page, states and abbreviations both:
 * sinfo reports the long form under `StateLong:` (which is what slurm_exporter
 * asks for) and the short form under `%t`, and a panel that only knew one of
 * the two would leave half a cluster uncoloured.
 *
 * Three traps are not visible from the Value mappings UI and all fail silently.
 *
 * 1. Delimit the pattern. Grafana compiles a bare pattern with
 *    stringToJsRegex, which wraps it in ^...$, so "^idle" becomes /^^idle$/,
 *    an exact match, and "idle*" falls straight through it.
 * 2. Span the whole value. RegexToText substitutes the result for the matched
 *    portion rather than labelling the value, so "/^drain/ -> drained" renders
 *    "drained" as "draineded".
 * 3. Abbreviations are not prefixes of the long form. DRAINING abbreviates to
 *    `drng` and MIXED to `mix`, so /^drain.*$/ misses one and /^mixed.*$/
 *    misses the other. Where the two share a prefix, the shorter one is used.
 *
 * Order matters on top of all three: a modifier rule must come before the base
 * rule that would otherwise swallow it, and the two suffixes that mean the node
 * cannot run work at all come before every state.
 *
 * Colour encodes what an operator can do with the node, not which state it is
 * in: there are twenty-one states and no palette distinguishes that many at a
 * glance. Six hues carry six decisions (it works, it is free, a human claimed
 * it, it stopped answering, it is broken, it is gone) and the shades inside a
 * hue say the degree, never the decision. The exact state is always in the
 * cell's label and its tooltip.
 *
 * Lightness is not decoration here, it is the safety channel. Protanopia and
 * deuteranopia collapse the red-green axis and preserve light against dark:
 * measured on this theme, `green` against `red` is Delta E 32 to a full-colour
 * reader and 4.6 to a deuteranope, while `light-green` against `dark-red` is 32
 * and 25. So what works is drawn light and what is broken is drawn dark, which
 * is the one pair an operator cannot afford to confuse.
 *
 * Green rises with occupancy rather than falling: a fuller node is a brighter
 * node, which also puts the most common state of a busy cluster at the highest
 * contrast against the background.
 *
 * Six hues still cannot carry every distinction: `not responding` against
 * `allocated` measures 4.8 under protanopia and no reshuffle of this palette
 * fixed it. That is why Shape channel exists, though it ships off — see the
 * note on the option in types.ts for that trade. The shape does not
 * encode twenty-one states either. It separates the two families the fill could
 * not (see `shapeFor` in NodeCell), which is what makes that pair safe.
 *
 * Colours are theme names, resolved by the theme. No hex.
 *
 * The rules themselves live in `data/mappings.json`, outside `src/`, because the
 * contract suite has to assert against the list that actually ships. It used
 * to keep a transcribed copy, and the copy drifted: same patterns, a wholly
 * different palette, and a discrimination threshold calibrated on colours no
 * build had produced in months. Data in one file both readers load cannot
 * drift; a transcription always can.
 *
 * Outside `src/` on purpose. The scaffolded bundler copies every `.json`
 * under `src/` into the archive verbatim, so keeping it there shipped a copy
 * of these rules as a loose file the built `module.js` never reads — an
 * operator editing it in an installed plugin would change nothing. Webpack
 * inlines it from here just the same.
 *
 * **The order is behaviour, not presentation.** Grafana applies mappings in
 * order and the first match wins, so `/^idle.*-$/` has to precede
 * `/^idle.*$/` or the backfill variants disappear into the general rule.
 * Never sort that file.
 *
 * What each family means, in the order the file lists them:
 *
 * - **Suffix overrides** come first: whatever the node was doing, it is not
 *   doing it now. The other seven suffixes ( # ! % $ @ ^ - ) leave the state
 *   readable and are absorbed by the `.*` in the rules below.
 * - **Green** — work is running here. Brighter as the node fills, so a busy
 *   cluster reads bright and the commonest state carries the most contrast.
 *   The backfill variants keep their own label and share the colour: an
 *   operator scanning a floor does not act differently on one. ALLOCATED+
 *   (allocated with jobs still completing) is deliberately not its own rule:
 *   it reads as allocated, which is what it is, and the raw state stays
 *   visible in the tooltip.
 * - **Blue** — capacity sitting free. Nothing is wrong with it and nothing is
 *   earning on it.
 * - **Purple** — a human claimed this node. Drained, under maintenance,
 *   reserved or counting performance events are one decision for the operator
 *   (find out who and why) so they are one colour, and the label says which.
 * - **Orange** — not answering, or on its way somewhere. Not broken, not
 *   usable.
 * - **Dark red** — broken. Dark on purpose: this is the half of the red-green
 *   pair that a deuteranope has to tell from a working node.
 * - **Grey** — present in the configuration, absent from the floor.
 */
export const DEFAULT_MAPPINGS: ValueMapping[] = RULES.map(({ pattern, text, color }) => rule(pattern, text, color));
