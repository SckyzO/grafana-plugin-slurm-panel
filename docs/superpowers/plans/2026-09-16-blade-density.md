# Blade Density Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the rack layout draw several nodes in one cabinet slot, so a cabinet of quad chassis is drawn ten rows tall rather than forty.

**Architecture:** A blade is a count of nodes in a row, declared by the reader and never inferred. A pure parser in `packages/core` turns a small table into `group name -> count`; a pure resolver in the panel turns that plus the drawn groups into a rack width, a sled width per group, and two lists of things worth warning about; the rack frame becomes a wrapping row whose first line sits at the bottom. Nothing touches the group model, ingest, or any grouping source.

**Tech Stack:** TypeScript, React 18, `@grafana/data` / `@grafana/ui` 12.x, Jest, Playwright. Everything runs in the toolchain container through `make`.

**Spec:** `docs/superpowers/specs/2026-09-16-blade-density-design.md` (commit `cec1265`)

## Global Constraints

- **Never run `pnpm`, `node`, `npx`, `tsc`, `jest`, `playwright` or `docker` directly on the host.** Every command is a `make` target. The single exception is one Playwright spec, via `docker compose -f dev/docker-compose.yml run --rm tools ...`.
- **Never run `pnpm approve-builds`**, never set `dangerouslyAllowAllBuilds: true`, never weaken `strictDepBuilds`, `minimumReleaseAge: 4320`, `blockExoticSubdeps` or `allowBuilds` in `pnpm-workspace.yaml`.
- **Never touch a Docker container this repository did not create.** The `slurm` compose project (host ports 3000 and 9090) belongs to the user. This repository's project is `slurm-views`; `dev/.env` publishes it on 3001 / 9091. If something appears to need a taken port, report BLOCKED rather than freeing it.
- **Commit messages follow Conventional Commits** (`type(scope): subject`). Write them in English, in the first person of the maintainer. **Never mention Claude, AI, assistance, or that anything was generated — not in the body, not in a signature, not in a trailer.**
- **No dead code.** Every symbol added must be reachable from the panel by the end of the task that adds it, or by the task named in its Interfaces block.
- **Non-regression is a test, not an intention.** Every fix carries a test that fails before it and passes after.
- **The default must not change.** `nodesPerBlade` defaults to `1` and `bladeOverrides` to `''`; with those values the panel must draw exactly what it draws today. The proof is that the existing rack tests stay green **without being edited**.
- **A blade is a count, never a shape.** 1 to 8 nodes in a row. A 4U chassis with two nodes above two more is out of scope; do not model it, do not add an option for it.
- **The panel is never the source of topology.** Density comes from the reader's declaration. Do not add a label source, a query, or an inference from node names.
- `git commit --amend`, `git reset`, `git rebase` and `git push` are forbidden. Make fresh commits only.

---

### Task 1: The blade table parser

**Files:**
- Create: `packages/core/src/layout/blades.ts`
- Create: `packages/core/src/layout/blades.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `expandHostlist(expr: string): { names: string[]; error?: string }` and `collapseHostlist(names: string[]): string[]`, both from `../group/hostlist.js`.
- Produces: `parseBladeTable(table: string): BladeTable` where `BladeTable = { sizes: Map<string, number>; problems: BladeProblem[] }` and `BladeProblem = { line: number; detail: string }`; plus `MIN_BLADE = 1` and `MAX_BLADE = 8`. Task 2 consumes `sizes`; Task 5 consumes `problems`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/layout/blades.test.ts`:

```ts
import { MAX_BLADE, MIN_BLADE, parseBladeTable } from './blades.js';

describe('parseBladeTable', () => {
  it('reads a hostlist of group names on the left and a count on the right', () => {
    const { sizes, problems } = parseBladeTable('rack[1-3]: 4\ngpu1: 2');
    expect(problems).toEqual([]);
    expect([...sizes.entries()]).toEqual([
      ['rack1', 4],
      ['rack2', 4],
      ['rack3', 4],
      ['gpu1', 2],
    ]);
  });

  it('keeps the zero padding a group name was written with', () => {
    // r1 and r01 are different cabinets on different floors. Collapsing them
    // would silently give one of them the other's blade size.
    const { sizes } = parseBladeTable('r[01-02]: 4');
    expect([...sizes.keys()]).toEqual(['r01', 'r02']);
  });

  it('takes a name with no brackets as itself', () => {
    const { sizes, problems } = parseBladeTable('aisleA: 3');
    expect(problems).toEqual([]);
    expect(sizes.get('aisleA')).toBe(3);
  });

  it('ignores blank lines and # comments to end of line', () => {
    const { sizes, problems } = parseBladeTable('# the compute floor\n\nrack1: 4 # quads\n');
    expect(problems).toEqual([]);
    expect([...sizes.entries()]).toEqual([['rack1', 4]]);
  });

  it('reports a line with no separator and skips it', () => {
    const { sizes, problems } = parseBladeTable('rack1: 4\nrack2 4');
    expect(sizes.get('rack2')).toBeUndefined();
    expect(problems).toEqual([{ line: 2, detail: 'Line 2 has no "groups: count" separator.' }]);
  });

  it('reports a count that is not a whole number and skips it', () => {
    const { sizes, problems } = parseBladeTable('rack1: two');
    expect(sizes.size).toBe(0);
    expect(problems[0]?.detail).toBe('Line 1 ("two") is not a whole number of nodes per blade.');
  });

  it('reports a count outside the supported range and skips it', () => {
    const { sizes, problems } = parseBladeTable('rack1: 0\nrack2: 9');
    expect(sizes.size).toBe(0);
    expect(problems.map((p) => p.detail)).toEqual([
      `Line 1 asks for 0 nodes per blade; the range is ${MIN_BLADE} to ${MAX_BLADE}.`,
      `Line 2 asks for 9 nodes per blade; the range is ${MIN_BLADE} to ${MAX_BLADE}.`,
    ]);
  });

  it('carries the message the hostlist parser gives when an expression will not read', () => {
    const { sizes, problems } = parseBladeTable('rack[1-: 4');
    expect(sizes.size).toBe(0);
    expect(problems[0]?.line).toBe(1);
    expect(problems[0]?.detail).toContain('rack[1-');
  });

  it('keeps the first declaration of a group and reports the rest, collapsed', () => {
    // Collapsed rather than one problem per name: a floor plan that declares
    // rack[1-120] twice would otherwise print a hundred and twenty lines.
    const { sizes, problems } = parseBladeTable('rack[1-3]: 4\nrack[1-3]: 2');
    expect(sizes.get('rack1')).toBe(4);
    expect(problems).toEqual([
      { line: 2, detail: 'rack[1-3] are already declared above; the first declaration keeps its count.' },
    ]);
  });

  it('says "is" for a single repeated group', () => {
    const { problems } = parseBladeTable('rack1: 4\nrack1: 2');
    expect(problems[0]?.detail).toBe('rack1 is already declared above; the first declaration keeps its count.');
  });

  it('is empty and silent on an empty table', () => {
    expect(parseBladeTable('')).toEqual({ sizes: new Map(), problems: [] });
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `make test`
Expected: FAIL — `Cannot find module './blades.js'`.

- [ ] **Step 3: Write the parser**

Create `packages/core/src/layout/blades.ts`:

```ts
import { collapseHostlist, expandHostlist } from '../group/hostlist.js';

