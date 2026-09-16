import { MIN_CELL_HEIGHT, rackWidthFor, resolveCellSize, sledHeightFor } from './rackGeometry';
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
