import {
  layoutBlades,
  MIN_CELL_HEIGHT,
  MIN_SLED_WIDTH,
  rackWidthFor,
  resolveCellSize,
  sledHeightFor,
} from './rackGeometry';
import { DEFAULT_OPTIONS } from '../types';

describe('rackGeometry', () => {
  it('sizes a rack and its sleds at the default cell size', () => {
    expect(rackWidthFor(14)).toBe(56);
    expect(sledHeightFor(14)).toBe(7);
  });

  // The property that makes a rack a rack rather than a column of squares:
  // a sled reads as wide and short. Assert the ratio, not two hardcoded
  // numbers — hardcoding 56 and 7 would pass just as vacuously as asserting
  // nothing at all, since a formula change that kept those two outputs by
  // coincidence would still slip through.
  it('keeps every sled materially wider than it is tall, across the supported cell-size range', () => {
    for (let cellWidth = 6; cellWidth <= 48; cellWidth++) {
      const ratio = rackWidthFor(cellWidth) / sledHeightFor(cellWidth);
      expect(ratio).toBeGreaterThan(4);
    }
  });

  it('floors the rack width so a rack of tiny cells stays legible', () => {
    expect(rackWidthFor(6)).toBe(40);
  });

  it('floors the sled height so the smallest sled stays a usable hover target', () => {
    expect(sledHeightFor(6)).toBe(5);
  });
});

describe('resolveCellSize', () => {
  it('draws a square in Wrap when nothing is set', () => {
    expect(resolveCellSize({ ...DEFAULT_OPTIONS, layout: 'wrap' })).toEqual({ width: 14, height: 14 });
  });

  it('draws a sled in Rack when nothing is set', () => {
    // A fixed default for height would silently double the sled here. Leaving
    // it unset is what keeps the split from changing anything for anyone who
    // has configured nothing.
    expect(resolveCellSize({ ...DEFAULT_OPTIONS, layout: 'rack' }))
      .toEqual({ width: 14, height: sledHeightFor(14) });
  });

  it('follows the width into the derived height', () => {
    expect(resolveCellSize({ ...DEFAULT_OPTIONS, layout: 'wrap', cellWidth: 30 }))
      .toEqual({ width: 30, height: 30 });
  });

  // 6, not 4: what this asserts is that an explicit height wins over the
  // derived one in both layouts, and 4 happened to sit under the floor, where
  // the test below is the one that has something to say.
  it('uses an explicit height in either layout', () => {
    expect(resolveCellSize({ ...DEFAULT_OPTIONS, layout: 'rack', cellWidth: 30, cellHeight: 6 }))
      .toEqual({ width: 30, height: 6 });
    expect(resolveCellSize({ ...DEFAULT_OPTIONS, layout: 'wrap', cellWidth: 30, cellHeight: 6 }))
      .toEqual({ width: 30, height: 6 });
  });

  // The derived path has always floored a sled at MIN_CELL_HEIGHT, because
  // below it a cell stops being a hover target and becomes a hairline. A
  // height typed into the option is the same pixel on the same screen, so it
  // meets the same floor — otherwise the option quietly undoes the reason the
  // floor exists. The editor's `min` reads this constant for the same reason.
  it('floors an explicit cell height at the same pixel as a derived one', () => {
    expect(resolveCellSize({ cellWidth: 14, cellHeight: 3, layout: 'wrap' }).height).toBe(MIN_CELL_HEIGHT);
    expect(resolveCellSize({ cellWidth: 14, cellHeight: 3, layout: 'rack' }).height).toBe(MIN_CELL_HEIGHT);
    // Above the floor the number is honoured exactly, in both layouts.
    expect(resolveCellSize({ cellWidth: 14, cellHeight: 20, layout: 'rack' }).height).toBe(20);
  });
});

describe('layoutBlades', () => {
  const sizes = (entries: Array<[string, number]>) => new Map(entries);

  it('falls back to the panel-wide count for a group with no declaration', () => {
    const l = layoutBlades({ groupKeys: ['rack1', 'rack2'], sizes: sizes([['rack1', 4]]), fallback: 2, cellWidth: 14 });
    expect(l.sizeOf.get('rack1')).toBe(4);
    expect(l.sizeOf.get('rack2')).toBe(2);
  });

  it('gives every rack the same width, taken from the densest blade in the panel', () => {
    // Not from each rack's own blade: a floor plan whose cabinets have
    // different widths does not read as a floor plan. A duo's sleds are
    // simply wider than a quad's, which is also true of the hardware.
    const l = layoutBlades({ groupKeys: ['rack1', 'rack2'], sizes: sizes([['rack1', 6], ['rack2', 2]]), fallback: 1, cellWidth: 14 });
    expect(l.rackWidth).toBe(rackWidthFor(14, 6));
    expect(l.sledWidthOf.get('rack1')).toBeLessThan(l.sledWidthOf.get('rack2')!);
  });

  it('draws the same rack it drew before blades existed when every blade is one', () => {
    // The whole non-regression argument in one assertion: max(4, 1) is 4, so
    // the width expression is the one the panel already used.
    const l = layoutBlades({ groupKeys: ['rack1'], sizes: new Map(), fallback: 1, cellWidth: 14 });
    expect(l.rackWidth).toBe(56);
    expect(l.sizeOf.get('rack1')).toBe(1);
  });

  it('names the groups a declaration claims that are not drawn', () => {
    const l = layoutBlades({ groupKeys: ['rack1'], sizes: sizes([['rack1', 4], ['rack9', 4]]), fallback: 1, cellWidth: 14 });
    expect(l.undrawn).toEqual(['rack9']);
  });

  it('names a group whose sled falls under the legibility floor', () => {
    // At six pixels a cell the rack cannot hold four legible sleds. The panel
    // says so rather than drawing four hairlines.
    const l = layoutBlades({ groupKeys: ['rack1'], sizes: sizes([['rack1', 4]]), fallback: 1, cellWidth: 6 });
    expect(l.squeezed).toEqual([{ key: 'rack1', blade: 4, width: l.sledWidthOf.get('rack1') }]);
    expect(l.sledWidthOf.get('rack1')).toBeLessThan(MIN_SLED_WIDTH);
  });

  it('says nothing about a quad at the default cell width', () => {
    // 14px cells give a 56px rack and 10px sleds, which is the floor exactly
    // rather than under it. A warning on the first thing a reader tries would
    // train them to ignore the strip.
    const l = layoutBlades({ groupKeys: ['rack1'], sizes: sizes([['rack1', 4]]), fallback: 1, cellWidth: 14 });
    expect(l.sledWidthOf.get('rack1')).toBe(10);
    expect(l.squeezed).toEqual([]);
  });

  it('is empty and silent with no groups drawn', () => {
    const l = layoutBlades({ groupKeys: [], sizes: new Map(), fallback: 4, cellWidth: 14 });
    expect(l.sizeOf.size).toBe(0);
    expect(l.squeezed).toEqual([]);
    expect(l.rackWidth).toBe(rackWidthFor(14, 1));
  });
});