/**
 * The supported range for nodes in one cabinet slot. 1 is a single-node
 * server, which is the truth for most clusters and the panel's default; 8 is
 * the widest chassis this is built for, and a bound is what stops a typo
 * turning one rack into a thousand-column row.
 */
export const MIN_BLADE = 1;
export const MAX_BLADE = 8;

export interface BladeProblem {
  /** 1-based, so it matches what the operator sees in the textarea. */
  line: number;
  detail: string;
}

export interface BladeTable {
  /** Group name to nodes per blade. The first line naming a group keeps it. */
  sizes: Map<string, number>;
  problems: BladeProblem[];
}

/**
 * How many nodes share a cabinet slot, per group.
 *
 * One line per declaration: a Slurm hostlist of *group* names, a colon, then a
 * count. The hostlist is on the left rather than the right, which is the
 * mirror of the Ranges table and is what makes a floor of 125 cabinets two
 * lines instead of 125.
 *
 * Nothing here throws and nothing is fatal. A bad line is skipped and
 * reported against its own line number, because a table that blanks the whole
 * panel on one typo cannot be edited in a textarea.
 */
export function parseBladeTable(table: string): BladeTable {
  const sizes = new Map<string, number>();
  const problems: BladeProblem[] = [];

  table.split('\n').forEach((raw, i) => {
    const line = i + 1;
    // A floor plan long enough to want this option is long enough to want
    // section headings, so `#` comments to end of line — as in the Ranges table.
    const text = (raw.split('#')[0] ?? '').trim();
    if (text === '') {
      return;
    }

    const colon = text.indexOf(':');
    if (colon < 1) {
      problems.push({ line, detail: `Line ${line} has no "groups: count" separator.` });
      return;
    }

    const expr = text.slice(0, colon).trim();
    const countText = text.slice(colon + 1).trim();
    if (expr === '' || countText === '') {
      problems.push({
        line,
        detail: `Line ${line} is missing a ${expr === '' ? 'group list' : 'count'}.`,
      });
      return;
    }

    if (!/^\d+$/.test(countText)) {
      problems.push({
        line,
        detail: `Line ${line} ("${countText}") is not a whole number of nodes per blade.`,
      });
      return;
    }

    const count = Number(countText);
    if (count < MIN_BLADE || count > MAX_BLADE) {
      problems.push({
        line,
        detail: `Line ${line} asks for ${count} nodes per blade; the range is ${MIN_BLADE} to ${MAX_BLADE}.`,
      });
      return;
    }

    const { names, error } = expandHostlist(expr);
    if (error !== undefined) {
      problems.push({ line, detail: `Line ${line} ("${expr}"): ${error}.` });
      return;
    }

    const repeated: string[] = [];
    for (const name of names) {
      if (sizes.has(name)) {
        repeated.push(name);
        continue;
      }
      sizes.set(name, count);
    }

    if (repeated.length > 0) {
      // Collapsed back into a hostlist: a duplicated rack[1-120] line is one
      // problem, not a hundred and twenty.
      const list = collapseHostlist(repeated).join(',');
      const verb = repeated.length === 1 ? 'is' : 'are';
      problems.push({
        line,
        detail: `${list} ${verb} already declared above; the first declaration keeps its count.`,
      });
    }
  });

  return { sizes, problems };
}
```

- [ ] **Step 4: Export it from the package**

In `packages/core/src/index.ts`, add after the `suggestLabel` exports:

```ts
export { parseBladeTable, MIN_BLADE, MAX_BLADE } from './layout/blades.js';
export type { BladeTable, BladeProblem } from './layout/blades.js';
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `make test`
Expected: PASS. The core suite gains 11 tests and nothing else moves.

- [ ] **Step 6: Lint and typecheck**

Run: `make lint && make typecheck`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/layout/blades.ts packages/core/src/layout/blades.test.ts packages/core/src/index.ts
git commit -m "feat(core): parse a table of nodes per blade, by group

One line per declaration: a Slurm hostlist of group names, a colon, a count.
The hostlist is on the left rather than the right, which mirrors the Ranges
table and is what makes a floor of 125 cabinets two lines instead of 125.

Nothing is fatal, as in parseRangeTable: a bad line is skipped and reported
against its own line number, and a repeated group keeps its first count while
the rest are collapsed back into one hostlist rather than printed one per
name."
```

---

### Task 2: Resolving the geometry

**Files:**
- Modify: `plugins/nodegrid-panel/src/components/rackGeometry.ts`
- Modify: `plugins/nodegrid-panel/src/components/rackGeometry.test.ts`

**Interfaces:**
- Consumes: `BladeTable['sizes']` from Task 1 — a `Map<string, number>`.
- Produces: `layoutBlades(input: BladeLayoutInput): BladeLayout`, `rackWidthFor(cellWidth: number, maxBlade?: number): number`, `sledWidthFor(rackWidth: number, blade: number): number`, `MIN_SLED_WIDTH = 10`. Task 3 consumes `BladeLayout`; Task 5 consumes its `undrawn` and `squeezed` fields.

- [ ] **Step 1: Write the failing test**

Append to `plugins/nodegrid-panel/src/components/rackGeometry.test.ts`, inside the existing top-level `describe`:

```ts
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
```

Update the file's import line to:

```ts
import {
  layoutBlades,
  MIN_CELL_HEIGHT,
  MIN_SLED_WIDTH,
  rackWidthFor,
  resolveCellSize,
  sledHeightFor,
} from './rackGeometry';
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `make test`
Expected: FAIL — `layoutBlades` and `MIN_SLED_WIDTH` are not exported.

