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
 * The rack's width in pixels.
 *
 * Four cells wide is enough for a cabinet to read as a cabinet without a row
 * of racks turning into one wide column; the 40px floor stops a rack built
 * from tiny cells from shrinking narrower than a sled needs to stay legible.
 *
 * `maxBlade` is the densest blade **in the panel**, not in this rack. Every
 * cabinet gets the same width, because a floor plan whose cabinets differ in
 * width does not read as a floor plan — a duo's sleds are simply wider than a
 * quad's, which is also true of the hardware. At the default of 1 the
 * expression is `max(40, cellWidth * 4)`, exactly what this returned before
 * blades existed.
 */
export function rackWidthFor(cellWidth: number, maxBlade = 1): number {
  return Math.max(40, cellWidth * Math.max(4, maxBlade));
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

/** The frame's own padding, `theme.spacing(0.5)` on each side, in pixels. */
const RACK_PADDING = 4;

/**
 * The frame's own gap between sleds, in pixels. Deliberately not
 * `options.gap`: that one belongs to the wrap layout, and a cabinet's
 * internal spacing is not the reader's to set.
 */
const RACK_GAP = 2;

/**
 * The narrowest a sled may be drawn and still be a hover target rather than a
 * hairline — the same floor the Cell width option's description already names.
 */
export const MIN_SLED_WIDTH = 10;

/** One sled's width inside a rack of the given width, at the given blade size. */
export function sledWidthFor(rackWidth: number, blade: number): number {
  const inner = rackWidth - RACK_PADDING * 2 - (blade - 1) * RACK_GAP;
  return Math.max(1, Math.floor(inner / blade));
}

export interface BladeLayoutInput {
  /** The groups the panel is actually drawing, in draw order. */
  groupKeys: string[];
  /** Declared group name to nodes per blade, from parseBladeTable. */
  sizes: Map<string, number>;
  /** The panel-wide Nodes per blade, used where nothing is declared. */
  fallback: number;
  cellWidth: number;
}

export interface BladeLayout {
  /** Shared by every cabinet, so the floor plan lines up. */
  rackWidth: number;
  /** Nodes per blade, per drawn group. */
  sizeOf: Map<string, number>;
  /** One sled's width, per drawn group. */
  sledWidthOf: Map<string, number>;
  /** Declared groups the panel is not drawing. */
  undrawn: string[];
  /** Drawn groups whose sled falls under MIN_SLED_WIDTH. */
  squeezed: Array<{ key: string; blade: number; width: number }>;
}

/**
 * Everything the rack layout needs to know about blades, resolved once.
 *
 * Pure, and outside the component on purpose: the width every cabinet shares
 * depends on the densest blade across the whole panel, which no single group
 * can work out for itself.
 */
export function layoutBlades({ groupKeys, sizes, fallback, cellWidth }: BladeLayoutInput): BladeLayout {
  const sizeOf = new Map<string, number>();
  let maxBlade = 1;
  for (const key of groupKeys) {
    const blade = sizes.get(key) ?? fallback;
    sizeOf.set(key, blade);
    if (blade > maxBlade) {
      maxBlade = blade;
    }
  }

  const rackWidth = rackWidthFor(cellWidth, maxBlade);
  const sledWidthOf = new Map<string, number>();
  const squeezed: BladeLayout['squeezed'] = [];
  for (const [key, blade] of sizeOf) {
    const width = sledWidthFor(rackWidth, blade);
    sledWidthOf.set(key, width);
    if (width < MIN_SLED_WIDTH) {
      squeezed.push({ key, blade, width });
    }
  }

  // A declaration for a cabinet the query did not return is worth saying, and
  // must not widen the ones it did: only drawn groups feed maxBlade above.
  const drawn = new Set(groupKeys);
  const undrawn = [...sizes.keys()].filter((key) => !drawn.has(key));

  return { rackWidth, sizeOf, sledWidthOf, undrawn, squeezed };
}
