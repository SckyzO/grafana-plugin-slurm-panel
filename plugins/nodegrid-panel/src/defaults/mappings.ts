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
 * glance. The exact state is always in the cell's label and its tooltip.
 * Colours are theme names, resolved by the theme. No hex.
 */
export const DEFAULT_MAPPINGS: ValueMapping[] = [
  // Suffixes that override the state entirely: whatever the node was doing,
  // it is not doing it now. The other seven suffixes ( # ! % $ @ ^ - ) leave
  // the state readable and are absorbed by the `.*` in the rules below.
  rule('/^.*\\*$/', 'not responding', 'semi-dark-orange'),
  rule('/^.*~$/', 'powered down', 'text'),

  // Available, and working. One blue ramp, light to dark, as occupancy rises.
  rule('/^idle.*-$/', 'idle, backfill', 'semi-dark-green'),
  rule('/^idle.*$/', 'idle', 'green'),
  rule('/^(planned|plnd).*$/', 'planned', 'light-green'),
  rule('/^comp.*$/', 'completing', 'super-light-blue'),
  rule('/^mix.*-$/', 'mixed, backfill', 'light-blue'),
  rule('/^mix.*$/', 'mixed', 'blue'),
  rule('/^alloc.*-$/', 'allocated, backfill', 'semi-dark-blue'),
  // ALLOCATED+ (allocated with jobs still completing) is deliberately not its
  // own rule: it reads as allocated, which is what it is, and the raw state
  // stays visible in the tooltip.
  rule('/^alloc.*$/', 'allocated', 'dark-blue'),

  // Held by an administrator rather than broken.
  rule('/^(drain|drng).*$/', 'drained', 'yellow'),
  rule('/^maint.*$/', 'maintenance', 'purple'),
  rule('/^res.*$/', 'reserved', 'semi-dark-purple'),
  rule('/^(npc|perfctrs).*$/', 'perf counters', 'light-purple'),

  // Broken, or about to be.
  rule('/^(down|fail).*$/', 'down', 'red'),
  rule('/^unk.*$/', 'unknown', 'semi-dark-red'),
  rule('/^inval.*$/', 'invalid registration', 'semi-dark-red'),
  rule('/^block.*$/', 'blocked', 'orange'),

  // Present in the configuration, not currently able to run work.
  rule('/^reboot.*$/', 'reboot', 'light-orange'),
  rule('/^pow.*$/', 'power management', 'text'),
  rule('/^fut.*$/', 'future', 'text'),
];
