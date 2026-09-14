import { rackWidthFor, sledHeightFor } from './rackGeometry';

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
    for (let cellSize = 6; cellSize <= 48; cellSize++) {
      const ratio = rackWidthFor(cellSize) / sledHeightFor(cellSize);
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
