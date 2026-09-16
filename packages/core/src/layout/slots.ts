import { parseCountTable } from './countTable.js';
import type { CountProblem } from './countTable.js';

/**
 * The supported range for slots in one cabinet.
 *
 * A slot is one row in the cabinet — one chassis position. It is not a node
 * and it is not a rack unit: a row holds as many nodes as its blade carries,
 * so a 42-slot cabinet holds 42 nodes of single-node servers or 168 of quads.
 * That is the property a height needs, because a 42U cabinet stays a 42U
 * cabinet when the hardware inside it changes.
 *
 * 64 sits above any cabinet that exists — the tallest standard rack is 60U —
 * and a bound is what stops a typo turning one cabinet into a column of a
 * thousand rows.
 */
export const MIN_SLOT = 1;
export const MAX_SLOT = 64;

export type SlotProblem = CountProblem;

export interface SlotTable {
  /** Group name to slot count. The first line naming a group keeps it. */
  slots: Map<string, number>;
  problems: SlotProblem[];
}

/** How many slots a cabinet is drawn with, per group. */
export function parseSlotTable(table: string): SlotTable {
  const { counts, problems } = parseCountTable(table, {
    min: MIN_SLOT,
    max: MAX_SLOT,
    noun: 'slots',
  });
  return { slots: counts, problems };
}
