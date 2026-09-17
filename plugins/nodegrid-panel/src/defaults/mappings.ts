import { MappingType } from '@grafana/data';
import type { ValueMapping } from '@grafana/data';

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
 *    stringToJsRegex, which wraps it in ^...$ — so "^idle" becomes /^^idle$/,
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
 * glance. Six hues carry six decisions -- it works, it is free, a human claimed
 * it, it stopped answering, it is broken, it is gone -- and the shades inside a
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
 * Six hues still cannot carry every distinction -- `not responding` against
 * `allocated` measures 4.8 under protanopia and no reshuffle of this palette
 * fixed it. That is why Shape channel is on by default: the second channel is
 * what makes the first one safe.
 *
 * Colours are theme names, resolved by the theme. No hex.
 */
export const DEFAULT_MAPPINGS: ValueMapping[] = [
  // Suffixes that override the state entirely: whatever the node was doing,
  // it is not doing it now. The other seven suffixes ( # ! % $ @ ^ - ) leave
  // the state readable and are absorbed by the `.*` in the rules below.
  rule('/^.*\\*$/', 'not responding', 'orange'),
  rule('/^.*~$/', 'powered down', 'text'),

  // Green: work is running here. Brighter as the node fills, so a busy
  // cluster reads bright and the commonest state carries the most contrast.
  // The backfill variants keep their own label and share the colour: an
  // operator scanning a floor does not act differently on one.
  rule('/^alloc.*-$/', 'allocated, backfill', 'light-green'),
  // ALLOCATED+ (allocated with jobs still completing) is deliberately not its
  // own rule: it reads as allocated, which is what it is, and the raw state
  // stays visible in the tooltip.
  rule('/^alloc.*$/', 'allocated', 'light-green'),
  rule('/^mix.*-$/', 'mixed, backfill', 'green'),
  rule('/^mix.*$/', 'mixed', 'green'),
  rule('/^comp.*$/', 'completing', 'semi-dark-green'),

  // Blue: capacity sitting free. Nothing is wrong with it and nothing is
  // earning on it.
  rule('/^idle.*-$/', 'idle, backfill', 'blue'),
  rule('/^idle.*$/', 'idle', 'blue'),
  rule('/^(planned|plnd).*$/', 'planned', 'light-blue'),

  // Purple: a human claimed this node. Drained, under maintenance, reserved or
  // counting performance events are one decision for the operator -- find out
  // who and why -- so they are one colour, and the label says which.
  rule('/^(drain|drng).*$/', 'drained', 'dark-purple'),
  rule('/^maint.*$/', 'maintenance', 'dark-purple'),
  rule('/^res.*$/', 'reserved', 'dark-purple'),
  rule('/^(npc|perfctrs).*$/', 'perf counters', 'dark-purple'),

  // Orange: not answering, or on its way somewhere. Not broken, not usable.
  rule('/^block.*$/', 'blocked', 'orange'),
  rule('/^reboot.*$/', 'reboot', 'orange'),

  // Dark red: broken. Dark on purpose -- this is the half of the red-green
  // pair that a deuteranope has to tell from a working node.
  rule('/^(down|fail).*$/', 'down', 'dark-red'),
  rule('/^unk.*$/', 'unknown', 'dark-red'),
  rule('/^inval.*$/', 'invalid registration', 'dark-red'),

  // Grey: present in the configuration, absent from the floor.
  rule('/^pow.*$/', 'power management', 'text'),
  rule('/^fut.*$/', 'future', 'text'),
];
