/**
 * The two size decisions that make a rack read as a rack rather than a grid
 * of squares, pulled out of `RackFrame` and `NodeCell` so the property that
 * matters — a sled is wide and short, not a square — can be asserted once,
 * as plain arithmetic, instead of only living inside CSS that a test runner
 * without a layout engine cannot see.
 */

import { DEFAULT_OPTIONS } from '../types';
import type { Layout } from '../types';

/**
 * The rack's width in pixels, derived from the chosen cell width.
 *
 * Four cells wide is enough for a cabinet to read as a cabinet without a row
 * of racks turning into one wide column; the 40px floor stops a rack built
 * from tiny cells from shrinking narrower than a sled needs to stay legible.
 */
export function rackWidthFor(cellWidth: number): number {
  return Math.max(40, cellWidth * 4);
}

/** The smallest a cell may be drawn and still be a hover target rather than
 * a hairline. The Cell height option in the editor carries the same floor. */
export const MIN_CELL_HEIGHT = 5;

/**
 * A sled's height in pixels: about half the cell width, so a sled is
 * unmistakably wider than it is tall — the whole reason to draw a rack
 * instead of a grid.
 */
export function sledHeightFor(cellWidth: number): number {
  return Math.max(MIN_CELL_HEIGHT, Math.round(cellWidth / 2));
}

export interface CellSize {
  width: number;
  height: number;
}

/**
 * The two dimensions a cell is drawn at.
 *
 * Both options being optional is what makes the split non-breaking, because
 * the two layouts disagree about the natural shape of a cell: Wrap draws a
 * square, Rack draws a sled at half the width. A fixed default height would
 * double the sled in Rack or flatten every cell in Wrap, so an unset height
 * keeps deriving whatever that layout already drew.
 */
export function resolveCellSize(options: { cellWidth?: number; cellHeight?: number; layout: Layout }): CellSize {
  const width = options.cellWidth ?? DEFAULT_OPTIONS.cellWidth;
  const derived = options.layout === 'rack' ? sledHeightFor(width) : width;
  // The floor belongs to the geometry, not to the path the number arrived by:
  // a 3px cell is a hairline whether it was derived or typed.
  const height = Math.max(MIN_CELL_HEIGHT, options.cellHeight ?? derived);
  return { width, height };
}