- [ ] **Step 3: Write the geometry**

In `plugins/nodegrid-panel/src/components/rackGeometry.ts`, replace `rackWidthFor` with the version below and append the rest at the end of the file:

```ts
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
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `make test`
Expected: PASS. The existing `rackWidthFor(6) === 40` and `rackWidthFor(14) === 56` assertions must still pass untouched — that is the non-regression proof for the defaulted argument.

- [ ] **Step 5: Lint and typecheck**

Run: `make lint && make typecheck`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add plugins/nodegrid-panel/src/components/rackGeometry.ts plugins/nodegrid-panel/src/components/rackGeometry.test.ts
git commit -m "feat(panel): resolve rack and sled geometry for a blade

layoutBlades is pure and sits outside the component because the width every
cabinet shares depends on the densest blade across the whole panel, which no
single group can work out for itself. Giving each rack its own width instead
would draw a floor plan whose cabinets differ in width, which does not read as
a floor plan; a duo's sleds are simply wider than a quad's, as they are in the
hardware.

rackWidthFor gains a defaulted second argument, so at one node per blade it
returns max(40, cellWidth * 4) exactly as before.

It also reports what it cannot honour rather than drawing it: a declaration
naming a cabinet the query did not return, and a sled squeezed under the
legibility floor the Cell width description already names."
```

---

### Task 3: Drawing the wrapped cabinet

**Files:**
- Modify: `plugins/nodegrid-panel/src/components/RackFrame.tsx`
- Modify: `plugins/nodegrid-panel/src/components/RackFrame.test.tsx`
- Modify: `plugins/nodegrid-panel/src/components/NodeCell.tsx`
- Modify: `plugins/nodegrid-panel/src/components/NodeGroup.tsx`
- Modify: `plugins/nodegrid-panel/src/components/NodeGroup.test.tsx`

**Interfaces:**
- Consumes: `layoutBlades`, `BladeLayout`, `rackWidthFor`, `sledWidthFor` from Task 2.
- Produces: `RackFrameProps` takes `width: number` instead of `cellWidth: number`; `NodeCellProps` loses its `sled?: boolean`; `NodeGroupProps` gains `blades?: BladeLayout`. Task 4 passes `blades` in from the panel.

**Why `sled` goes.** `NodeCell` currently draws a sled with `width: 'auto'` and
`alignSelf: 'stretch'`, which fills the cabinet only because the frame is a
`column-reverse` column. In a wrapping row, `auto` sizes to content and
`stretch` works on the vertical axis — so the prop stops meaning anything the
moment the frame changes. Every cell now receives an explicit width, which
`sledWidthFor(rackWidth, 1)` makes identical to what `auto` produced, and the
prop is removed rather than left inert.

- [ ] **Step 1: Write the failing tests**

In `plugins/nodegrid-panel/src/components/NodeGroup.test.tsx`, add `layoutBlades` and `sledWidthFor` to the existing `./rackGeometry` import, then add inside the existing `describe('NodeGroup', ...)`:

```tsx
  it('splits the cabinet between the nodes sharing a blade', () => {
    // Assert the geometry, not a count of cells: eight nodes are eight cells
    // at any blade size, so counting them would pass whatever the layout did.
    const eight: NodeGroupModel = {
      key: 'rack1',
      assumed: false,
      nodes: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'].map(mkNode),
    };
    const blades = layoutBlades({
      groupKeys: ['rack1'],
      sizes: new Map([['rack1', 4]]),
      fallback: 1,
      cellWidth: 20,
    });

    renderGroup(eight, { ...DEFAULT_OPTIONS, layout: 'rack' }, { blades });

    expect(getComputedStyle(screen.getByTestId('rack-frame')).width).toBe(`${blades.rackWidth}px`);
    expect(screen.getByTestId('node-cell-c1').style.width).toBe(`${blades.sledWidthOf.get('rack1')}px`);
  });

  it('uses the blade declared for this group, not the one next to it', () => {
    // Four and two on purpose: two equal blades would pass just as well with
    // the lookups swapped, which is how a width/height inversion once
    // survived review on this panel.
    const blades = layoutBlades({
      groupKeys: ['rack1', 'rack2'],
      sizes: new Map([
        ['rack1', 4],
        ['rack2', 2],
      ]),
      fallback: 1,
      cellWidth: 20,
    });
    const duo: NodeGroupModel = { key: 'rack2', assumed: false, nodes: [mkNode('c1'), mkNode('c2')] };

    renderGroup(duo, { ...DEFAULT_OPTIONS, layout: 'rack' }, { blades });

    expect(screen.getByTestId('node-cell-c1').style.width).toBe(`${blades.sledWidthOf.get('rack2')}px`);
    expect(blades.sledWidthOf.get('rack2')).not.toBe(blades.sledWidthOf.get('rack1'));
  });

  it('ignores blades entirely in the wrap layout', () => {
    const blades = layoutBlades({
      groupKeys: ['rack-1'],
      sizes: new Map([['rack-1', 4]]),
      fallback: 1,
      cellWidth: 20,
    });

    renderGroup(group, { ...DEFAULT_OPTIONS, layout: 'wrap', cellWidth: 20 }, { blades });

    expect(screen.queryByTestId('rack-frame')).toBeNull();
    expect(screen.getByTestId('node-cell-node-a').style.width).toBe('20px');
  });
```

