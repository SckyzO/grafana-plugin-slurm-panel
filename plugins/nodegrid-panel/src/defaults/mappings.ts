import { MappingType } from '@grafana/data';
import type { ValueMapping } from '@grafana/data';

const rule = (pattern: string, text: string, color: string): ValueMapping => ({
  type: MappingType.RegexToText,
  options: { pattern, result: { text, color } },
});

/**
 * The starting set of state mappings, written around two traps that are not
 * visible from the Value mappings UI and both fail silently.
 *
 * 1. Delimit the pattern. Grafana compiles a bare pattern with
 *    stringToJsRegex, which wraps it in ^...$ — so "^idle" becomes /^^idle$/,
 *    an exact match, and "idle*" falls straight through it.
 * 2. Span the whole value. RegexToText substitutes the result for the matched
 *    portion rather than labelling the value, so "/^drain/ -> drained" renders
 *    "drained" as "draineded".
 *
 * Order still matters on top of both: a modifier rule must come before the
 * base rule that would otherwise swallow it.
 *
 * Colours are theme names, resolved by the theme. No hex.
 */
export const DEFAULT_MAPPINGS: ValueMapping[] = [
  rule('/^.*\\*$/', 'not responding', 'semi-dark-orange'),
  rule('/^.*~$/', 'powered down', 'text'),
  rule('/^idle.*-$/', 'idle, backfill', 'semi-dark-green'),
  rule('/^idle.*$/', 'idle', 'green'),
  rule('/^mixed.*-$/', 'mixed, backfill', 'semi-dark-blue'),
  rule('/^mixed.*$/', 'mixed', 'blue'),
  rule('/^alloc.*-$/', 'allocated, backfill', 'semi-dark-blue'),
  rule('/^alloc.*$/', 'allocated', 'dark-blue'),
  rule('/^drain.*$/', 'drained', 'yellow'),
  rule('/^(down|fail).*$/', 'down', 'red'),
  rule('/^maint.*$/', 'maintenance', 'purple'),
];
