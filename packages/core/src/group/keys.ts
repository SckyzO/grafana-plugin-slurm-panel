import type { SlurmNode } from '../model/types.js';
import { parseRangeTable } from './ranges.js';

export type KeySource =
  | { kind: 'label'; label: string }
  | { kind: 'capture'; pattern: string }
  | { kind: 'chunk'; size: number }
  | { kind: 'ranges'; table: string }
  | { kind: 'none' };

export interface KeyResult {
  key: string;
  /** True when the key asserts structure the data did not state. */
  assumed: boolean;
}

export const UNGROUPED = 'ungrouped';

const NO_KEY: KeyResult = { key: UNGROUPED, assumed: false };

/** The trailing number of a node name, the only ordering signal a name carries. */
export function ordinalOf(name: string): number | undefined {
  const match = /(\d+)\s*$/.exec(name);
  if (!match?.[1]) {
    return undefined;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function makeKeyFn(source: KeySource): (node: SlurmNode) => KeyResult {
  switch (source.kind) {
    case 'label':
      return (node) => {
        const value = node.labels[source.label];
        return value === undefined ? NO_KEY : { key: value, assumed: false };
      };

    case 'capture': {
      // Compiled once, not per node, and never allowed to throw: this pattern
      // is typed into a panel option by hand and is invalid most of the time
      // it is being typed.
      let regex: RegExp | undefined;
      try {
        regex = new RegExp(source.pattern);
      } catch {
        regex = undefined;
      }
      return (node) => {
        const captured = regex?.exec(node.name)?.[1];
        return captured === undefined ? NO_KEY : { key: captured, assumed: false };
      };
    }

    case 'ranges': {
      // Parsed once per key function, not once per node.
      const { index } = parseRangeTable(source.table);
      return (node) => {
        const key = index.get(node.name);
        // A range table is an explicit human assertion, not an inference, so
        // it is never `assumed`. Chunking remains the only source that invents.
        return key === undefined ? NO_KEY : { key, assumed: false };
      };
    }

    case 'chunk':
      return (node) => {
        if (!Number.isInteger(source.size) || source.size <= 0) {
          return NO_KEY;
        }
        const ordinal = ordinalOf(node.name);
        if (ordinal === undefined) {
          return NO_KEY;
        }
        // Chunking is the one source that asserts something the data does not
        // say. In HPC the numbering usually follows the floor; usually is not
        // always, so the claim travels with the key.
        return { key: `chunk ${Math.floor((ordinal - 1) / source.size) + 1}`, assumed: true };
      };

    case 'none':
    default:
      return () => NO_KEY;
  }
}

/**
 * The group keys a source states up front, in the order it stated them.
 *
 * Only a range table does. A label or a capture discovers its groups by
 * reading nodes, so it can neither choose their order nor name one that turned
 * out to be empty — and rack order on a machine room floor is not alphabetical.
 *
 * This parses the table a second time, and that is deliberate: it is a pure
 * function over a string of at most a few kilobytes, and caching it would put
 * mutable module state into a package whose whole value is being pure.
 */
export function declaredKeys(source: KeySource): string[] {
  return source.kind === 'ranges' ? parseRangeTable(source.table).groups.map((g) => g.name) : [];
}