In the same file, amend the existing `draws a rack frame of sleds when layout is rack` test. Replace its last three lines — the comment about `auto` and the `expect(cell.style.width).toBe('auto')` — with:

```tsx
    // A sled fills the cabinet's inner width when one node has the blade to
    // itself. That width is resolved by NodeGroup and handed over, rather
    // than a stretch NodeCell decides for itself: `auto` only filled a
    // cabinet while the frame was a column.
    const cell = screen.getByTestId('node-cell-node-a');
    const width = rackWidthFor(resolveCellSize(DEFAULT_OPTIONS).width);
    expect(cell.style.width).toBe(`${sledWidthFor(width, 1)}px`);
```

In `plugins/nodegrid-panel/src/components/RackFrame.test.tsx`, replace both `cellWidth={N}` props with `width={rackWidthFor(N)}`, and replace the `flexDirection` assertion with these two:

```tsx
    expect(computed.flexDirection).toBe('row');
    expect(computed.flexWrap).toBe('wrap-reverse');
```

Amend that test's name and its leading comment to say the slots fill bottom-up by a reversed cross axis rather than by a reversed column.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `make test`
Expected: FAIL — `NodeGroup` has no `blades` prop, the frame is still a column, and every sled is still `auto`.

- [ ] **Step 3: Make the frame a wrapping row**

Replace the body of `plugins/nodegrid-panel/src/components/RackFrame.tsx` with:

```tsx
import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useTheme2 } from '@grafana/ui';

const getStyles = (theme: GrafanaTheme2, width: number, dashed: boolean) => ({
  rack: css({
    display: 'flex',
    // A row that wraps, with the cross axis reversed: rows fill left to right
    // and the first one sits at the bottom, so node 1 is at the foot of the
    // cabinet, which is how a rack is read. At one node per blade this is one
    // sled per row, which is what column-reverse drew before it.
    flexDirection: 'row',
    flexWrap: 'wrap-reverse',
    // With the cross axis reversed, flex-start is the bottom: a half-full
    // cabinet fills from the floor rather than hanging from the ceiling.
    alignContent: 'flex-start',
    width,
    gap: 2,
    padding: theme.spacing(0.5),
    minHeight: theme.spacing(3),
    // A cabinet frame, heavier at the foot, unless the panel could not resolve
    // what belongs in it: it refuses to draw a solid cabinet around a claim it
    // did not resolve.
    border: `1px ${dashed ? 'dashed' : 'solid'} ${theme.colors.border.medium}`,
    borderBottomWidth: dashed ? 1 : 3,
  }),
});

export interface RackFrameProps {
  children: React.ReactNode;
  /** The cabinet's width in pixels, resolved by layoutBlades. */
  width: number;
  dashed?: boolean;
}

export function RackFrame({ children, width, dashed = false }: RackFrameProps) {
  const theme = useTheme2();
  const styles = getStyles(theme, width, dashed);
  return (
    <div className={styles.rack} data-testid="rack-frame" data-dashed={dashed}>
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Give every cell an explicit width**

In `plugins/nodegrid-panel/src/components/NodeCell.tsx`:

- delete the `sled?: boolean` field and its doc comment from `NodeCellProps`;
- delete `sled,` from the destructured parameters;
- replace these two style lines

```tsx
          width: sled ? 'auto' : width,
          alignSelf: sled ? 'stretch' : undefined,
```

with

```tsx
          width,
```

- [ ] **Step 5: Give NodeGroup the blade layout**

In `plugins/nodegrid-panel/src/components/NodeGroup.tsx`:

Replace the `./rackGeometry` import with:

```tsx
import { rackWidthFor, resolveCellSize, sledWidthFor } from './rackGeometry';
import type { BladeLayout } from './rackGeometry';
```

Add to `NodeGroupProps`:

```tsx
  /**
   * Rack geometry for the whole panel, resolved once by the panel because the
   * width every cabinet shares depends on the densest blade across all of
   * them. Absent wherever no rack is drawn.
   */
  blades?: BladeLayout;
```

Add `blades` to the destructured props, and after `const cell = resolveCellSize(options);`:

```tsx
  // In a cabinet a cell is as wide as its share of the slot; everywhere else
  // it is the width the reader asked for. The fallback covers a NodeGroup
  // rendered without a layout — every wrap-layout test, and any caller that
  // draws a single group on its own.
  const rackWidth = blades?.rackWidth ?? rackWidthFor(cell.width);
  const cellWidth =
    options.layout === 'rack' ? blades?.sledWidthOf.get(group.key) ?? sledWidthFor(rackWidth, 1) : cell.width;
```

Change `width={cell.width}` on `NodeCell` to `width={cellWidth}`, delete the `sled={options.layout === 'rack'}` prop, and change the `RackFrame` call to `<RackFrame width={rackWidth} dashed={unresolved}>`.

- [ ] **Step 6: Run the tests and watch them pass**

Run: `make test`
Expected: PASS. Every other rack test in the suite must pass unedited — the two files named in Step 1 are the only test files this task may touch.

- [ ] **Step 7: Look at it**

Run: `make up`, then open the address it prints and load **Slurm / Slurm node grid**. The six cabinets must look exactly as they did before this task: one sled per node, full cabinet width, node 1 at the foot. Nothing is configurable yet, so any visible difference here is a regression rather than a feature.

- [ ] **Step 8: Lint and typecheck**

Run: `make lint && make typecheck`
Expected: both exit 0.

- [ ] **Step 9: Commit**

```bash
git add plugins/nodegrid-panel/src/components/RackFrame.tsx plugins/nodegrid-panel/src/components/RackFrame.test.tsx plugins/nodegrid-panel/src/components/NodeCell.tsx plugins/nodegrid-panel/src/components/NodeGroup.tsx plugins/nodegrid-panel/src/components/NodeGroup.test.tsx
git commit -m "feat(panel): draw a cabinet as a wrapping row of sleds

flexDirection row with wrap-reverse: rows fill left to right and the reversed
cross axis puts the first row at the bottom, so node 1 stays at the foot of
the cabinet. At one node per blade that is one sled per row, which is what
column-reverse drew before it.

