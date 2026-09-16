import { parseCountTable } from './countTable.js';
import type { CountProblem } from './countTable.js';

/**
 * The supported range for nodes in one cabinet slot. 1 is a single-node
 * server, which is the truth for most clusters and the panel's default; 8 is
 * the widest chassis this is built for, and a bound is what stops a typo
 * turning one rack into a thousand-column row.
 */
export const MIN_BLADE = 1;
export const MAX_BLADE = 8;

export type BladeProblem = CountProblem;

export interface BladeTable {
  /** Group name to nodes per blade. The first line naming a group keeps it. */
  sizes: Map<string, number>;
  problems: BladeProblem[];
}

/** How many nodes share a cabinet slot, per group. */
export function parseBladeTable(table: string): BladeTable {
  const { counts, problems } = parseCountTable(table, {
    min: MIN_BLADE,
    max: MAX_BLADE,
    noun: 'nodes per blade',
  });
  return { sizes: counts, problems };
}
