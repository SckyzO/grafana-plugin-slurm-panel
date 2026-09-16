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

/**
 * The frame's own padding, `theme.spacing(0.5)` on each side, in pixels.
 * Exported so `RackFrame` draws from the same number this geometry assumes,
 * rather than the two agreeing by coincidence — they already disagreed once.
 */
export const RACK_PADDING = 4;

/**
 * The frame's own gap between sleds, in pixels. Deliberately not
 * `options.gap`: that one belongs to the wrap layout, and a cabinet's
 * internal spacing is not the reader's to set.
 */
export const RACK_GAP = 2;

/**
 * The frame's own border, in pixels per side — the one `RackFrame` draws
 * around the cabinet. The app runs under `box-sizing: border-box`, so this
 * comes out of the same content box as the padding; leaving it out let a
 * sled overflow the frame's right edge by exactly this many pixels.
 */
export const RACK_BORDER = 1;

/**
 * The cabinet's foot, in pixels — the heavier bottom edge that makes a frame
 * read as a rack standing on a floor rather than as a box.
 *
 * Exported for the same reason RACK_PADDING and RACK_GAP are: `frameHeight`
 * has to charge for the border the frame actually draws, and a solid cabinet's
 * vertical borders are 1 on top and this at the foot. Charging RACK_BORDER
 * twice under-counted the chrome by exactly two pixels, which is the same
 * arithmetic slip as the missing border term in the width formula, on the
 * other axis.
 *
 * A dashed frame draws a 1px foot, so it gets two pixels more room than it
 * needs. Nothing depends on a dashed cabinet being tight, and one constant is
 * worth more than that precision.
 */
export const RACK_FOOT = 3;

/**
 * The narrowest a sled may be drawn and still be a hover target rather than a
 * hairline — the same floor the Cell width option's description already names.
 */
export const MIN_SLED_WIDTH = 10;

/** One sled's width inside a rack of the given width, at the given blade size. */
export function sledWidthFor(rackWidth: number, blade: number): number {
  const inner = rackWidth - RACK_PADDING * 2 - RACK_BORDER * 2 - (blade - 1) * RACK_GAP;
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

/**
 * The shortest a cabinet may be drawn, in pixels — `theme.spacing(3)`, which
 * `RackFrame` used to apply as a CSS `min-height`.
 *
 * It belongs in the arithmetic rather than in the stylesheet because a CSS
 * floor is a second path to the frame's height, and `layoutSlots` cannot see
 * it: a one-row cabinet would render at 24px while its band was sized at 17,
 * and the frame would overflow the band it is meant to sit in. Two paths
 * reading the same number differently is the defect class the missing border
 * term already produced once on this file.
 */
export const MIN_FRAME_HEIGHT = 24;

/**
 * A cabinet frame's height in pixels, for a given number of rows.
 *
 * The padding and border terms are here for the same reason they are in
 * `sledWidthFor`: the app runs under `box-sizing: border-box`, so an explicit
 * height includes both. Leaving the border out of the width formula is what
 * let a sled overflow its frame by exactly two pixels, undetected by a full
 * review and ninety-seven unit tests — this is that trap on the other axis.
 * The vertical borders are asymmetric, unlike the width's: `RACK_BORDER` on
 * top and the heavier `RACK_FOOT` at the bottom, not `RACK_BORDER` twice.
 *
 * Unlike the width there is no `floor()` here, so every term of the formula is
 * visible in the result and a literal assertion detects a missing one. The
 * result is never below `MIN_FRAME_HEIGHT`.
 */
export function frameHeight(rows: number, cellHeight: number): number {
  const chrome = RACK_PADDING * 2 + RACK_BORDER + RACK_FOOT;
  const content = rows <= 0 ? 0 : rows * cellHeight + (rows - 1) * RACK_GAP;
  return Math.max(MIN_FRAME_HEIGHT, content + chrome);
}

export interface SlotLayoutInput {
  /**
   * The groups the panel is actually drawing, in draw order, each with its
   * node count — one structure rather than a key list beside a count map.
   * Two structures that must cover the same keys, with nothing forcing them
   * to, is how a `?? 0` ends up drawing a silently empty cabinet.
   */
  groups: Array<{ key: string; nodes: number }>;
  /** Resolved blade layout, for `sizeOf`. Built from the same group list. */
  blades: BladeLayout;
  /** Declared group name to slot count, from parseSlotTable. */
  declared: Map<string, number>;
  /** The panel-wide Slots per rack, where the table is silent. Absent means level. */
  fallback: number | undefined;
  cellHeight: number;
}

export interface SlotLayout {
  /** Shared by every cabinet, so headers align and cabinets share a floor. */
  bandHeight: number;
  /** Rows the frame is drawn at, per drawn group. */
  slotsOf: Map<string, number>;
  /** Frame height in pixels, per drawn group. */
  heightOf: Map<string, number>;
  /** Declared groups the panel is not drawing. */
  undrawn: string[];
  /** Drawn groups whose content needs more rows than the frame has. */
  overflowing: Array<{ key: string; needed: number; declared: number }>;
}

/**
 * How tall each cabinet is drawn, resolved once for the whole panel.
 *
 * A declaration wins; what is not declared levels to the tallest cabinet on
 * the floor, declared or filled. Pure, and outside the component on purpose:
 * the levelled height and the shared band depend on every group at once, which
 * no single group can work out for itself.
 */
export function layoutSlots({ groups, blades, declared, fallback, cellHeight }: SlotLayoutInput): SlotLayout {
  const neededOf = new Map<string, number>();
  for (const { key, nodes } of groups) {
    // blades.sizeOf is keyed by every group layoutBlades was given, and the
    // panel builds both from the same list, so the key is always present.
    // A fallback here would silently draw a cabinet at the wrong row count.
    const blade = blades.sizeOf.get(key)!;
    neededOf.set(key, Math.ceil(nodes / blade));
  }

  const declaredFor = (key: string): number | undefined => declared.get(key) ?? fallback;

  // The tallest cabinet on the floor, whatever made it tall. Taking a declared
  // neighbour into account here is what keeps the floor flat when one cabinet
  // is declared tall and nearly empty.
  let panelRows = 0;
  for (const { key } of groups) {
    const rows = declaredFor(key) ?? neededOf.get(key)!;
    if (rows > panelRows) {
      panelRows = rows;
    }
  }

  const slotsOf = new Map<string, number>();
  const heightOf = new Map<string, number>();
  const overflowing: SlotLayout['overflowing'] = [];
  let bandRows = 0;

  for (const { key } of groups) {
    const rows = declaredFor(key) ?? panelRows;
    slotsOf.set(key, rows);
    heightOf.set(key, frameHeight(rows, cellHeight));

    const needed = neededOf.get(key)!;
    if (needed > rows) {
      overflowing.push({ key, needed, declared: rows });
    }
    // The band has to clear whatever is actually drawn, overflow included —
    // otherwise the rows that spill above the frame paint over the header.
    const drawn = Math.max(rows, needed);
    if (drawn > bandRows) {
      bandRows = drawn;
    }
  }

  // A declaration for a cabinet the query did not return is worth saying, and
  // must not raise the ones it did: only drawn groups feed panelRows above.
  const drawn = new Set(groups.map((g) => g.key));
  const undrawn = [...declared.keys()].filter((key) => !drawn.has(key));

  return { bandHeight: frameHeight(bandRows, cellHeight), slotsOf, heightOf, undrawn, overflowing };
}