NodeCell loses its sled flag. It drew a sled as width auto with alignSelf
stretch, which filled the cabinet only because the frame was a column: in a
wrapping row auto sizes to content and stretch works on the other axis, so
the flag stops meaning anything the moment the frame changes. Every cell now
takes an explicit width, and at one node per blade that width is the one auto
produced.

RackFrame takes the width it should be rather than a cell width to compute one
from. The cabinet's width depends on the densest blade across the whole panel,
so the decision belongs where that is known, and a component handed its width
cannot disagree with the one the panel warned about."
```

---

### Task 4: The two options, and wiring them in

**Files:**
- Create: `plugins/nodegrid-panel/src/editor/BladeEditor.tsx`
- Modify: `plugins/nodegrid-panel/src/types.ts`
- Modify: `plugins/nodegrid-panel/src/module.ts`
- Modify: `plugins/nodegrid-panel/src/components/NodeGridPanel.tsx`
- Modify: `plugins/nodegrid-panel/src/components/NodeGridPanel.test.tsx`

**Interfaces:**
- Consumes: `parseBladeTable`, `MIN_BLADE`, `MAX_BLADE` (Task 1); `layoutBlades`, `rackWidthFor`, `sledWidthFor` (Task 2); the `blades` prop on `NodeGroup` (Task 3).
- Produces: `PanelOptions.nodesPerBlade: number` and `PanelOptions.bladeOverrides: string`, both with defaults in `DEFAULT_OPTIONS`; a `blades` memo in `NodeGridPanel` shaped `{ table: BladeTable; layout: BladeLayout }`. Task 5 reads both halves of that memo.

- [ ] **Step 1: Write the failing test**

In `plugins/nodegrid-panel/src/components/NodeGridPanel.test.tsx`, add to the imports:

```tsx
import { rackWidthFor, sledWidthFor } from './rackGeometry';
```

and add inside `describe('NodeGridPanel', ...)`:

```tsx
  // One node per frame, the same shape the other tests in this file build.
  const nodeFrame = (node: string, rack: string) =>
    createDataFrame({
      refId: 'A',
      fields: [
        { name: 'Value', type: FieldType.number, values: [1], labels: { node, status: 'idle', rack } },
      ],
    });

  const rackData = (): PanelData => ({
    state: LoadingState.Done,
    series: [nodeFrame('c1', 'rack1')],
    timeRange: getDefaultTimeRange(),
  });

  const plainConfig: FieldConfigSource = {
    defaults: {
      mappings: DEFAULT_MAPPINGS,
      thresholds: { mode: ThresholdsMode.Absolute, steps: [{ value: -Infinity, color: 'green' }] },
    },
    overrides: [],
  };

  const rackOptions: PanelOptions = {
    ...DEFAULT_OPTIONS,
    layout: 'rack',
    grouping: { kind: 'label', label: 'rack' },
  };

  it('draws one sled per node when nothing is declared', () => {
    // The default-unchanged promise, asserted rather than assumed: a reader
    // who never opens the option gets the cabinet the panel always drew.
    render(<NodeGridPanel {...baseProps} data={rackData()} options={rackOptions} fieldConfig={plainConfig} />);

    const width = rackWidthFor(DEFAULT_OPTIONS.cellWidth);
    expect(screen.getByTestId('node-cell-c1').style.width).toBe(`${sledWidthFor(width, 1)}px`);
  });

  it('resolves a group named in the blade table through to the drawn cell', () => {
    render(
      <NodeGridPanel
        {...baseProps}
        data={rackData()}
        options={{ ...rackOptions, bladeOverrides: 'rack1: 4' }}
        fieldConfig={plainConfig}
      />
    );

    // The panel-wide count is still 1; only the table names rack1, which is
    // what proves the override is read rather than the slider.
    const width = rackWidthFor(DEFAULT_OPTIONS.cellWidth, 4);
    expect(screen.getByTestId('node-cell-c1').style.width).toBe(`${sledWidthFor(width, 4)}px`);
  });
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `make test`
Expected: FAIL — `bladeOverrides` is not a property of `PanelOptions`.

- [ ] **Step 3: Add the options to the type**

In `plugins/nodegrid-panel/src/types.ts`, add to `PanelOptions` after `cellHeight`:

```ts
  /**
   * How many nodes share one slot in a cabinet. 1 is a single-node server,
   * which is the truth for most clusters and draws one sled per node.
   */
  nodesPerBlade: number;
  /**
   * One line per declaration: a hostlist of group names, a colon, a count.
   * Overrides nodesPerBlade for the groups it names.
   */
  bladeOverrides: string;
```

and to `DEFAULT_OPTIONS`, after `cellWidth`:

```ts
  // 1, not 0 and not a flag: "one node per blade" is a true statement about
  // most clusters, and the drawing it produces is the one the panel already
  // produced. A reader who never opens the option sees no change.
  nodesPerBlade: 1,
  bladeOverrides: '',
```

- [ ] **Step 4: Write the editor**

Create `plugins/nodegrid-panel/src/editor/BladeEditor.tsx`:

```tsx
import React from 'react';
import type { StandardEditorProps } from '@grafana/data';
import { TextArea } from '@grafana/ui';

/**
 * A textarea for the per-group blade table.
 *
 * Grafana's option builder has no textarea — addTextInput is one line — so a
 * table that wants several needs a custom editor. Same construction as the
 * Ranges table in GroupingEditor, and deliberately nothing more than a
 * textarea: this option edits a string, and what the parser cannot read is
 * reported in the panel's own warnings strip, where the reader is already
 * looking.
 */
export function BladeEditor({ value, onChange }: StandardEditorProps<string>) {
  return (
    <TextArea
      rows={5}
      placeholder={'rack[1-120]: 2\nrack[121-125]: 3'}
      value={value ?? ''}
      onChange={(e) => onChange(e.currentTarget.value)}
    />
  );
}
```

- [ ] **Step 5: Register the options**

In `plugins/nodegrid-panel/src/module.ts`, add to the imports:

```ts
import { MAX_BLADE, MIN_BLADE } from '@slurm-views/core';
import { BladeEditor } from './editor/BladeEditor';
```

and insert immediately after the `cellHeight` number input:

