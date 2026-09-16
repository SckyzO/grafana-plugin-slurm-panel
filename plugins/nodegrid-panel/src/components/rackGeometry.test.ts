import {
  frameHeight,
  layoutBlades,
  layoutSlots,
  MIN_CELL_HEIGHT,
  MIN_FRAME_HEIGHT,
  MIN_SLED_WIDTH,
  rackWidthFor,
  RACK_BORDER,
  RACK_FOOT,
  RACK_GAP,
  RACK_PADDING,
  resolveCellSize,
  sledHeightFor,
  sledWidthFor,
} from './rackGeometry';
import { MAX_SLOT, MIN_SLOT } from '@slurm-views/core';
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

describe('sledWidthFor', () => {
  // Literal on purpose. Every other number in this file is derived from the
  // same formula it is checking, which is why a missing border term — 2px on
  // every sled in the panel — survived a full review and 97 green tests. These
  // two are the sizes that can tell the two formulas apart: without the border
  // they would read 48 and 23.
  it('subtracts the cabinet frame’s border as well as its padding', () => {
    expect(sledWidthFor(56, 1)).toBe(46);
    expect(sledWidthFor(56, 2)).toBe(22);
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

describe('frameHeight', () => {
  // Literal on purpose, the same reason sledWidthFor's assertions are literal.
  // Every other number in this file is produced by the formula it checks, and
  // that is exactly how a missing border term survived a full review and 97
  // green tests — and how charging the foot as RACK_BORDER rather than
  // RACK_FOOT survived after it. Both of these sit above the floor, so every
  // term of the formula shows in the result: without the border 46 reads 42
  // and 37 reads 33, without the padding 38 and 29, without the inter-row
  // gaps 40 and 33.
  it('counts the rows, the gaps between them, the padding and the border', () => {
    expect(frameHeight(4, 7)).toBe(46);
    expect(frameHeight(3, 7)).toBe(37);
  });

  // The floor lives here rather than in RackFrame's CSS. A stylesheet
  // min-height is a second path to the frame's height that layoutSlots cannot
  // see, so a short cabinet would render taller than the band sized for it.
  it('never returns less than the floor, so the band and the frame agree', () => {
    expect(frameHeight(1, 7)).toBe(MIN_FRAME_HEIGHT);
    expect(frameHeight(0, 7)).toBe(MIN_FRAME_HEIGHT);
    // An invisible cabinet is worse than a stubby one.
    expect(MIN_FRAME_HEIGHT).toBeGreaterThan(RACK_PADDING * 2 + RACK_BORDER * 2);
  });

  // The test that would have caught this from the start: relate the height to
  // the box the browser will give the rows, not to the formula that produced
  // it. Under box-sizing: border-box the content box is the height minus the
  // padding and minus the borders the frame actually draws — 1 on top and
  // RACK_FOOT below, not RACK_BORDER twice. Charging the foot as 1px left
  // every solid cabinet two pixels short and the rows leaked out of the top.
  it('leaves a content box exactly as tall as the rows it was sized for', () => {
    const rows = 8;
    const cellHeight = 9;
    const stack = rows * cellHeight + (rows - 1) * RACK_GAP;
    const contentBox = frameHeight(rows, cellHeight) - RACK_PADDING * 2 - RACK_BORDER - RACK_FOOT;
    expect(contentBox).toBe(stack);
  });
});

describe('layoutSlots', () => {
  const CELL = 7;

  // Every cabinet at one node per blade, which is the default and the case
  // 95% of clusters are in.
  const flat = (entries: Array<[string, number]>) => {
    const groups = entries.map(([key, nodes]) => ({ key, nodes }));
    const blades = layoutBlades({
      groupKeys: groups.map((g) => g.key),
      sizes: new Map(),
      fallback: 1,
      cellWidth: 14,
    });
    return { groups, blades };
  };

  it('levels an undeclared floor to the tallest cabinet filled', () => {
    // The default, and the whole point: a 20-node cabinet beside a 40-node one
    // stands on the floor instead of hanging from the ceiling.
    const { groups, blades } = flat([['rack1', 40], ['rack2', 20]]);
    const l = layoutSlots({ groups, blades, declared: new Map(), fallback: undefined, cellHeight: CELL });
    expect(l.slotsOf.get('rack1')).toBe(40);
    expect(l.slotsOf.get('rack2')).toBe(40);
    expect(l.heightOf.get('rack2')).toBe(frameHeight(40, CELL));
  });

  it('honours a declaration even when it is shorter than its neighbours', () => {
    // A declaration is an assertion about the hardware. A genuinely small
    // cabinet stays small rather than being levelled up into a claim about
    // empty slots that do not exist.
    const { groups, blades } = flat([['rack1', 40], ['rack2', 20]]);
    const l = layoutSlots({
      groups, blades,
      declared: new Map([['rack2', 20]]),
      fallback: undefined,
      cellHeight: CELL,
    });
    expect(l.slotsOf.get('rack1')).toBe(40);
    expect(l.slotsOf.get('rack2')).toBe(20);
  });

  it('levels an undeclared cabinet up to a declared neighbour, not only to a filled one', () => {
    // rack1 is nearly empty but declared tall; rack2 declares nothing. The
    // floor stays flat because the levelling height is the tallest cabinet
    // drawn, whatever made it tall.
    const { groups, blades } = flat([['rack1', 10], ['rack2', 20]]);
    const l = layoutSlots({
      groups, blades,
      declared: new Map([['rack1', 42]]),
      fallback: undefined,
      cellHeight: CELL,
    });
    expect(l.slotsOf.get('rack1')).toBe(42);
    expect(l.slotsOf.get('rack2')).toBe(42);
  });

  it('uses the panel-wide number where the table is silent', () => {
    const { groups, blades } = flat([['rack1', 40], ['rack2', 20]]);
    const l = layoutSlots({
      groups, blades,
      declared: new Map([['rack1', 24]]),
      fallback: 42,
      cellHeight: CELL,
    });
    expect(l.slotsOf.get('rack1')).toBe(24);
    expect(l.slotsOf.get('rack2')).toBe(42);
  });

  it('counts rows through the blade, not nodes', () => {
    // Forty nodes of quads occupy ten slots. Declaring a height in nodes
    // would draw this cabinet four times taller than it stands, which is the
    // defect the slot unit exists to avoid.
    const groups = [{ key: 'rack1', nodes: 40 }];
    const blades = layoutBlades({
      groupKeys: ['rack1'],
      sizes: new Map([['rack1', 4]]),
      fallback: 1,
      cellWidth: 14,
    });
    const l = layoutSlots({ groups, blades, declared: new Map(), fallback: undefined, cellHeight: CELL });
    expect(l.slotsOf.get('rack1')).toBe(10);
  });

  it('names a cabinet that holds more than it declares, and only a declared one', () => {
    // The invariant: a levelled cabinet takes panelRows, which is at least its
    // own rowsNeeded by construction, so it cannot overflow. Only a
    // declaration can be too small.
    const { groups, blades } = flat([['rack1', 45], ['rack2', 20]]);
    const l = layoutSlots({
      groups, blades,
      declared: new Map([['rack1', 42]]),
      fallback: undefined,
      cellHeight: CELL,
    });
    expect(l.overflowing).toEqual([{ key: 'rack1', needed: 45, declared: 42 }]);
  });

  it('grows the band to clear whatever is actually drawn, overflow included', () => {
    // If the band only cleared the declared height, the rows that spill above
    // the frame would paint over the group header.
    const { groups, blades } = flat([['rack1', 45]]);
    const l = layoutSlots({
      groups, blades,
      declared: new Map([['rack1', 10]]),
      fallback: undefined,
      cellHeight: CELL,
    });
    expect(l.heightOf.get('rack1')).toBe(frameHeight(10, CELL));
    expect(l.bandHeight).toBe(frameHeight(45, CELL));
  });

  it('gives every cabinet the same band, so headers align and cabinets share a floor', () => {
    const { groups, blades } = flat([['rack1', 40], ['rack2', 20]]);
    const l = layoutSlots({
      groups, blades,
      declared: new Map([['rack2', 20]]),
      fallback: undefined,
      cellHeight: CELL,
    });
    expect(l.bandHeight).toBe(frameHeight(40, CELL));
  });

  it('names the groups a declaration claims that are not drawn', () => {
    const { groups, blades } = flat([['rack1', 40]]);
    const l = layoutSlots({
      groups, blades,
      declared: new Map([['rack1', 42], ['rack9', 42]]),
      fallback: undefined,
      cellHeight: CELL,
    });
    expect(l.undrawn).toEqual(['rack9']);
  });

  it('does not let an undrawn declaration raise the cabinets that are drawn', () => {
    const { groups, blades } = flat([['rack1', 10]]);
    const l = layoutSlots({
      groups, blades,
      declared: new Map([['rack9', 64]]),
      fallback: undefined,
      cellHeight: CELL,
    });
    expect(l.slotsOf.get('rack1')).toBe(10);
  });

  it('is empty and silent with no groups drawn', () => {
    const l = layoutSlots({
      groups: [],
      blades: layoutBlades({ groupKeys: [], sizes: new Map(), fallback: 1, cellWidth: 14 }),
      declared: new Map(),
      fallback: undefined,
      cellHeight: CELL,
    });
    expect(l.slotsOf.size).toBe(0);
    expect(l.overflowing).toEqual([]);
    expect(l.bandHeight).toBe(frameHeight(0, CELL));
  });

  it('clamps a panel-wide slot count that arrived past the editor', () => {
    const { groups, blades } = flat([['rack1', 8]]);
    const high = layoutSlots({ groups, blades, declared: new Map(), fallback: 400, cellHeight: CELL });
    expect(high.slotsOf.get('rack1')).toBe(MAX_SLOT);
    const low = layoutSlots({ groups, blades, declared: new Map(), fallback: 0, cellHeight: CELL });
    expect(low.slotsOf.get('rack1')).toBe(MIN_SLOT);
    const fractional = layoutSlots({ groups, blades, declared: new Map(), fallback: 12.5, cellHeight: CELL });
    expect(fractional.slotsOf.get('rack1')).toBe(12);
  });

  it('lets a group overflow through the panel-wide number, with no table entry of its own', () => {
    // The likeliest first misconfiguration: one number typed for a floor whose
    // cabinets are taller than it. Nothing is declared per group, so this is
    // the path the invariant's narrower wording used to miss.
    const { groups, blades } = flat([['rack1', 40], ['rack2', 40]]);
    const l = layoutSlots({ groups, blades, declared: new Map(), fallback: 10, cellHeight: CELL });
    expect(l.slotsOf.get('rack1')).toBe(10);
    expect(l.overflowing).toEqual([
      { key: 'rack1', needed: 40, declared: 10 },
      { key: 'rack2', needed: 40, declared: 10 },
    ]);
  });
});
