import type { SlurmNode } from '../model/types.js';

export type KeySource =
  | { kind: 'label'; label: string }
  | { kind: 'capture'; pattern: string }
  | { kind: 'chunk'; size: number }
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