```ts
      .addSliderInput({
        path: 'nodesPerBlade',
        name: 'Nodes per blade',
        description:
          'How many nodes share one slot in the cabinet. 1 is a single-node server, and draws one sled per node.',
        defaultValue: DEFAULT_OPTIONS.nodesPerBlade,
        settings: { min: MIN_BLADE, max: MAX_BLADE, step: 1 },
        category: ['Layout'],
        // A blade means nothing outside a cabinet.
        showIf: (options) => options.layout === 'rack',
      })
      .addCustomEditor({
        id: 'bladeOverrides',
        path: 'bladeOverrides',
        name: 'Nodes per blade, by group',
        description:
          'One line per declaration: a hostlist of group names, a colon, a count. Note the mirror of Ranges — the hostlist is on the left here, and names groups rather than nodes. # comments to end of line.',
        editor: BladeEditor,
        defaultValue: DEFAULT_OPTIONS.bladeOverrides,
        category: ['Layout'],
        showIf: (options) => options.layout === 'rack',
      })
```

- [ ] **Step 6: Wire the panel**

In `plugins/nodegrid-panel/src/components/NodeGridPanel.tsx`, add to the imports:

```tsx
import { parseBladeTable } from '@slurm-views/core';
import { layoutBlades } from './rackGeometry';
```

Add after the `unmapped` memo:

```tsx
  // Resolved once for the whole panel, because the width every cabinet shares
  // depends on the densest blade across all of them. Computed in both layouts
  // and consumed only in Rack: the cost is one pass over the groups, and a
  // conditional hook is worse than a wasted one.
  const blades = useMemo(() => {
    const table = parseBladeTable(options.bladeOverrides);
    const layout = layoutBlades({
      groupKeys: model.groups.map((g) => g.key),
      sizes: table.sizes,
      fallback: options.nodesPerBlade,
      cellWidth: options.cellWidth,
    });
    return { table, layout };
  }, [options.bladeOverrides, options.nodesPerBlade, options.cellWidth, model.groups]);
```

and pass it to `NodeGroup` alongside the props already there:

```tsx
            blades={blades.layout}
```

- [ ] **Step 7: Run the tests and watch them pass**

Run: `make test`
Expected: PASS.

- [ ] **Step 8: Look at it**

Run: `make up`, open **Slurm / Slurm node grid**, edit the panel, and check that:
- **Nodes per blade** and **Nodes per blade, by group** appear under Layout while the layout is Rack, and disappear when it is set to Wrap.
- Setting Nodes per blade to 4 turns each forty-node cabinet from forty rows into ten.
- Typing `rack1: 2` in the table leaves rack1 at twenty rows while the other five stay at ten.

Discard the edit rather than saving it.

- [ ] **Step 9: Lint and typecheck**

Run: `make lint && make typecheck`
Expected: both exit 0.

- [ ] **Step 10: Commit**

```bash
git add plugins/nodegrid-panel/src/editor/BladeEditor.tsx plugins/nodegrid-panel/src/types.ts plugins/nodegrid-panel/src/module.ts plugins/nodegrid-panel/src/components/NodeGridPanel.tsx plugins/nodegrid-panel/src/components/NodeGridPanel.test.tsx
git commit -m "feat(panel): offer nodes per blade, panel-wide and by group

Two options under Layout, both hidden by showIf outside the rack layout
because a blade means nothing outside a cabinet. This is the panel's first
use of showIf.

The default is 1, which is not a disguised off switch: one node per blade is
a true statement about most clusters, and the drawing it produces is the one
the panel already produced, so a reader who never opens the option sees no
change of any kind.

The per-group table needs a custom editor because Grafana's option builder
has no textarea — the same reason the Ranges table has one. The declaration
is resolved once for the whole panel, since the width every cabinet shares
depends on the densest blade across all of them."
```

---

### Task 5: Saying what it could not honour

**Files:**
- Modify: `plugins/nodegrid-panel/src/utils/warnings.ts`
- Modify: `plugins/nodegrid-panel/src/utils/warnings.test.ts`
- Modify: `plugins/nodegrid-panel/src/components/NodeGridPanel.tsx`

**Interfaces:**
- Consumes: `BladeTable['problems']` (Task 1), `BladeLayout['undrawn']` and `BladeLayout['squeezed']` (Task 2), the `blades` memo in the panel (Task 4).
- Produces: `BladeNotes` and a fifth, optional parameter on `summarise`.

- [ ] **Step 1: Write the failing test**

In `plugins/nodegrid-panel/src/utils/warnings.test.ts`, add:

```ts
describe('blade warnings', () => {
  const noGrouping: GroupingNotes = { source: { kind: 'none' }, orphans: [], emptyGroups: [], problems: [] };
  const empty = { groups: [], nodeCount: 0, slotCount: 0, duplicated: false };

  it('says nothing at all when there are no blade notes', () => {
    // Every wrap-layout panel is this case, and it must stay silent.
    expect(summarise(empty, [], [], noGrouping)).toEqual([]);
  });

  it('repeats problems from the parser verbatim', () => {
    const lines = summarise(empty, [], [], noGrouping, {
      problems: ['Line 2 has no "groups: count" separator.'],
      undrawn: [],
      squeezed: [],
    });
    expect(lines).toContain('Line 2 has no "groups: count" separator.');
  });

  it('collapses a hundred declared groups that are not drawn into one line', () => {
    // rack[1-120] against a query that returned twenty is a hundred missing
    // cabinets, and a hundred lines is a wall rather than a warning.
    const undrawn = Array.from({ length: 100 }, (_, i) => `rack${i + 21}`);
    const lines = summarise(empty, [], [], noGrouping, { problems: [], undrawn, squeezed: [] });
    expect(lines).toEqual([
      'Nodes per blade named 100 groups that are not drawn: rack[21-120].',
    ]);
  });

  it('says "group that is" for a single one', () => {
    const lines = summarise(empty, [], [], noGrouping, { problems: [], undrawn: ['rack9'], squeezed: [] });
    expect(lines).toEqual(['Nodes per blade named 1 group that is not drawn: rack9.']);
  });

  it('collapses squeezed cabinets by blade size, naming the width once', () => {
    // Every cabinet at the same blade size has the same sled width, because
    // they all share the rack width. One line per size, not one per cabinet.
    const squeezed = [
      { key: 'rack1', blade: 4, width: 6 },
      { key: 'rack2', blade: 4, width: 6 },
      { key: 'gpu1', blade: 3, width: 8 },
    ];
    const lines = summarise(empty, [], [], noGrouping, { problems: [], undrawn: [], squeezed });
    expect(lines).toEqual([
      'A blade of 3 leaves each node 8px wide in gpu1. Raise Cell width.',
      'A blade of 4 leaves each node 6px wide in rack[1-2]. Raise Cell width.',
    ]);
  });
});
```

