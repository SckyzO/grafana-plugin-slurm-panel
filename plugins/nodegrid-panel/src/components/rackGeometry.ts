/**
 * The two size decisions that make a rack read as a rack rather than a grid
 * of squares, pulled out of `RackFrame` and `NodeCell` so the property that
 * matters — a sled is wide and short, not a square — can be asserted once,
 * as plain arithmetic, instead of only living inside CSS that a test runner
 * without a layout engine cannot see.
 */

/**
 * The rack's width in pixels, derived from the chosen cell size.
 *
 * Four cells wide is enough for a cabinet to read as a cabinet without a row
 * of racks turning into one wide column; the 40px floor stops a rack built
 * from tiny cells from shrinking narrower than a sled needs to stay legible.
 */
export function rackWidthFor(cellSize: number): number {
  return Math.max(40, cellSize * 4);
}

/**
 * A sled's height in pixels: about half the cell size, so a sled is
 * unmistakably wider than it is tall — the whole reason to draw a rack
 * instead of a grid. The 5px floor keeps the smallest sled a usable hover
 * target instead of a hairline.
 */
export function sledHeightFor(cellSize: number): number {
  return Math.max(5, Math.round(cellSize / 2));
}