Adjust the `GroupingNotes` literal to match the shape the file's existing tests use.

- [ ] **Step 2: Run the test and watch it fail**

Run: `make test`
Expected: FAIL — `summarise` takes four parameters.

- [ ] **Step 3: Add the notes and the lines**

In `plugins/nodegrid-panel/src/utils/warnings.ts`, add after the `GroupingNotes` interface:

```ts
/** Everything the blade layout could not honour. Absent outside the rack layout. */
export interface BladeNotes {
  /** Already-worded problems from the blade table parser. */
  problems: string[];
  /** Declared groups the panel is not drawing. */
  undrawn: string[];
  /** Drawn groups whose sled falls under the legibility floor. */
  squeezed: Array<{ key: string; blade: number; width: number }>;
}
```

Change the signature of `summarise` to:

```ts
export function summarise(
  model: GroupedModel,
  warnings: IngestWarning[],
  unmapped: string[],
  grouping: GroupingNotes,
  blades?: BladeNotes
): string[] {
```

Optional rather than required, and not for the sake of the twenty-two existing
call sites: a panel in the wrap layout has no blades at all, so no notes is a
real state rather than a missing argument.

Insert immediately after `lines.push(...grouping.problems);`:

```ts
  if (blades !== undefined) {
    lines.push(...blades.problems);

    if (blades.undrawn.length > 0) {
      const n = blades.undrawn.length;
      lines.push(
        `Nodes per blade named ${n} ${n === 1 ? 'group that is' : 'groups that are'} not drawn: ${listOf(blades.undrawn)}.`
      );
    }

    // One line per blade size, not one per cabinet: every cabinet at a given
    // size has the same sled width, because they all share the rack width, so
    // a hundred squeezed cabinets would print a hundred identical sentences.
    const bySize = new Map<number, { keys: string[]; width: number }>();
    for (const { key, blade, width } of blades.squeezed) {
      const seen = bySize.get(blade);
      if (seen === undefined) {
        bySize.set(blade, { keys: [key], width });
      } else {
        seen.keys.push(key);
      }
    }
    for (const [blade, { keys, width }] of [...bySize].sort((a, b) => a[0] - b[0])) {
      lines.push(`A blade of ${blade} leaves each node ${width}px wide in ${listOf(keys)}. Raise Cell width.`);
    }
  }
```

- [ ] **Step 4: Feed it from the panel**

In `plugins/nodegrid-panel/src/components/NodeGridPanel.tsx`, replace the `lines` memo with:

```tsx
  const lines = useMemo(
    () =>
      summarise(
        model,
        warnings,
        unmapped,
        grouping,
        // Only in the rack layout: the options are hidden in Wrap, so warning
        // about a table nobody can see would be warning about nothing.
        options.layout === 'rack'
          ? {
              problems: blades.table.problems.map((p) => p.detail),
              undrawn: blades.layout.undrawn,
              squeezed: blades.layout.squeezed,
            }
          : undefined
      ),
    [model, warnings, unmapped, grouping, options.layout, blades]
  );
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `make test`
Expected: PASS, with the twenty-two existing `summarise` call sites untouched.

- [ ] **Step 6: Look at it**

Run: `make up`, edit the node grid panel, set the layout to Rack and type `rack9: 4` in the blade table. The strip must say `Nodes per blade named 1 group that is not drawn: rack9.` Then set Cell width to 6 and Nodes per blade to 4, and check the squeeze line appears. Discard the edit.

- [ ] **Step 7: Lint and typecheck**

Run: `make lint && make typecheck`
Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add plugins/nodegrid-panel/src/utils/warnings.ts plugins/nodegrid-panel/src/utils/warnings.test.ts plugins/nodegrid-panel/src/components/NodeGridPanel.tsx
git commit -m "feat(panel): name the blades it could not honour

Three sources: the parser's own problems, a declaration for a cabinet the
query did not return, and a sled squeezed under the legibility floor the Cell
width description already names.

Both of the panel's own lines are collapsed, because both scale with the
floor plan rather than with the mistake. rack[1-120] against a query that
returned twenty is a hundred missing cabinets, and every cabinet at the same
blade size has the same sled width since they share the rack width — so it is
one line per size, not one per cabinet.

The parameter is optional because a panel in the wrap layout has no blades at
all. That is a real state, not a missing argument."
```

---

### Task 6: Documentation, a live demonstration, and a browser test

**Files:**
- Modify: `plugins/nodegrid-panel/src/README.md`
- Modify: `dev/provisioning/dashboards/slurm-node-grouping.json`
- Modify: `dev/README.md`
- Modify: `plugins/nodegrid-panel/tests/nodegrid.spec.ts`

**Interfaces:**
- Consumes: everything above. Produces nothing further.

- [ ] **Step 1: Write the failing browser test**

In `plugins/nodegrid-panel/tests/nodegrid.spec.ts`, add a new `test.describe` at the end:

```ts
test.describe('blades, against the same live data', () => {
  test('draws a quad cabinet four sleds wide and a duo cabinet two', async ({ page }) => {
    // getBoundingClientRect, not toBeVisible: the question is where these
    // cells actually are, and toBeVisible passes for anything mounted.
    await gotoPanelWithData(page, 9, 'rack1');

    const rows = async (group: string) => {
      const boxes = await page
        .getByTestId(`node-group-${group}`)
        .locator('[data-testid^="node-cell-"]')
        .evaluateAll((cells) => cells.map((c) => Math.round(c.getBoundingClientRect().top)));
      return new Set(boxes).size;
    };

    // Forty nodes: ten rows at four per blade, twenty at two.
    expect(await rows('rack1')).toBe(10);
    expect(await rows('gpu1')).toBe(20);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `make up`, then:

```bash
docker compose -f dev/docker-compose.yml run --rm tools sh -c 'cd plugins/nodegrid-panel && pnpm exec playwright test -g "draws a quad cabinet"'
```

Expected: FAIL — panel 9 does not exist.

- [ ] **Step 3: Add the demonstration panel**

Add a ninth panel to `dev/provisioning/dashboards/slurm-node-grouping.json`, after panel 8, at `gridPos` `{ "h": 9, "w": 24, "x": 0, "y": 31 }`:

```json
{
  "id": 9,
  "title": "Blades -- a mixed floor, against live Prometheus",
  "description": "rack1-rack4 are quads and gpu1-gpu2 are duos, declared as two hostlist lines rather than six. The cabinets are the same width whichever blade they hold, because a floor plan whose cabinets differ in width does not read as a floor plan.",
  "type": "tomzone-slurm-panel",
  "datasource": { "type": "prometheus", "uid": "slurm-views-prom" },
  "gridPos": { "h": 9, "w": 24, "x": 0, "y": 31 },
  "targets": [
    { "refId": "A", "expr": "slurm_node_status", "instant": true, "format": "table" }
  ],
  "options": {
    "layout": "rack",
    "cellWidth": 14,
    "nodesPerBlade": 1,
    "bladeOverrides": "rack[1-4]: 4\ngpu[1-2]: 2",
    "grouping": { "kind": "label", "label": "rack" },
    "slots": { "state": "A" }
  }
}
```

Copy the `labels`, `slots` and any other `options` keys from panel 5 in the same file rather than inventing them, and keep this panel's `datasource` uid identical to panel 5's. The point of the two hostlist lines is that they exercise the left-hand expansion against real group names.

- [ ] **Step 4: Run the browser test and watch it pass**

Run: `make e2e`
Expected: PASS, seventeen tests.

- [ ] **Step 5: Document it for the reader**

In `plugins/nodegrid-panel/src/README.md`, add a `### Blades` subsection under the layout documentation:

```markdown
### Blades

In the Rack layout, **Nodes per blade** says how many nodes share one slot in
the cabinet. The default is 1 — a single-node server — and it draws one sled
per node. Set it to 4 and a forty-node cabinet becomes ten rows instead of
forty.

**Nodes per blade, by group** overrides it for the groups it names, one line
per declaration:

```
rack[1-120]: 2
rack[121-125]: 3
gpu1: 4
```

The left-hand side is a Slurm hostlist of **group** names, so a floor of 125
cabinets is two lines. Note the mirror of the Ranges table, where the hostlist
is on the right and names nodes: here it is on the left and names groups. `#`
comments run to end of line.

Every cabinet is drawn the same width, taken from the densest blade in the
panel rather than its own, because a floor plan whose cabinets differ in width
does not read as a floor plan. A duo's sleds are simply wider than a quad's,
as they are in the hardware.

A blade here is a count of nodes in a row, and nothing else. A 4U chassis
holding two nodes above two more cannot be described by a count and is not
supported. Neither is a cabinet that mixes blade sizes within itself —
**declare it as two groups**, which costs nothing and keeps every position on
the drawing true. A group with no declaration keeps one sled per node, a
vertical stack that makes no claim about where anything sits sideways.
```

- [ ] **Step 6: Document the demonstration panel**

In `dev/README.md`, add a row to the eight-panel table in "Three ways to a topology, and how each one is wired", and change the sentence introducing it from eight panels to nine:

```markdown
| 9 | Blades -- a mixed floor | Label `rack` | Prometheus, with `rack[1-4]: 4` and `gpu[1-2]: 2` declared per group |
```

- [ ] **Step 7: Run everything**

Run: `make check && make e2e`
Expected: both exit 0. `make check` runs lint, typecheck, the full unit suite and the React 19 scan.

- [ ] **Step 8: Commit**

```bash
git add plugins/nodegrid-panel/src/README.md dev/README.md dev/provisioning/dashboards/slurm-node-grouping.json plugins/nodegrid-panel/tests/nodegrid.spec.ts
git commit -m "docs(panel): document blades, and prove them against live data

The demonstration panel declares rack[1-4] as quads and gpu[1-2] as duos in
two lines, which is the point: the hostlist on the left is what makes a floor
of 125 cabinets two lines rather than 125, and a mixed floor is what shows
that every cabinet keeps the same width whichever blade it holds.

The browser test counts distinct row offsets through getBoundingClientRect
rather than asserting visibility, because the question is where the cells
actually are — forty nodes are ten rows at four per blade and twenty at two —
and toBeVisible passes for anything mounted."
```

---

## Self-review

**Spec coverage.** Every section of the spec maps to a task: the two options and the editor to Task 4; the hostlist on the left to Task 1; the two-logical-racks escape hatch to Task 6's documentation; the row/wrap-reverse frame, the shared rack width and the unchanged row height to Tasks 2 and 3; the parser's four error rows, comments and blank lines to Task 1; the two collapsed panel warnings to Tasks 2 and 5; every test the spec names to the task that owns the file. The spec's "out of scope" list is carried into the Global Constraints and into the README so it survives the plan.

**Type consistency.** `BladeTable`, `BladeProblem`, `MIN_BLADE` and `MAX_BLADE` are defined in Task 1 and used under those names in Tasks 2, 4 and 5. `BladeLayout`, `BladeLayoutInput`, `layoutBlades`, `sledWidthFor` and `MIN_SLED_WIDTH` are defined in Task 2 and used under those names in Tasks 3, 4 and 5. `BladeNotes` is defined in Task 5 and used only there. `RackFrameProps.width` replaces `cellWidth` in Task 3 and every caller is updated in the same task. `PanelOptions.nodesPerBlade` and `PanelOptions.bladeOverrides` are added in Task 4 and read in Tasks 4 and 5 under those names.
