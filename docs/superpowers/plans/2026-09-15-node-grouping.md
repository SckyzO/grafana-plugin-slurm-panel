# Node Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the node grid a grouping mechanism that works without the `rack` label `slurm_exporter` can never publish, without the panel ever becoming the source of topology.

**Architecture:** Three rungs, ordered by how far the truth travels and separated by the privilege each needs. Rung 1 (Prometheus relabelling) already works through the existing `label` key source and gains only documentation plus a generator. Rung 2 (a join transformation) gains verification and a worked example. Rung 3 is new: a range table in Slurm hostlist syntax, parsed in `packages/core`, stored as a panel option string that may resolve a dashboard variable. Everything the panel cannot resolve — orphan nodes, declared ranges that matched nothing, a label that would group better — is named in the warnings strip rather than hidden.

**Tech Stack:** TypeScript 5.9.2, React 18.3, `@grafana/*` 13.2.1, Jest 29 (ts-jest ESM), Playwright 1.63, Node 24 and pnpm 12.4.1 inside the toolchain container.

**Spec:** [`docs/superpowers/specs/2026-09-15-node-grouping-design.md`](../specs/2026-09-15-node-grouping-design.md) (commit `d0bf474`)

## Global Constraints

- **Every command runs in a container.** Use `make` targets only. Never run `pnpm`, `node`, `npx`, `tsc`, `jest` or `playwright` on the host. `make test`, `make lint`, `make typecheck`, `make build`, `make check`, `make up`, `make e2e`.
- **Never run `pnpm approve-builds`.** Never set `dangerouslyAllowAllBuilds: true`. Never weaken `strictDepBuilds`, `minimumReleaseAge: 4320`, `blockExoticSubdeps` or `allowBuilds` in `pnpm-workspace.yaml` to make an install succeed.
- **Never stop, restart or reconfigure a container this repository did not create.** The `slurm` compose project holding ports 3000 and 9090 belongs to the user's `slurm_exporter` stack. This repository's project is named `slurm-views` and uses 3001 and 9091.
- **`packages/core` imports no Grafana package, ever.** It talks in `MinimalFrame` / `MinimalField`. That is what lets its tests run without a DOM.
- **Test file locations differ by package.** Core: `packages/core/test/<name>.test.ts`. Panel: colocated beside the source, `src/**/<name>.test.tsx`. Contract: `tests/contract/*.test.cjs`.
- **Commit messages are Conventional Commits** (`type(scope): subject`), written in English, in the first person of the maintainer. **Never mention Claude, AI, assistance or generation** — not in the body, not in a signature, not in a trailer.
- **No dead code.** Every line merged is used by something in the repository.
- **Non-regression is a test, not an intention.** Every behaviour change carries a test that fails before it and passes after. Run the test and see it fail before writing the implementation.
- **Fresh commits only.** No `git commit --amend`, `git reset`, `git rebase` or `git push`.
- Branch: `slice-1-node-grid`.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `packages/core/src/group/hostlist.ts` | Slurm hostlist syntax both ways: expand an expression to names, collapse names back for display |
| `packages/core/src/group/ranges.ts` | Parse a range table into declared groups, a node index, and human-readable problems |
| `packages/core/src/group/coverage.ts` | Measure whether some label would group more nodes than the active source does |
| `packages/core/test/hostlist.test.ts` | Tests for the above |
| `packages/core/test/ranges.test.ts` | Tests for the above |
| `packages/core/test/coverage.test.ts` | Tests for the above |
| `dev/relabel/racks.txt` | The dev cluster's range table — the input to both rung 1 and rung 3 |
| `dev/relabel/generate.mjs` | Range table to a Prometheus scrape config carrying `metric_relabel_configs` |
| `tests/contract/relabel.test.cjs` | The panel and the generated regex agree on every node |
| `docs/grouping.md` | The three rungs, for the repository |

**Modified:**

| File | Change |
|---|---|
| `packages/core/src/group/keys.ts` | `ranges` key source, `declaredKeys()` |
| `packages/core/src/group/build.ts` | `BuildOptions.order` — declared order, and groups emitted even when empty |
| `packages/core/src/index.ts` | Export the new surface |
| `plugins/nodegrid-panel/src/types.ts` | `cellWidth` / `cellHeight` replace `cellSize`; `maxCells` removed |
| `plugins/nodegrid-panel/src/module.ts` | Editor entries follow |
| `plugins/nodegrid-panel/src/utils/unmapped.ts` to `warnings.ts` | Renamed: it now carries grouping warnings too |
| `plugins/nodegrid-panel/src/hooks/useNodeModel.ts` | Interpolate the table once, build the grouping notes |
| `plugins/nodegrid-panel/src/components/NodeGridPanel.tsx` | Pass `replaceVariables`, new `summarise` signature |
| `plugins/nodegrid-panel/src/components/NodeGroup.tsx` | Unplaced and empty groups |
| `plugins/nodegrid-panel/src/components/GroupHeader.tsx` | The `unplaced` marker |
| `plugins/nodegrid-panel/src/components/RackFrame.tsx` | Dashed frame, explicit width |
| `plugins/nodegrid-panel/src/components/NodeCell.tsx` | `width` / `height` replace `size` |
| `plugins/nodegrid-panel/src/components/rackGeometry.ts` | `resolveCellSize()` |
| `plugins/nodegrid-panel/src/editor/GroupingEditor.tsx` | The Ranges kind and its textarea |
| `dev/prometheus/prometheus.yml` | `scrape_config_files` |
| `dev/provisioning/dashboards/*.json` | Option renames; the grouping dashboard gains rungs |
| `Makefile` | Generate the scrape config in `up` |
| `.gitignore` | The generated scrape config |
| `plugins/nodegrid-panel/src/README.md`, `dev/README.md` | Documentation |

---

## Task 1: Slurm hostlist, both directions

**Files:**
- Create: `packages/core/src/group/hostlist.ts`
- Test: `packages/core/test/hostlist.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `EXPANSION_CAP: number`, `expandHostlist(expr: string): { names: string[]; error?: string }`, `collapseHostlist(names: string[]): string[]`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/hostlist.test.ts`:

```ts
import { expandHostlist, collapseHostlist, EXPANSION_CAP } from '../src/group/hostlist.js';

describe('expandHostlist', () => {
  it('expands a simple range', () => {
    expect(expandHostlist('c[1-5]').names).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
  });

  it('expands a mixed body of ranges and singletons', () => {
    expect(expandHostlist('c[1-3,7,10-11]').names).toEqual(['c1', 'c2', 'c3', 'c7', 'c10', 'c11']);
  });

  it('keeps the written width, because node[001-003] is not node1', () => {
    expect(expandHostlist('node[001-003]').names).toEqual(['node001', 'node002', 'node003']);
  });

  it('joins several expressions on the commas that are outside brackets', () => {
    expect(expandHostlist('c[1-2],g[1-2]').names).toEqual(['c1', 'c2', 'g1', 'g2']);
  });

  it('accepts a bare name with no brackets at all', () => {
    expect(expandHostlist('login1').names).toEqual(['login1']);
  });

  it('keeps a suffix after the bracket', () => {
    expect(expandHostlist('r[1-2]n1').names).toEqual(['r1n1', 'r2n1']);
  });

  it('reports a backwards range rather than returning nothing silently', () => {
    const { names, error } = expandHostlist('c[5-1]');
    expect(names).toEqual([]);
    expect(error).toContain('backwards');
  });

  it('reports an unbalanced bracket', () => {
    expect(expandHostlist('c[1-5').error).toBeDefined();
  });

  it('refuses to expand past the cap instead of hanging the render', () => {
    const { names, error } = expandHostlist(`c[1-${EXPANSION_CAP + 1}]`);
    expect(names).toEqual([]);
    expect(error).toContain(String(EXPANSION_CAP));
  });
});

describe('collapseHostlist', () => {
  it('collapses a contiguous run', () => {
    expect(collapseHostlist(['c1', 'c2', 'c3'])).toEqual(['c[1-3]']);
  });

  it('breaks a run at every gap', () => {
    expect(collapseHostlist(['c1', 'c2', 'c5'])).toEqual(['c[1-2,5]']);
  });

  it('leaves a lone name alone rather than bracketing it', () => {
    expect(collapseHostlist(['c7'])).toEqual(['c7']);
  });

  it('never merges two widths into one range', () => {
    // c01 and c1 expand back differently, so collapsing them together would
    // produce a string that does not mean what it came from.
    expect(collapseHostlist(['c1', 'c01'])).toEqual(['c01', 'c1']);
  });

  it('round-trips: expanding what it produced gives back what it was given', () => {
    const names = ['c1', 'c2', 'c3', 'c9', 'g1', 'g2'];
    const round = collapseHostlist(names).flatMap((item) => expandHostlist(item).names);
    expect(round.sort()).toEqual([...names].sort());
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `make test`
Expected: FAIL — `Cannot find module '../src/group/hostlist.js'`.

- [ ] **Step 3: Implement**

Create `packages/core/src/group/hostlist.ts`:

```ts
/**
 * Slurm hostlist syntax, both ways.
 *
 * `sinfo` prints node sets as `c[1-10,20]`, and every Slurm administrator
 * reads and writes that notation daily. The range table borrows it rather than
 * inventing a grammar, and the same grammar collapses a list of names back for
 * display — which is what keeps a warning about 240 orphans to one line.
 */

/**
 * The most names one expression may expand to. A range table is typed by hand,
 * so `node[1-100000]` is always one keystroke away, and expanding it would
 * hang the render. This is a constant and not an option: a threshold nobody
 * can name a good value for is not a setting, it is a constant with a form
 * around it.
 */
export const EXPANSION_CAP = 20000;

export interface Expansion {
  names: string[];
  /** Set when the expression could not be read. `names` is then empty. */
  error?: string;
}

/** Split on the commas that are outside brackets: `c[1-3],g[1-2]` is two items. */
function splitTop(expr: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of expr) {
    if (ch === '[') {
      depth++;
    } else if (ch === ']') {
      depth = Math.max(0, depth - 1);
    }
    if (ch === ',' && depth === 0) {
      items.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  items.push(current);
  return items.map((s) => s.trim()).filter((s) => s !== '');
}

/** prefix, optional bracketed body, optional suffix — and no stray brackets. */
const ITEM = /^([^[\]]*)(?:\[([^[\]]*)\])?([^[\]]*)$/;
const BOUND = /^(\d+)(?:-(\d+))?$/;

export function expandHostlist(expr: string): Expansion {
  const names: string[] = [];

  for (const item of splitTop(expr)) {
    const parts = ITEM.exec(item);
    if (parts === null) {
      return { names: [], error: `cannot read "${item}"` };
    }
    const prefix = parts[1] ?? '';
    const body = parts[2];
    const suffix = parts[3] ?? '';

    if (body === undefined) {
      if (prefix === '' && suffix === '') {
        return { names: [], error: `cannot read "${item}"` };
      }
      names.push(prefix + suffix);
      continue;
    }

    for (const raw of body.split(',')) {
      const part = raw.trim();
      const bound = BOUND.exec(part);
      if (bound === null) {
        return { names: [], error: `"${part}" is not a number or a range` };
      }
      const startText = bound[1] ?? '';
      const endText = bound[2];
      const start = Number(startText);
      const end = endText === undefined ? start : Number(endText);
      if (end < start) {
        return { names: [], error: `"${part}" counts backwards` };
      }
      if (names.length + (end - start + 1) > EXPANSION_CAP) {
        return { names: [], error: `expands past ${EXPANSION_CAP} names` };
      }
      // Slurm keeps the written width: node[001-100] is node001, not node1.
      const width = startText.length > 1 && startText.startsWith('0') ? startText.length : 0;
      for (let n = start; n <= end; n++) {
        names.push(prefix + String(n).padStart(width, '0') + suffix);
      }
    }
  }

  return { names };
}

const TRAILING = /^(.*?)(\d+)$/;

/**
 * Names collapsed back to hostlist items, one per prefix-and-width run.
 *
 * Width is part of the grouping key on purpose: `c1` and `c01` expand back
 * differently, so a range spanning both would print a string that no longer
 * means what it came from.
 */
export function collapseHostlist(names: string[]): string[] {
  const runs = new Map<string, { prefix: string; width: number; numbers: number[] }>();
  const plain: string[] = [];

  for (const name of names) {
    const match = TRAILING.exec(name);
    if (match === null) {
      plain.push(name);
      continue;
    }
    const prefix = match[1] ?? '';
    const digits = match[2] ?? '';
    const width = digits.length > 1 && digits.startsWith('0') ? digits.length : 0;
    const key = `${prefix} ${width}`;
    const run = runs.get(key) ?? { prefix, width, numbers: [] };
    run.numbers.push(Number(digits));
    runs.set(key, run);
  }

  const out = [...plain];

  for (const { prefix, width, numbers } of runs.values()) {
    const sorted = [...new Set(numbers)].sort((a, b) => a - b);
    const pad = (n: number): string => String(n).padStart(width, '0');
    const parts: string[] = [];
    let start = sorted[0] ?? 0;
    let prev = start;
    const flush = (): void => {
      parts.push(start === prev ? pad(start) : `${pad(start)}-${pad(prev)}`);
    };
    for (const n of sorted.slice(1)) {
      if (n === prev + 1) {
        prev = n;
        continue;
      }
      flush();
      start = n;
      prev = n;
    }
    flush();
    const single = parts.length === 1 && !parts[0]!.includes('-');
    out.push(single ? prefix + parts[0] : `${prefix}[${parts.join(',')}]`);
  }

  return out.sort();
}
```

Note on the run key: the prefix and the width are joined with a space because a
prefix cannot contain one — `c 0` and `c 2` are distinct keys, and no real node
name collides with either.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `make test`
Expected: PASS — all 13 new tests green, nothing else broken.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/group/hostlist.ts packages/core/test/hostlist.test.ts
git commit -m "feat(core): read and write Slurm hostlist syntax

The range table borrows the notation sinfo already prints rather than
inventing one, so an administrator has no syntax to learn. The same
grammar collapses names back for display, which is what keeps a warning
about 240 orphan nodes to a single line.

Width is part of the collapse key: c1 and c01 expand back differently, so
a range spanning both would print a string that no longer means what it
came from. Expansion is capped, because a hand-typed table is always one
keystroke away from node[1-100000]."
```

---

## Task 2: The range table and the `ranges` key source

**Files:**
- Create: `packages/core/src/group/ranges.ts`
- Modify: `packages/core/src/group/keys.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/ranges.test.ts`

**Interfaces:**
- Consumes: `expandHostlist` from Task 1.
- Produces: `parseRangeTable(table: string): RangeTable` where `RangeTable = { groups: Array<{ name: string; members: string[] }>; index: Map<string, string>; problems: Array<{ line: number; detail: string }> }`; the `KeySource` variant `{ kind: 'ranges'; table: string }`; `declaredKeys(source: KeySource): string[]`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/ranges.test.ts`:

```ts
import { parseRangeTable } from '../src/group/ranges.js';
import { makeKeyFn, declaredKeys, UNGROUPED } from '../src/group/keys.js';
import type { SlurmNode } from '../src/model/types.js';

const node = (name: string): SlurmNode => ({
  name, state: 'idle', partitions: [], labels: {}, facets: { gres: [] },
});

const TABLE = `
# Row A
rack1: c[1-3]
rack2: c[4-6]

gpu: g[1-2]
`;

describe('parseRangeTable', () => {
  it('keeps the declared order, which is the machine room order', () => {
    expect(parseRangeTable(TABLE).groups.map((g) => g.name)).toEqual(['rack1', 'rack2', 'gpu']);
  });

  it('indexes every member', () => {
    const { index } = parseRangeTable(TABLE);
    expect(index.get('c5')).toBe('rack2');
    expect(index.get('g2')).toBe('gpu');
    expect(index.get('c99')).toBeUndefined();
  });

  it('ignores comments and blank lines', () => {
    expect(parseRangeTable(TABLE).problems).toEqual([]);
  });

  it('skips one invalid line and still parses the others', () => {
    // A grid that blanks on every keystroke is unusable, and this string is
    // invalid for most of the time it is being typed.
    const { groups, problems } = parseRangeTable('rack1: c[1-2]\nbroken: c[5-1]\nrack3: c[7-8]');
    expect(groups.map((g) => g.name)).toEqual(['rack1', 'rack3']);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.line).toBe(2);
    expect(problems[0]!.detail).toContain('backwards');
  });

  it('reports a line with no separator', () => {
    const { problems } = parseRangeTable('rack1 c[1-2]');
    expect(problems[0]!.detail).toContain('separator');
  });

  it('gives a duplicated node to the first line that claimed it, and says so', () => {
    const { index, problems } = parseRangeTable('rack1: c[1-3]\nrack2: c[3-4]');
    expect(index.get('c3')).toBe('rack1');
    expect(problems[0]!.detail).toContain('c3');
    expect(problems[0]!.detail).toContain('rack1');
  });

  it('refuses a second declaration of the same group name', () => {
    const { groups, problems } = parseRangeTable('rack1: c[1-2]\nrack1: c[5-6]');
    expect(groups).toHaveLength(1);
    expect(problems[0]!.detail).toContain('again');
  });
});

describe('the ranges key source', () => {
  it('places a node by the table', () => {
    const keyFn = makeKeyFn({ kind: 'ranges', table: TABLE });
    expect(keyFn(node('c5')).key).toBe('rack2');
  });

  it('is never assumed: a table is stated, not inferred', () => {
    const keyFn = makeKeyFn({ kind: 'ranges', table: TABLE });
    expect(keyFn(node('c5')).assumed).toBe(false);
  });

  it('leaves a node the table does not mention ungrouped', () => {
    const keyFn = makeKeyFn({ kind: 'ranges', table: TABLE });
    expect(keyFn(node('c99')).key).toBe(UNGROUPED);
  });
});

describe('declaredKeys', () => {
  it('returns the declared order for a range table', () => {
    expect(declaredKeys({ kind: 'ranges', table: TABLE })).toEqual(['rack1', 'rack2', 'gpu']);
  });

  it('returns nothing for a source that only discovers its groups by reading nodes', () => {
    expect(declaredKeys({ kind: 'label', label: 'partition' })).toEqual([]);
    expect(declaredKeys({ kind: 'capture', pattern: '^(r\\d+)' })).toEqual([]);
    expect(declaredKeys({ kind: 'chunk', size: 40 })).toEqual([]);
    expect(declaredKeys({ kind: 'none' })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `make test`
Expected: FAIL — `Cannot find module '../src/group/ranges.js'`.

- [ ] **Step 3: Implement the parser**

Create `packages/core/src/group/ranges.ts`:

```ts
import { expandHostlist } from './hostlist.js';

export interface RangeGroup {
  name: string;
  /** Node names this group actually claimed, in declared order. */
  members: string[];
}

export interface RangeProblem {
  /** 1-based, so it matches what the operator sees in the textarea. */
  line: number;
  detail: string;
}

export interface RangeTable {
  groups: RangeGroup[];
  /** node name to group name. The first line that claims a node keeps it. */
  index: Map<string, string>;
  problems: RangeProblem[];
}

/**
 * A node-to-group table: one line per group, `name: hostlist`, in display
 * order.
 *
 * Nothing here throws and nothing here is fatal. One bad line is skipped and
 * reported while the rest still parses, because this string is typed by hand
 * into a panel option and is invalid for most of the time it is being typed.
 * A grid that blanks on every keystroke cannot be used.
 */
export function parseRangeTable(table: string): RangeTable {
  const groups: RangeGroup[] = [];
  const index = new Map<string, string>();
  const problems: RangeProblem[] = [];

  table.split('\n').forEach((raw, i) => {
    const line = i + 1;
    // A 200-line table wants section headings, so `#` comments to end of line.
    const text = (raw.split('#')[0] ?? '').trim();
    if (text === '') {
      return;
    }

    const colon = text.indexOf(':');
    if (colon < 1) {
      problems.push({ line, detail: `Line ${line} has no "name: hostlist" separator.` });
      return;
    }

    const name = text.slice(0, colon).trim();
    const expr = text.slice(colon + 1).trim();
    if (name === '' || expr === '') {
      problems.push({ line, detail: `Line ${line} is missing a ${name === '' ? 'name' : 'hostlist'}.` });
      return;
    }
    if (groups.some((g) => g.name === name)) {
      problems.push({ line, detail: `Line ${line} declares "${name}" again; the first declaration keeps its nodes.` });
      return;
    }

    const { names, error } = expandHostlist(expr);
    if (error !== undefined) {
      problems.push({ line, detail: `Line ${line} ("${name}"): ${error}.` });
      return;
    }

    const members: string[] = [];
    for (const nodeName of names) {
      const owner = index.get(nodeName);
      if (owner !== undefined) {
        problems.push({
          line,
          detail: `${nodeName} is claimed by both "${owner}" and "${name}"; kept in "${owner}".`,
        });
        continue;
      }
      index.set(nodeName, name);
      members.push(nodeName);
    }
    groups.push({ name, members });
  });

  return { groups, index, problems };
}
```

- [ ] **Step 4: Add the key source**

In `packages/core/src/group/keys.ts`, add the import at the top:

```ts
import { parseRangeTable } from './ranges.js';
```

Extend the union:

```ts
export type KeySource =
  | { kind: 'label'; label: string }
  | { kind: 'capture'; pattern: string }
  | { kind: 'chunk'; size: number }
  | { kind: 'ranges'; table: string }
  | { kind: 'none' };
```

Add the case to `makeKeyFn`, immediately after the `capture` case:

```ts
    case 'ranges': {
      // Parsed once per key function, not once per node.
      const { index } = parseRangeTable(source.table);
      return (node) => {
        const key = index.get(node.name);
        // A range table is an explicit human assertion, not an inference, so
        // it is never `assumed`. Chunking remains the only source that invents.
        return key === undefined ? NO_KEY : { key, assumed: false };
      };
    }
```

Append at the end of the file:

```ts
/**
 * The group keys a source states up front, in the order it stated them.
 *
 * Only a range table does. A label or a capture discovers its groups by
 * reading nodes, so it can neither choose their order nor name one that turned
 * out to be empty — and rack order on a machine room floor is not alphabetical.
 *
 * This parses the table a second time, and that is deliberate: it is a pure
 * function over a string of at most a few kilobytes, and caching it would put
 * mutable module state into a package whose whole value is being pure.
 */
export function declaredKeys(source: KeySource): string[] {
  return source.kind === 'ranges' ? parseRangeTable(source.table).groups.map((g) => g.name) : [];
}
```

- [ ] **Step 5: Export the new surface**

In `packages/core/src/index.ts`, replace the two grouping export lines with:

```ts
export { makeKeyFn, ordinalOf, declaredKeys, UNGROUPED } from './group/keys.js';
export type { KeySource, KeyResult } from './group/keys.js';
export { expandHostlist, collapseHostlist, EXPANSION_CAP } from './group/hostlist.js';
export type { Expansion } from './group/hostlist.js';
export { parseRangeTable } from './group/ranges.js';
export type { RangeTable, RangeGroup, RangeProblem } from './group/ranges.js';
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `make test && make typecheck`
Expected: PASS. `keys.test.ts` must still be green — the existing sources are untouched.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/group/ranges.ts packages/core/src/group/keys.ts \
        packages/core/src/index.ts packages/core/test/ranges.test.ts
git commit -m "feat(core): group nodes by a declared range table

slurm_exporter publishes no rack label and cannot: it reads sinfo, which
has no concept of one. This is the rung that works when the operator can
edit neither the scrape nor a transformation chain — a table of one line
per group, in Slurm hostlist syntax.

Nothing in the parser is fatal. A bad line is skipped and reported while
the rest still parses, because the string is typed by hand into a panel
option and is invalid for most of the time it is being typed. A node
claimed twice goes to the first line that claimed it, and the duplicate is
reported rather than resolved in silence.

The source is never marked assumed. A table is stated; chunking remains
the only source that invents."
```

---

## Task 3: Declared order, and groups that are empty

**Files:**
- Modify: `packages/core/src/group/build.ts`
- Test: `packages/core/test/build.test.ts`

**Interfaces:**
- Consumes: `declaredKeys` from Task 2 (used by the caller, not here).
- Produces: `BuildOptions.order?: string[]`.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/build.test.ts`:

```ts
describe('declared order', () => {
  const rackNode = (name: string, rack: string): SlurmNode => ({
    name, state: 'idle', partitions: [], labels: { rack }, facets: { gres: [] },
  });

  const source = { kind: 'label', label: 'rack' } as const;

  it('emits declared groups in the order they were declared, not alphabetically', () => {
    // A machine room floor is not in alphabetical order, and the table is the
    // only place the operator can say what order it is in.
    const nodes = [rackNode('c1', 'zulu'), rackNode('c2', 'alpha')];
    const model = buildGroups(nodes, source, { order: ['zulu', 'alpha'] });
    expect(model.groups.map((g) => g.key)).toEqual(['zulu', 'alpha']);
  });

  it('emits a declared group that matched no node, empty, in its declared place', () => {
    const nodes = [rackNode('c1', 'rack1'), rackNode('c2', 'rack3')];
    const model = buildGroups(nodes, source, { order: ['rack1', 'rack2', 'rack3'] });
    expect(model.groups.map((g) => g.key)).toEqual(['rack1', 'rack2', 'rack3']);
    expect(model.groups[1]!.nodes).toEqual([]);
  });

  it('does not count an empty group as nodes or as cells', () => {
    const nodes = [rackNode('c1', 'rack1')];
    const model = buildGroups(nodes, source, { order: ['rack1', 'rack2'] });
    expect(model.nodeCount).toBe(1);
    expect(model.slotCount).toBe(1);
  });

  it('sorts an undeclared group naturally, after every declared one', () => {
    const nodes = [rackNode('c1', 'rack9'), rackNode('c2', 'aaa'), rackNode('c3', 'rack1')];
    const model = buildGroups(nodes, source, { order: ['rack9'] });
    expect(model.groups.map((g) => g.key)).toEqual(['rack9', 'aaa', 'rack1']);
  });

  it('keeps ungrouped last whatever the declared order says', () => {
    const nodes = [rackNode('c1', 'rack1'), { ...rackNode('c2', ''), labels: {} }];
    const model = buildGroups(nodes, source, { order: ['ungrouped', 'rack1'] });
    expect(model.groups.at(-1)!.key).toBe(UNGROUPED);
  });

  it('changes nothing for a source that declares nothing', () => {
    const nodes = [rackNode('c1', 'zulu'), rackNode('c2', 'alpha')];
    expect(buildGroups(nodes, source).groups.map((g) => g.key)).toEqual(['alpha', 'zulu']);
  });

  it('draws no empty group when there is no data at all', () => {
    // Nothing to say about a floor plan when no node reported anything.
    expect(buildGroups([], source, { order: ['rack1'] }).groups).toEqual([]);
  });
});
```

Ensure `UNGROUPED` and the `SlurmNode` type are imported at the top of the file; add them to the existing import statements if they are not already there.

- [ ] **Step 2: Run the test and watch it fail**

Run: `make test`
Expected: FAIL — `order` is not a property of `BuildOptions`, and the order assertions fail.

- [ ] **Step 3: Implement**

In `packages/core/src/group/build.ts`, extend `BuildOptions`:

```ts
export interface BuildOptions {
  /**
   * Treat the key label as one a node may hold several values of — the
   * partition case. The node is then drawn in each of its groups.
   */
  multiValueLabel?: boolean;
  /**
   * Group keys the source declared, in declaration order. Keys named here are
   * emitted in this order and emitted even when no node matched them, so an
   * empty rack stays visible in its place on the floor. Keys not named here
   * keep the natural sort, after them.
   */
  order?: string[];
}
```

Inside `buildGroups`, immediately after `const buckets = new Map...`, seed the declared groups:

```ts
  // Seeded before the node loop so a declared group that matched nothing is
  // still emitted: an empty rack is information, not an absence.
  for (const key of opts.order ?? []) {
    if (!buckets.has(key)) {
      buckets.set(key, { nodes: [], assumed: false });
    }
  }
```

Replace the final sort with:

```ts
  const rank = new Map((opts.order ?? []).map((key, i): [string, number] => [key, i]));

  const groups: NodeGroup[] = [...buckets.entries()]
    .map(([key, bucket]) => ({ key, nodes: [...bucket.nodes].sort(compareNodes), assumed: bucket.assumed }))
    .sort((a, b) => {
      // "ungrouped" is a fallback, not a rack; it belongs last even when a
      // table happens to declare a group by that name.
      if (a.key === UNGROUPED) { return b.key === UNGROUPED ? 0 : 1; }
      if (b.key === UNGROUPED) { return -1; }
      const ra = rank.get(a.key);
      const rb = rank.get(b.key);
      if (ra !== undefined && rb !== undefined) { return ra - rb; }
      // A declared group outranks one that was merely discovered.
      if (ra !== undefined) { return -1; }
      if (rb !== undefined) { return 1; }
      return collator.compare(a.key, b.key);
    });
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `make test && make typecheck`
Expected: PASS — the seven new tests green, every existing `build.test.ts` test unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/group/build.ts packages/core/test/build.test.ts
git commit -m "feat(core): honour a declared group order, and draw empty groups

A range table states both which groups exist and what order they are in.
Neither survived the builder: groups were derived from the nodes present
and re-sorted alphabetically, so a rack that matched no node vanished and
a machine room floor came back in dictionary order.

One option covers both, because they are the same fact: groups named in
order are emitted in that order, and emitted even when empty. Sources that
declare nothing pass nothing and are byte-identical."
```

---

## Task 4: The coverage signal

**Files:**
- Create: `packages/core/src/group/coverage.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/coverage.test.ts`

**Interfaces:**
- Consumes: `makeKeyFn`, `UNGROUPED`, `KeySource`, `SlurmNode`.
- Produces: `suggestLabel(input: CoverageInput): CoverageSuggestion | undefined`, where `CoverageInput = { nodes: SlurmNode[]; source: KeySource; nodeLabel: string; stateLabel: string }` and `CoverageSuggestion = { label: string; covered: number; total: number }`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/coverage.test.ts`:

```ts
import { suggestLabel } from '../src/group/coverage.js';
import type { SlurmNode } from '../src/model/types.js';

const node = (name: string, labels: Record<string, string>): SlurmNode => ({
  name, state: 'idle', partitions: [], labels, facets: { gres: [] },
});

const withRack = [
  node('c1', { rack: 'r1', node: 'c1', status: 'idle' }),
  node('c2', { rack: 'r1', node: 'c2', status: 'idle' }),
  node('c3', { rack: 'r2', node: 'c3', status: 'idle' }),
];

const args = { nodeLabel: 'node', stateLabel: 'status' };

describe('suggestLabel', () => {
  it('says nothing when grouping is switched off, which is a choice', () => {
    expect(suggestLabel({ nodes: withRack, source: { kind: 'none' }, ...args })).toBeUndefined();
  });

  it('says nothing when the active source already covers as much', () => {
    const source = { kind: 'label', label: 'rack' } as const;
    expect(suggestLabel({ nodes: withRack, source, ...args })).toBeUndefined();
  });

  it('names a label that would cover more than the active source does', () => {
    const source = { kind: 'capture', pattern: '^(zzz)' } as const;
    expect(suggestLabel({ nodes: withRack, source, ...args }))
      .toEqual({ label: 'rack', covered: 3, total: 3 });
  });

  it('never nominates the node label, which is one group per node', () => {
    const nodes = [node('c1', { node: 'c1' }), node('c2', { node: 'c2' })];
    const source = { kind: 'capture', pattern: '^(zzz)' } as const;
    expect(suggestLabel({ nodes, source, ...args })).toBeUndefined();
  });

  it('never nominates the state label, which is a measurement and not a topology', () => {
    const nodes = [node('c1', { status: 'idle' }), node('c2', { status: 'down' })];
    const source = { kind: 'capture', pattern: '^(zzz)' } as const;
    expect(suggestLabel({ nodes, source, ...args })).toBeUndefined();
  });

  it('never nominates an identity in disguise', () => {
    const nodes = [node('c1', { serial: 'a' }), node('c2', { serial: 'b' })];
    const source = { kind: 'capture', pattern: '^(zzz)' } as const;
    expect(suggestLabel({ nodes, source, ...args })).toBeUndefined();
  });

  it('never nominates a label with one value, which would group everything into one', () => {
    // It would cover every node and so win the comparison every time, while
    // being useless advice.
    const nodes = [node('c1', { cluster: 'prod' }), node('c2', { cluster: 'prod' })];
    const source = { kind: 'capture', pattern: '^(zzz)' } as const;
    expect(suggestLabel({ nodes, source, ...args })).toBeUndefined();
  });

  it('says nothing when there are no nodes', () => {
    const source = { kind: 'capture', pattern: '^(c)' } as const;
    expect(suggestLabel({ nodes: [], source, ...args })).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `make test`
Expected: FAIL — `Cannot find module '../src/group/coverage.js'`.

- [ ] **Step 3: Implement**

Create `packages/core/src/group/coverage.ts`:

```ts
import { makeKeyFn, UNGROUPED } from './keys.js';
import type { KeySource } from './keys.js';
import type { SlurmNode } from '../model/types.js';

export interface CoverageSuggestion {
  label: string;
  /** Nodes this label would place. */
  covered: number;
  /** Nodes in the model. */
  total: number;
}

export interface CoverageInput {
  nodes: SlurmNode[];
  source: KeySource;
  /** The panel's configured node label. Excluded: one group per node. */
  nodeLabel: string;
  /** The panel's configured state label. Excluded: it changes between scrapes. */
  stateLabel: string;
}

/**
 * The label that would group more nodes than the active source does, if there
 * is one.
 *
 * This measures; it does not advise. "You should use a label" is an opinion
 * and becomes noise on second reading, whereas a number stops being printed
 * the moment it stops being true — which is why no special case is needed to
 * keep a correctly configured panel quiet.
 *
 * It never acts. Switching the source because a third party added a label to
 * the scrape would change a panel's behaviour with nothing in its JSON to
 * explain it.
 */
export function suggestLabel({ nodes, source, nodeLabel, stateLabel }: CoverageInput): CoverageSuggestion | undefined {
  // `none` is a choice, not a failure to group.
  if (source.kind === 'none' || nodes.length === 0) {
    return undefined;
  }

  const keyFn = makeKeyFn(source);
  const active = nodes.filter((node) => keyFn(node).key !== UNGROUPED).length;

  const counts = new Map<string, Map<string, number>>();
  for (const node of nodes) {
    for (const [label, value] of Object.entries(node.labels)) {
      if (label === nodeLabel || label === stateLabel || value === '') {
        continue;
      }
      const seen = counts.get(label) ?? new Map<string, number>();
      seen.set(value, (seen.get(value) ?? 0) + 1);
      counts.set(label, seen);
    }
  }

  let best: CoverageSuggestion | undefined;
  // Sorted so that two labels covering the same number resolve to the first
  // by name rather than by Map insertion order.
  for (const [label, seen] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const distinct = seen.size;
    // One group per node groups nothing; one group for everything is not a
    // grouping either, and it would win on coverage every single time.
    if (distinct === nodes.length || distinct < 2) {
      continue;
    }
    const covered = [...seen.values()].reduce((sum, n) => sum + n, 0);
    if (covered <= active) {
      continue;
    }
    if (best === undefined || covered > best.covered) {
      best = { label, covered, total: nodes.length };
    }
  }

  return best;
}
```

Add to `packages/core/src/index.ts`:

```ts
export { suggestLabel } from './group/coverage.js';
export type { CoverageInput, CoverageSuggestion } from './group/coverage.js';
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `make test && make typecheck && make lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/group/coverage.ts packages/core/src/index.ts \
        packages/core/test/coverage.test.ts
git commit -m "feat(core): measure whether a label would group better

Relabelling is the rung whose truth serves alerting and every other
dashboard, so the panel should push towards it — without a hidden rule
that switches grouping because someone else edited the scrape.

So it measures instead of advising. A number stops being printed the
moment it stops being true, which is why a correctly configured panel goes
quiet with no special case written for it.

Four labels are never nominated: the node label and any identity in
disguise, which make one group per node; the state label, which changes
between scrapes; and a single-valued label, which would cover everything
and so win every comparison while grouping nothing."
```

---

## Task 5: The warnings strip

**Files:**
- Rename: `plugins/nodegrid-panel/src/utils/unmapped.ts` to `plugins/nodegrid-panel/src/utils/warnings.ts`
- Rename: `plugins/nodegrid-panel/src/utils/unmapped.test.ts` to `plugins/nodegrid-panel/src/utils/warnings.test.ts`
- Modify: `plugins/nodegrid-panel/src/hooks/useNodeModel.ts`, `plugins/nodegrid-panel/src/components/NodeGridPanel.tsx`

**Interfaces:**
- Consumes: `collapseHostlist`, `parseRangeTable`, `declaredKeys`, `suggestLabel`, `UNGROUPED`, `KeySource` from core.
- Produces: `GroupingNotes` and `summarise(model, warnings, unmapped, grouping: GroupingNotes): string[]`; `NodeModel.grouping: GroupingNotes`; `useNodeModel(data, options, replaceVariables)`.

- [ ] **Step 1: Rename the file and its test**

```bash
git mv plugins/nodegrid-panel/src/utils/unmapped.ts plugins/nodegrid-panel/src/utils/warnings.ts
git mv plugins/nodegrid-panel/src/utils/unmapped.test.ts plugins/nodegrid-panel/src/utils/warnings.test.ts
```

Update the import at the top of `warnings.test.ts` to `from './warnings'`, and the import in `NodeGridPanel.tsx` to `from '../utils/warnings'`. Run `make typecheck` and confirm it is clean before going on.

- [ ] **Step 2: Write the failing test**

In `plugins/nodegrid-panel/src/utils/warnings.test.ts`, delete the test named `'warns past the cell threshold and suggests a filter'`, change every `summarise(...)` call's fourth argument from a number to `notes()` defined below, and append this block:

```ts
const notes = (over: Partial<GroupingNotes> = {}): GroupingNotes => ({
  source: { kind: 'none' },
  orphans: [],
  emptyGroups: [],
  problems: [],
  ...over,
});

describe('grouping warnings', () => {
  const model = (nodeCount: number): GroupedModel => ({
    groups: [], nodeCount, slotCount: nodeCount, duplicated: false,
  });

  it('names orphan nodes collapsed back to hostlist syntax', () => {
    const lines = summarise(model(3), [], [], notes({
      source: { kind: 'ranges', table: 'rack1: c[1-2]' },
      orphans: ['c201', 'c202', 'c203'],
    }));
    expect(lines).toContain('3 nodes matched no range: c[201-203]. Drawn under "ungrouped".');
  });

  it('names the cause, which differs by source', () => {
    const line = summarise(model(1), [], [], notes({
      source: { kind: 'label', label: 'rack' }, orphans: ['c1'],
    }))[0];
    expect(line).toContain('1 node carries no "rack" label');
  });

  it('says nothing about orphans when grouping is switched off', () => {
    // Every node is ungrouped on purpose; that is the configuration chosen.
    const lines = summarise(model(2), [], [], notes({ orphans: ['c1', 'c2'] }));
    expect(lines.join(' ')).not.toContain('ungrouped');
  });

  it('names a declared range that matched no node', () => {
    const lines = summarise(model(1), [], [], notes({
      source: { kind: 'ranges', table: 'x: c[1-1]' },
      emptyGroups: [{ name: 'rack7', members: ['c213', 'c214'] }],
    }));
    expect(lines).toContain('Range "rack7" matched no node: c[213-214].');
  });

  it('passes a table problem straight through', () => {
    const lines = summarise(model(1), [], [], notes({
      source: { kind: 'ranges', table: 'bad' },
      problems: ['Line 2 has no "name: hostlist" separator.'],
    }));
    expect(lines).toContain('Line 2 has no "name: hostlist" separator.');
  });

  it('reports a better label as a measurement, not as advice', () => {
    const lines = summarise(model(240), [], [], notes({
      source: { kind: 'chunk', size: 40 },
      suggestion: { label: 'rack', covered: 240, total: 240 },
    }));
    expect(lines).toContain('Label "rack" would group all 240. Grouping > Group by > Label.');
  });

  it('says how many when a better label does not cover everything', () => {
    const lines = summarise(model(240), [], [], notes({
      source: { kind: 'chunk', size: 40 },
      suggestion: { label: 'rack', covered: 228, total: 240 },
    }));
    expect(lines).toContain('Label "rack" would group 228 of 240. Grouping > Group by > Label.');
  });

  it('caps a very long orphan list', () => {
    // The strip clips its overflow, so an unbounded line eats the grid.
    const orphans = Array.from({ length: 20 }, (_, i) => `x${i}y`);
    const line = summarise(model(20), [], [], notes({
      source: { kind: 'ranges', table: 'x: c[1-1]' }, orphans,
    }))[0];
    expect(line).toContain('and 12 more');
  });
});
```

Add `GroupingNotes` to the import at the top of the file, and `GroupedModel` if it is not already imported.

- [ ] **Step 3: Run the test and watch it fail**

Run: `make test`
Expected: FAIL — `GroupingNotes` is not exported and `summarise` still takes a number.

- [ ] **Step 4: Implement**

In `plugins/nodegrid-panel/src/utils/warnings.ts`, replace the import block at the top with:

```ts
import type { DisplayProcessor } from '@grafana/data';
import { collapseHostlist, UNGROUPED } from '@slurm-views/core';
import type { CoverageSuggestion, GroupedModel, IngestWarning, KeySource, SlurmNode } from '@slurm-views/core';
```

Add above `summarise`:

```ts
/**
 * How many hostlist items to name before summarising the rest. The strip
 * clips its overflow, so an unbounded line eats the grid it annotates.
 */
const HOSTLIST_ITEM_LIMIT = 8;

/** Everything the grouping stage could not fully resolve. */
export interface GroupingNotes {
  /** How the panel grouped, so the orphan line can name the cause. */
  source: KeySource;
  /** Nodes the source placed nowhere. */
  orphans: string[];
  /** Declared groups that matched no node, and what they claimed. */
  emptyGroups: Array<{ name: string; members: string[] }>;
  /** Already-worded problems from the range table parser. */
  problems: string[];
  /** A label that would group more nodes than the active source does. */
  suggestion?: CoverageSuggestion;
}

/** Node names as hostlist items, capped: 240 orphans must still fit on a line. */
const listOf = (names: string[]): string => {
  const items = collapseHostlist(names);
  const shown = items.slice(0, HOSTLIST_ITEM_LIMIT);
  const rest = items.length - shown.length;
  return rest > 0 ? `${shown.join(',')} and ${rest} more` : shown.join(',');
};

/**
 * Why these nodes have no group. The condition is identical across sources —
 * the panel could not place them — but the cause is not, and the cause is the
 * only part that tells the operator what to go and fix.
 */
const causeOf = (source: KeySource, plural: boolean): string => {
  switch (source.kind) {
    case 'ranges':
      return 'matched no range';
    case 'label':
      return `${plural ? 'carry' : 'carries'} no "${source.label}" label`;
    case 'capture':
      return 'did not match the capture pattern';
    case 'chunk':
      return `${plural ? 'have' : 'has'} no number in ${plural ? 'their names' : 'its name'} to chunk by`;
    default:
      return 'could not be placed';
  }
};
```

Change the signature: replace the `maxCells: number` parameter with `grouping: GroupingNotes`, delete the whole `if (model.slotCount > maxCells)` block, and insert before `return lines;`:

```ts
  // `none` puts every node in `ungrouped` deliberately. Warning about it would
  // be warning about the configuration the operator chose.
  if (grouping.source.kind !== 'none' && grouping.orphans.length > 0) {
    const n = grouping.orphans.length;
    lines.push(
      `${n} ${n === 1 ? 'node' : 'nodes'} ${causeOf(grouping.source, n !== 1)}: ${listOf(grouping.orphans)}. Drawn under "${UNGROUPED}".`
    );
  }

  // The opposite problem: a box with no nodes rather than nodes with no box.
  // A cluster mid-recabling shows both, and they must read separately.
  for (const group of grouping.emptyGroups) {
    lines.push(`Range "${group.name}" matched no node: ${listOf(group.members)}.`);
  }

  lines.push(...grouping.problems);

  if (grouping.suggestion !== undefined) {
    const { label, covered, total } = grouping.suggestion;
    lines.push(
      covered === total
        ? `Label "${label}" would group all ${total}. Grouping > Group by > Label.`
        : `Label "${label}" would group ${covered} of ${total}. Grouping > Group by > Label.`
    );
  }
```

- [ ] **Step 5: Build the notes in the model hook**

Replace `plugins/nodegrid-panel/src/hooks/useNodeModel.ts` in full:

```ts
import { useMemo } from 'react';
import { FieldType } from '@grafana/data';
import type { DataFrame, Field, InterpolateFunction, PanelData } from '@grafana/data';
import { buildGroups, declaredKeys, ingest, parseRangeTable, suggestLabel, UNGROUPED } from '@slurm-views/core';
import type { GroupedModel, IngestWarning, KeySource, MinimalFrame } from '@slurm-views/core';
import type { GroupingNotes } from '../utils/warnings';
import type { PanelOptions } from '../types';

/** DataFrame -> the structural shape core accepts, without core importing Grafana. */
const toMinimal = (frame: DataFrame): MinimalFrame => ({
  refId: frame.refId,
  fields: frame.fields.map((f) => ({
    name: f.name,
    type: f.type,
    labels: f.labels,
    values: f.values,
  })),
});

export interface NodeModel {
  model: GroupedModel;
  warnings: IngestWarning[];
  /** The field the state colour is resolved against. */
  stateField: Field | undefined;
  grouping: GroupingNotes;
}

export function useNodeModel(
  data: PanelData,
  options: PanelOptions,
  replaceVariables: InterpolateFunction
): NodeModel {
  return useMemo(() => {
    const frames = data.series.map(toMinimal);
    const { nodes, warnings } = ingest({ frames, slots: options.slots, labels: options.labels });

    // Interpolated once, here, so the key function, the declared order and the
    // warning lines all read the same table. Grafana documents
    // `replaceVariables` for exactly this: a user-defined template string the
    // panel then processes.
    const source: KeySource =
      options.grouping.kind === 'ranges'
        ? { kind: 'ranges', table: replaceVariables(options.grouping.table) }
        : options.grouping;

    const model = buildGroups(nodes, source, {
      multiValueLabel: options.multiValueLabel,
      order: declaredKeys(source),
    });

    const table = source.kind === 'ranges' ? parseRangeTable(source.table) : undefined;
    const claimed = new Map((table?.groups ?? []).map((g) => [g.name, g.members]));

    const grouping: GroupingNotes = {
      source,
      orphans: model.groups.find((g) => g.key === UNGROUPED)?.nodes.map((n) => n.name) ?? [],
      emptyGroups: model.groups
        .filter((g) => g.nodes.length === 0)
        .map((g) => ({ name: g.key, members: claimed.get(g.key) ?? [] })),
      problems: (table?.problems ?? []).map((p) => p.detail),
      suggestion: suggestLabel({
        nodes,
        source,
        nodeLabel: options.labels.node,
        stateLabel: options.labels.state,
      }),
    };

    const stateFrame = data.series.find((f) => f.refId === options.slots.state);
    const stateField =
      stateFrame?.fields.find((f) => f.name === options.labels.state) ??
      stateFrame?.fields.find((f) => f.type === FieldType.string);

    return { model, warnings, stateField, grouping };
  }, [data.series, options, replaceVariables]);
}
```

- [ ] **Step 6: Wire the panel**

In `plugins/nodegrid-panel/src/components/NodeGridPanel.tsx`:

1. add `replaceVariables` to the destructured props;
2. change the hook call to `useNodeModel(data, options, replaceVariables)`;
3. destructure `grouping` from its result;
4. change the `summarise` call to:

```tsx
  const lines = useMemo(
    () => summarise(model, warnings, unmapped, grouping),
    [model, warnings, unmapped, grouping]
  );
```

- [ ] **Step 7: Run everything and watch it pass**

Run: `make check`
Expected: PASS — lint, typecheck, tests and build all green.

- [ ] **Step 8: Commit**

```bash
git add plugins/nodegrid-panel/src
git commit -m "feat(panel): name what the grouping stage could not resolve

Three conditions reach the strip, and they are different problems that a
cluster mid-recabling shows at the same time: nodes with no box, a
declared box with no nodes, and a label that would group better than the
source in use. Each gets its own line.

The orphan line names the cause rather than the symptom, because the cause
is the part that says what to go and fix, and it differs by source: no
range matched, no such label, no capture, no number to chunk by. With
grouping switched off it says nothing at all, since every node is
ungrouped because that is the configuration chosen.

Node names are collapsed back to hostlist syntax and capped, so 240
orphans stay one line in a strip that clips its overflow.

utils/unmapped.ts is renamed to utils/warnings.ts: it stopped being about
value mappings alone."
```

---

## Task 6: Drawing what could not be resolved

**Files:**
- Modify: `plugins/nodegrid-panel/src/components/GroupHeader.tsx`, `NodeGroup.tsx`, `RackFrame.tsx`, `RackFrame.test.tsx`
- Test: `plugins/nodegrid-panel/src/components/NodeGroup.test.tsx`

**Interfaces:**
- Consumes: `UNGROUPED`, `PanelOptions.grouping`.
- Produces: `GroupHeader` prop `unplaced: boolean`; `RackFrame` props `cellWidth: number` and `dashed?: boolean`; `data-unplaced` and `data-empty` attributes on the group element.

- [ ] **Step 1: Write the failing test**

Append to `plugins/nodegrid-panel/src/components/NodeGroup.test.tsx`, reusing the render helper and node factory the existing tests in that file already define:

```tsx
describe('groups the panel could not resolve', () => {
  const ungrouped = { key: 'ungrouped', nodes: [mkNode('c1')], assumed: false };
  const empty = { key: 'rack7', nodes: [], assumed: false };
  const ranges = { kind: 'ranges', table: 'rack7: c[99-99]' } as const;

  it('marks an ungrouped group as unplaced when a source was chosen', () => {
    renderGroup(ungrouped, { ...DEFAULT_OPTIONS, grouping: ranges });
    expect(screen.getByTestId('node-group-ungrouped')).toHaveAttribute('data-unplaced', 'true');
    expect(screen.getByText('unplaced')).toBeInTheDocument();
  });

  it('does not mark it when grouping is switched off', () => {
    // Everything is ungrouped on purpose; admitting to it would be noise.
    renderGroup(ungrouped, { ...DEFAULT_OPTIONS, grouping: { kind: 'none' } });
    expect(screen.getByTestId('node-group-ungrouped')).toHaveAttribute('data-unplaced', 'false');
    expect(screen.queryByText('unplaced')).not.toBeInTheDocument();
  });

  it('keeps unplaced distinct from assumed, because they admit different things', () => {
    renderGroup({ key: 'chunk 1', nodes: [mkNode('c1')], assumed: true }, DEFAULT_OPTIONS);
    expect(screen.getByText('assumed')).toBeInTheDocument();
    expect(screen.queryByText('unplaced')).not.toBeInTheDocument();
  });

  it('draws a declared group that matched no node, rather than dropping it', () => {
    renderGroup(empty, { ...DEFAULT_OPTIONS, grouping: ranges });
    const group = screen.getByTestId('node-group-rack7');
    expect(group).toHaveAttribute('data-empty', 'true');
    expect(screen.getByText('0 nodes')).toBeInTheDocument();
  });
});
```

If the file does not already have `renderGroup` and `mkNode` helpers, extract them from its existing tests first, in a separate commit, so this task's diff stays about one thing.

- [ ] **Step 2: Run the test and watch it fail**

Run: `make test`
Expected: FAIL — no `data-unplaced` attribute, no `unplaced` text.

- [ ] **Step 3: Implement the header marker**

In `plugins/nodegrid-panel/src/components/GroupHeader.tsx`, add the style:

```ts
  unplaced: css({ color: theme.colors.error.text, fontStyle: 'italic' }),
```

and change the component:

```tsx
export function GroupHeader({ group, unplaced }: { group: NodeGroupModel; unplaced: boolean }) {
  const theme = useTheme2();
  const styles = getStyles(theme);
  return (
    <div className={styles.header}>
      <span className={styles.name}>{group.key}</span>
      <span className={styles.count}>{group.nodes.length} nodes</span>
      {/* Chunking invents structure. The claim stays visible in the panel,
          not only in the editor. */}
      {group.assumed && <span className={styles.assumed}>assumed</span>}
      {/* A different admission, and so a different word: `assumed` means the
          group was invented, `unplaced` means these nodes found no group. */}
      {unplaced && <span className={styles.unplaced}>unplaced</span>}
    </div>
  );
}
```

- [ ] **Step 4: Implement the dashed frame**

Replace the styles and component in `plugins/nodegrid-panel/src/components/RackFrame.tsx`:

```tsx
const getStyles = (theme: GrafanaTheme2, width: number, dashed: boolean) => ({
  // column-reverse so slot 1 sits at the bottom, the way a rack is read.
  rack: css({
    display: 'flex',
    flexDirection: 'column-reverse',
    flexWrap: 'nowrap',
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
  /** The cell width the cabinet is sized from. */
  cellWidth: number;
  dashed?: boolean;
}

export function RackFrame({ children, cellWidth, dashed = false }: RackFrameProps) {
  const theme = useTheme2();
  const styles = getStyles(theme, rackWidthFor(cellWidth), dashed);
  return (
    <div className={styles.rack} data-testid="rack-frame" data-dashed={dashed}>
      {children}
    </div>
  );
}
```

In `RackFrame.test.tsx`, change both renders from `cellSize={N}` to `cellWidth={N}`.

- [ ] **Step 5: Implement the group**

In `plugins/nodegrid-panel/src/components/NodeGroup.tsx`, import `UNGROUPED` from `@slurm-views/core`, add the style:

```ts
  unresolved: css({
    border: `1px dashed ${theme.colors.border.medium}`,
    padding: theme.spacing(0.5),
    minHeight: theme.spacing(3),
  }),
```

and rewrite the body:

```tsx
  // With grouping switched off every node is ungrouped on purpose, so the
  // panel has nothing to admit to.
  const unplaced = group.key === UNGROUPED && options.grouping.kind !== 'none';
  const empty = group.nodes.length === 0;
  const unresolved = unplaced || empty;

  const cells = group.nodes.map((node) => (
    <NodeCell
      key={node.name}
      node={node}
      size={options.cellSize}
      stateDisplay={stateDisplay}
      valueDisplay={valueDisplay}
      colorMode={colorMode}
      shapeChannel={options.shapeChannel}
      href={hrefFor(node)}
      sled={options.layout === 'rack'}
    />
  ));

  return (
    <div
      className={styles.group}
      data-testid={`node-group-${group.key}`}
      data-layout={options.layout}
      data-unplaced={unplaced}
      data-empty={empty}
    >
      <GroupHeader group={group} unplaced={unplaced} />
      {options.layout === 'rack' ? (
        <RackFrame cellWidth={options.cellSize} dashed={unresolved}>{cells}</RackFrame>
      ) : (
        // A dashed box round what the panel did not resolve, the same idiom as
        // the hollow ring on a state with no value mapping.
        <div className={unresolved ? `${styles.wrap} ${styles.unresolved}` : styles.wrap}>{cells}</div>
      )}
    </div>
  );
```

`options.cellSize` is still referenced here on purpose. Task 8 replaces it; leaving
it alone keeps this task's diff about one thing.

- [ ] **Step 6: Run the tests and watch them pass**

Run: `make check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add plugins/nodegrid-panel/src/components
git commit -m "feat(panel): draw the groups it could not resolve, rather than hiding them

A node missing from a supervision view is a worse failure than a node in
the wrong box, so orphans stay on screen: last, behind a dashed frame, and
under a header that says unplaced.

That word is deliberately not assumed. Assumed means the group was
invented from an ordinal; unplaced means these nodes matched nothing. Two
different admissions read as two different words.

A declared range that matched no node is drawn too, empty and in its
declared place. An empty rack in a machine room is information, and the
warnings strip says which of the two readings applies."
```

---

## Task 7: Ranges in the editor, and the dashboard variable

**Files:**
- Modify: `plugins/nodegrid-panel/src/editor/GroupingEditor.tsx`, `plugins/nodegrid-panel/src/module.ts`
- Test: `plugins/nodegrid-panel/src/editor/GroupingEditor.test.tsx`

**Interfaces:**
- Consumes: the `ranges` key source from Task 2.
- Produces: the `Ranges` radio option and its textarea; the editor preview interpolates through `getTemplateSrv()`.

- [ ] **Step 1: Write the failing test**

Append to `plugins/nodegrid-panel/src/editor/GroupingEditor.test.tsx`, reusing the file's existing `renderEditor` helper and frame fixtures:

```tsx
describe('the Ranges source', () => {
  it('offers Ranges and seeds a table that shows the syntax', async () => {
    const onChange = jest.fn();
    renderEditor({ kind: 'none' }, onChange);
    await userEvent.click(screen.getByText('Ranges'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ranges', table: expect.stringContaining(':') })
    );
  });

  it('edits the table', async () => {
    const onChange = jest.fn();
    renderEditor({ kind: 'ranges', table: 'rack1: c[1-2]' }, onChange);
    const box = screen.getByRole('textbox');
    await userEvent.clear(box);
    await userEvent.type(box, 'x: c1');
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'ranges', table: 'x: c1' });
  });

  it('previews the placement the table would produce', () => {
    renderEditor({ kind: 'ranges', table: 'rack1: c[1-2]' }, jest.fn());
    expect(screen.getByTestId('grouping-preview')).toHaveTextContent('rack1');
  });
});
```

If the fixtures in that file do not contain nodes named `c1` and `c2`, change the table in the third test to name the nodes they do contain.

- [ ] **Step 2: Run the test and watch it fail**

Run: `make test`
Expected: FAIL — there is no `Ranges` option to click.

- [ ] **Step 3: Implement**

In `plugins/nodegrid-panel/src/editor/GroupingEditor.tsx`:

1. add `TextArea` to the `@grafana/ui` import, and add `import { getTemplateSrv } from '@grafana/runtime';`
2. add the constant above the component:

```ts
/**
 * The seed table. It names its own syntax, because the first thing an operator
 * does with a new source is look at what is already in the box.
 */
const SAMPLE_TABLE = '# name: hostlist - one line per group, in display order\nrack1: c[1-40]';
```

3. interpolate inside the preview memo, before building the key function:

```ts
    // The panel gets `replaceVariables` on PanelProps; an options editor does
    // not, so it asks the same service directly. Without this the preview
    // reads "$racks" literally and claims the table matches nothing.
    const resolved: KeySource =
      source.kind === 'ranges' ? { kind: 'ranges', table: getTemplateSrv().replace(source.table) } : source;
    const keyFn = makeKeyFn(resolved);
```

4. add the radio option after `chunk`:

```tsx
          { value: 'ranges', label: 'Ranges' },
```

5. add its branch to the `onChange` handler, before the final `else`:

```ts
          } else if (kind === 'ranges') {
            onChange({ kind, table: SAMPLE_TABLE });
```

6. add the field after the `chunk` block:

```tsx
      {source.kind === 'ranges' && (
        <Field
          label="Ranges"
          description="One line per group: a name, a colon, then a Slurm hostlist. # comments to end of line. Line order is display order. May be a dashboard variable."
        >
          <TextArea
            rows={8}
            value={source.table}
            onChange={(e) => onChange({ kind: 'ranges', table: e.currentTarget.value })}
          />
        </Field>
      )}
```

- [ ] **Step 4: Update the option description**

In `plugins/nodegrid-panel/src/module.ts`, change the `grouping` custom editor's description to:

```ts
        description: 'A label, a capture on the node name, a declared range table, or a chunk of its ordinal.',
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `make check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/nodegrid-panel/src/editor plugins/nodegrid-panel/src/module.ts
git commit -m "feat(panel): edit the range table in the grouping editor

A textarea seeded with a table that names its own syntax, because the
first thing anyone does with a new source is read what is already in the
box.

The preview resolves template variables before running the key function.
It has to ask the template service directly, since replaceVariables is on
PanelProps and an options editor never sees it, and without that the
preview reads the variable literally and reports that the table matches
nothing."
```

---

## Task 8: Cell width and cell height, and the end of `maxCells`

**Files:**
- Modify: `plugins/nodegrid-panel/src/types.ts`, `module.ts`, `components/rackGeometry.ts`, `NodeCell.tsx`, `NodeGroup.tsx`, `NodeGroup.test.tsx`, `dev/provisioning/dashboards/*.json`
- Test: `plugins/nodegrid-panel/src/components/rackGeometry.test.ts`

**Interfaces:**
- Consumes: `sledHeightFor`, `rackWidthFor`, `RackFrame`'s `cellWidth` prop from Task 6.
- Produces: `resolveCellSize(options): { width: number; height: number }`; `PanelOptions.cellWidth: number`, `PanelOptions.cellHeight?: number`; `NodeCell` props `width` and `height`.

- [ ] **Step 1: Write the failing test**

Append to `plugins/nodegrid-panel/src/components/rackGeometry.test.ts`, adding `resolveCellSize` to the existing import from `./rackGeometry` and importing `DEFAULT_OPTIONS` from `../types`:

```ts
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

  it('uses an explicit height in either layout', () => {
    expect(resolveCellSize({ ...DEFAULT_OPTIONS, layout: 'rack', cellWidth: 30, cellHeight: 4 }))
      .toEqual({ width: 30, height: 4 });
    expect(resolveCellSize({ ...DEFAULT_OPTIONS, layout: 'wrap', cellWidth: 30, cellHeight: 4 }))
      .toEqual({ width: 30, height: 4 });
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `make test`
Expected: FAIL — `resolveCellSize` does not exist.

- [ ] **Step 3: Change the options**

In `plugins/nodegrid-panel/src/types.ts`, remove `cellSize` and `maxCells` from `PanelOptions` and add:

```ts
  /** Cell width in pixels. */
  cellWidth: number;
  /**
   * Cell height in pixels. Optional on purpose: the two layouts disagree about
   * the natural shape of a cell, so an unset height derives what that layout
   * already drew — a square in Wrap, a sled in Rack.
   */
  cellHeight?: number;
```

In `DEFAULT_OPTIONS`, replace the `cellSize` and `maxCells` entries with:

```ts
  // 10px is the honest floor: below it a notch stops being legible and a cell
  // stops being a usable hover target.
  cellWidth: 14,
  // cellHeight is deliberately absent. See the type.
```

- [ ] **Step 4: Implement the resolver**

In `plugins/nodegrid-panel/src/components/rackGeometry.ts`, add at the top:

```ts
import { DEFAULT_OPTIONS } from '../types';
import type { PanelOptions } from '../types';
```

and at the bottom:

```ts
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
export function resolveCellSize(options: Pick<PanelOptions, 'cellWidth' | 'cellHeight' | 'layout'>): CellSize {
  const width = options.cellWidth ?? DEFAULT_OPTIONS.cellWidth;
  const height = options.cellHeight ?? (options.layout === 'rack' ? sledHeightFor(width) : width);
  return { width, height };
}
```

- [ ] **Step 5: Thread it through the components**

In `NodeCell.tsx`, replace the `size: number` prop with `width: number` and `height: number`, and use each wherever `size` fed the cell's width and height respectively.

In `NodeGroup.tsx`, import `resolveCellSize` from `./rackGeometry`, add `const cell = resolveCellSize(options);` beside the other derivations, and replace the three uses:

```tsx
      width={cell.width}
      height={cell.height}
```

```tsx
        <RackFrame cellWidth={cell.width} dashed={unresolved}>{cells}</RackFrame>
```

In `NodeGroup.test.tsx`, change the two assertions that reference `DEFAULT_OPTIONS.cellSize` to use `resolveCellSize(DEFAULT_OPTIONS)`.

- [ ] **Step 6: Change the editor**

In `plugins/nodegrid-panel/src/module.ts`, delete the `maxCells` `addNumberInput` block entirely, and replace the `cellSize` slider with:

```ts
      .addSliderInput({
        path: 'cellWidth',
        name: 'Cell width',
        description: 'Below 10px a cell stops being a usable hover target.',
        defaultValue: DEFAULT_OPTIONS.cellWidth,
        settings: { min: 6, max: 48, step: 1 },
        category: ['Layout'],
      })
      .addNumberInput({
        path: 'cellHeight',
        name: 'Cell height',
        description: 'Leave empty to derive it: a square in Wrap, a sled in Rack.',
        settings: { placeholder: 'auto', min: 3, max: 48 },
        category: ['Layout'],
      })
```

- [ ] **Step 7: Update the provisioned dashboards**

In all four files under `dev/provisioning/dashboards/`, rename every `"cellSize": N` to `"cellWidth": N` and delete every `"maxCells": 3000` line, keeping the JSON valid — the property before a deleted last entry must lose its trailing comma. Bump each dashboard's `version` by one.

Verify with:

```bash
make up
make logs-once 2>&1 | grep -i "dashboard" | grep -iv "provisioned\|inserted" || echo "no dashboard errors"
```

- [ ] **Step 8: Run everything and watch it pass**

Run: `make check && make e2e`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add plugins/nodegrid-panel/src dev/provisioning/dashboards
git commit -m "feat(panel): size a cell in two dimensions, and drop the cell warning

A node is a 1U sled, wider than tall, and the code already conceded it
privately by deriving the rack's proportions from one number. Stating both
dimensions makes that explicit and lets a rack column read the way a rack
does.

Both options are optional, which is what keeps the change invisible to
anyone who has configured nothing: the two layouts disagree about the
natural shape of a cell, so a fixed default height would double the sled
in Rack or flatten every cell in Wrap. Unset, each layout keeps deriving
what it already drew.

maxCells goes with it. It warned about the one property of the panel that
is impossible to miss, and it was an option, so it asked the operator to
configure the threshold at which they would be told what was already in
front of them."
```

---

## Task 9: The relabel generator, and the dev stack that uses it

**Files:**
- Create: `dev/relabel/racks.txt`, `dev/relabel/generate.mjs`, `tests/contract/relabel.test.cjs`
- Modify: `dev/prometheus/prometheus.yml`, `Makefile`, `.gitignore`

**Interfaces:**
- Consumes: `parseRangeTable` from `packages/core/dist/index.js` (built by `make build`).
- Produces: `node dev/relabel/generate.mjs <table> <job> <target>` printing a Prometheus scrape config on stdout.

- [ ] **Step 1: Create the dev cluster's table**

Create `dev/relabel/racks.txt`:

```
# The dev cluster's floor plan.
#
# This file is the input to two rungs at once: dev/relabel/generate.mjs turns
# it into the Prometheus relabelling that gives the stack a real rack label,
# and the same text pastes into the panel's Grouping > Ranges option. That is
# the whole claim, one table and two destinations, and
# tests/contract/relabel.test.cjs is what keeps it true.

rack1: c[1-5]
rack2: c[6-10]
gpu:   g[1-10]
```

- [ ] **Step 2: Write the failing contract test**

Create `tests/contract/relabel.test.cjs`:

```js
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');
const GENERATE = path.join(ROOT, 'dev', 'relabel', 'generate.mjs');
const TABLE = path.join(ROOT, 'dev', 'relabel', 'racks.txt');
const CORE = pathToFileURL(path.join(ROOT, 'packages', 'core', 'dist', 'index.js')).href;

const run = () =>
  execFileSync('node', [GENERATE, TABLE, 'slurm_exporter', 'synthetic-exporter:9341'], { encoding: 'utf8' });

describe('the generated relabel config', () => {
  it('emits one rule per declared group', () => {
    const out = run();
    expect(out).toContain('metric_relabel_configs');
    expect(out).toContain('target_label: rack');
  });

  it('agrees with the panel about every node', async () => {
    // The whole reason the generator exists. A table has two destinations, and
    // the claim only holds if both classify a node the same way. This fails if
    // emission mis-escapes a character or drops a zero padding.
    const { parseRangeTable } = await import(CORE);
    const table = parseRangeTable(fs.readFileSync(TABLE, 'utf8'));

    const rules = [...run().matchAll(/regex:\s*(\S+)[\s\S]*?replacement:\s*(\S+)/g)].map(
      ([, regex, replacement]) => ({ regex: new RegExp(`^(?:${regex})$`), group: replacement })
    );

    expect(rules.length).toBe(table.groups.length);

    for (const [node, group] of table.index) {
      const matched = rules.filter((rule) => rule.regex.test(node));
      expect(matched.map((m) => m.group)).toEqual([group]);
    }
  });

  it('writes a regex Prometheus reads the same way, not a hostlist', () => {
    // c[1-40] in RE2 means "c then one of 1, 2, 3, 4, 0" - right by accident on
    // c[1-5] and silently wrong from c[1-10] on. Expanded alternation is the
    // only correct emission.
    expect(run()).not.toMatch(/regex:.*\[\d+-\d+\]/);
  });
});
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `make build && make test`
Expected: FAIL — `dev/relabel/generate.mjs` does not exist.

- [ ] **Step 4: Implement the generator**

Create `dev/relabel/generate.mjs`:

```js
#!/usr/bin/env node
/**
 * A range table -> a Prometheus scrape config that attaches `rack` at scrape
 * time.
 *
 * It owns no grammar. The expansion comes from the same parser the panel uses,
 * because the claim this repository makes about the range table - one format,
 * two destinations - does not survive two implementations of it drifting
 * apart.
 *
 * Usage: node dev/relabel/generate.mjs <table-file> <job-name> <target>
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CORE = pathToFileURL(
  path.resolve(import.meta.dirname, '..', '..', 'packages', 'core', 'dist', 'index.js')
).href;
const { parseRangeTable } = await import(CORE);

const [tableFile, job, target] = process.argv.slice(2);
if (tableFile === undefined || job === undefined || target === undefined) {
  console.error('usage: generate.mjs <table-file> <job-name> <target>');
  process.exit(2);
}

const table = parseRangeTable(readFileSync(tableFile, 'utf8'));
for (const problem of table.problems) {
  console.error(`${tableFile}: ${problem.detail}`);
}
if (table.problems.length > 0) {
  process.exit(1);
}

/**
 * A node name, made safe inside a Prometheus regex.
 *
 * Prometheus compiles `regex` as RE2 and anchors it, so the alternation has to
 * be expanded: `c[1-40]` there does not mean c1 through c40, it means "c
 * followed by one of 1, 2, 3, 4, 0". It is right by accident on `c[1-5]` and
 * silently wrong from `c[1-10]` onward, which is the reason this file exists
 * rather than a paragraph of documentation.
 */
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const rules = table.groups
  .filter((group) => group.members.length > 0)
  .map((group) =>
    [
      '      - source_labels: [node]',
      `        regex: ${group.members.map(escape).join('|')}`,
      '        target_label: rack',
      `        replacement: ${group.name}`,
    ].join('\n')
  );

process.stdout.write(
  [
    `# Generated from ${path.basename(tableFile)} by dev/relabel/generate.mjs. Do not edit.`,
    'scrape_configs:',
    `  - job_name: ${job}`,
    '    static_configs:',
    `      - targets: ['${target}']`,
    '    metric_relabel_configs:',
    ...rules,
    '',
  ].join('\n')
);
```

- [ ] **Step 5: Point Prometheus at the generated file**

Replace `dev/prometheus/prometheus.yml` with:

```yaml
global:
  scrape_interval: 15s

# The node scrape lives in a generated file so the dev stack can demonstrate
# rung 1 at all. The synthetic exporter publishes no rack label by design,
# because the real slurm_exporter cannot: sinfo has no concept of one.
# dev/relabel/generate.mjs turns dev/relabel/racks.txt into that file, and the
# Makefile regenerates it before every `make up`.
scrape_config_files:
  - /etc/prometheus/scrape/*.yml
```

Check `dev/docker-compose.yml`: the Prometheus service must mount `./prometheus` (the directory), not only `./prometheus/prometheus.yml`, so that `scrape/` is visible at `/etc/prometheus/scrape`. Adjust the mount if it names the single file.

- [ ] **Step 6: Generate it from the Makefile**

Add above the `up` target:

```make
scrape: build ## Generate the Prometheus scrape config from dev/relabel/racks.txt
	@# Running the generator here is what keeps it from being dead code: it is
	@# exercised on every `make up` rather than illustrated in a README, and it
	@# is what lets the dev stack demonstrate the rung it recommends first.
	@mkdir -p dev/prometheus/scrape
	$(RUN) node dev/relabel/generate.mjs dev/relabel/racks.txt slurm_exporter synthetic-exporter:9341 \
	  > dev/prometheus/scrape/nodes.yml
```

Change the `up` target's dependency from `build` to `scrape`, and add `scrape` to the `.PHONY` list.

Add to `.gitignore`:

```
# Generated by `make scrape` from dev/relabel/racks.txt.
dev/prometheus/scrape/
```

- [ ] **Step 7: Run everything and watch it pass**

Run: `make check && make up`

Then confirm Prometheus actually applied the label:

```bash
curl -sf 'http://localhost:9091/api/v1/query?query=count(slurm_node_status)by(rack)' \
  | jq -r '.data.result[] | "\(.metric.rack) \(.value[1])"' | sort
```

Expected: exactly three lines — `gpu 10`, `rack1 5`, `rack2 5`.

- [ ] **Step 8: Commit**

```bash
git add dev/relabel tests/contract/relabel.test.cjs dev/prometheus Makefile .gitignore dev/docker-compose.yml
git commit -m "feat(dev): generate the relabelling that gives the stack a rack label

The synthetic exporter publishes no rack label by design, because the real
exporter cannot, so until now the dev stack could not demonstrate the rung
it recommends first. Prometheus loads a generated scrape config, and make
up regenerates it from dev/relabel/racks.txt.

The generator owns no grammar. It expands through the same parser the
panel uses, because one table with two destinations does not survive two
implementations drifting apart, and a contract test asserts that both
classify every node identically.

Expanded alternation is not a style choice. Prometheus compiles regex as
RE2, where c[1-40] means c followed by one of 1, 2, 3, 4, 0 - right by
accident on c[1-5] and silently wrong from c[1-10] on."
```

---

## Task 10: Prove rung 2, and show all three

**Files:**
- Modify: `dev/provisioning/dashboards/slurm-node-grouping.json`, `plugins/nodegrid-panel/tests/nodegrid.spec.ts`
- Modify: `dev/README.md` (the transformation chain this task discovers)

**Interfaces:**
- Consumes: the dev stack from Task 9 (the `rack` label now exists), the `ranges` source from Task 7.
- Produces: a provisioned dashboard with one panel per rung, and an e2e assertion for each.

- [ ] **Step 1: Extend the grouping dashboard**

In `dev/provisioning/dashboards/slurm-node-grouping.json`, keep the existing panels and add three, each with a `description` naming its rung:

1. **Rung 1 — label.** Prometheus datasource, query `slurm_node_status`, `"grouping": { "kind": "label", "label": "rack" }`.
2. **Rung 2 — join.** Query `A` against Prometheus (`slurm_node_status`); query `B` against the `slurm-views-testdata` datasource with `"scenarioId": "csv_content"` and this `csvContent`:

```
node,rack
c1,rack1
c2,rack1
c3,rack1
c4,rack1
c5,rack1
c6,rack2
c7,rack2
c8,rack2
c9,rack2
c10,rack2
g1,gpu
g2,gpu
g3,gpu
g4,gpu
g5,gpu
g6,gpu
g7,gpu
g8,gpu
g9,gpu
g10,gpu
```

   plus `transformations`: `labelsToFields` (keeping `node` and `status`), then `joinByField` with `byField: "node"` and `mode: "outer"`. Grouping: `{ "kind": "label", "label": "rack" }`.
3. **Rung 3 — ranges.** Prometheus datasource, query `slurm_node_status`, `"grouping": { "kind": "ranges", "table": "$racks" }`, plus a dashboard variable:

```json
{
  "name": "racks",
  "type": "constant",
  "hide": 2,
  "query": "rack1: c[1-5]\nrack2: c[6-10]\ngpu: g[1-10]",
  "current": { "text": "", "value": "rack1: c[1-5]\nrack2: c[6-10]\ngpu: g[1-10]" }
}
```

Bump the dashboard's `version`.

- [ ] **Step 2: Bring the stack up and verify rung 2 by hand**

Run: `make up`, then open `http://localhost:3001` and check that all three panels draw three groups named `rack1`, `rack2` and `gpu`.

**This is the verification the spec recorded as unproven.** If rung 2 does not work: read the panel's warnings strip, open **Panel ▸ Inspect ▸ Data** to see the frame the panel actually receives, and adjust the transformation chain until a `rack` column reaches it. The likely adjustments, in order of probability: `labelsToFields` needs `mode: "columns"`; `joinByField` needs the Prometheus frame converted to a table first; the `node` field may arrive with a different name after `labelsToFields`.

Whatever chain turns out to work is the deliverable of this step. Write it down verbatim in `dev/README.md` as part of this task's commit — it is the recipe every catalogue user without Prometheus access will follow, and it must not have to be rediscovered.

- [ ] **Step 3: Write the failing e2e test**

Append to `plugins/nodegrid-panel/tests/nodegrid.spec.ts`:

```ts
test.describe('the three ways to get a topology', () => {
  const groups = ['rack1', 'rack2', 'gpu'];

  test('rung 1 groups by a relabelled Prometheus label', async ({ page }) => {
    await page.goto('/d/slurm-node-grouping/grouping?viewPanel=10');
    for (const key of groups) {
      await expect(page.getByTestId(`node-group-${key}`)).toBeVisible();
    }
  });

  test('rung 2 groups by a column joined onto the frame', async ({ page }) => {
    // The Grafana-native answer when the data lacks the dimension the view
    // needs, and the only rung available without Prometheus access.
    await page.goto('/d/slurm-node-grouping/grouping?viewPanel=11');
    for (const key of groups) {
      await expect(page.getByTestId(`node-group-${key}`)).toBeVisible();
    }
  });

  test('rung 3 groups by a range table held in a dashboard variable', async ({ page }) => {
    await page.goto('/d/slurm-node-grouping/grouping?viewPanel=12');
    for (const key of groups) {
      await expect(page.getByTestId(`node-group-${key}`)).toBeVisible();
    }
    // Interpolation is the part that fails silently: an uninterpolated
    // "$racks" parses as one bad line and places no node at all.
    await expect(page.getByTestId('node-group-ungrouped')).toHaveCount(0);
  });
});
```

Set the `viewPanel` ids and the dashboard uid and slug in the URLs to match what the JSON actually contains.

- [ ] **Step 4: Run the e2e suite and watch it pass**

Run: `make e2e`
Expected: PASS — three new tests green alongside the existing ten.

- [ ] **Step 5: Commit**

```bash
git add dev/provisioning/dashboards/slurm-node-grouping.json \
        plugins/nodegrid-panel/tests/nodegrid.spec.ts dev/README.md
git commit -m "test(dev): demonstrate all three routes to a topology, and prove them

One panel per rung against the same data: a relabelled Prometheus label, a
column joined onto the frame by a transformation, and a range table held
in a dashboard variable.

The join chain was believed to work and had never been run. It is now
provisioned, asserted, and written down in dev/README.md, which matters
because it is the only rung available to someone reading a Prometheus they
do not administer.

The range panel also asserts that nothing lands in ungrouped, since
interpolation is the part that fails silently: an uninterpolated variable
parses as one bad line and places no node at all."
```

---

## Task 11: Documentation

**Files:**
- Create: `docs/grouping.md`
- Modify: `plugins/nodegrid-panel/src/README.md`, `dev/README.md`, `docs/value-mappings.md`

**Interfaces:**
- Consumes: everything above, including the working transformation chain recorded in Task 10.
- Produces: no code.

- [ ] **Step 1: Write the repository document**

Create `docs/grouping.md` with these sections, in this order:

1. **Why there is no rack label.** `slurm_exporter` reads `sinfo`, which has no concept of one, so no amount of configuration produces one. Transcribe the real label sets from `docs/metrics.md`: `slurm_node_status` and the cpu/mem series carry `node, status, partition`; the gres series add `gres_type`; `drain_reason_info` carries `node, reason`; `drain_since_timestamp_seconds` carries `node`.
2. **The three rungs**, one section each, in the spec's order, each stating the privilege it needs and its trade-off.
3. **The hostlist syntax**, with the seven rules from the spec and a worked example.
4. **Why a range table is a panel option when a colour editor was not.** Grafana has a native store for colour and none for topology, so this duplicates nothing; the dashboard variable answers the per-dashboard objection.
5. **The generator**, its usage line, and its documented cost: one rule per rack evaluated per sample, which on 200 racks and 18,000 series is 3.6M regex evaluations per scrape — and why that is itself an argument for rung 3 at that size.

- [ ] **Step 2: Rewrite the panel's Grouping section**

In `plugins/nodegrid-panel/src/README.md` — the file that ships in `dist/` and is what Grafana shows in its catalogue — replace the **Grouping** section so it covers:

- the four sources: Label, Capture, **Ranges**, Chunk;
- for Ranges: the syntax, one worked example, that line order is display order, and that the value may be a dashboard variable;
- that a node matching nothing is drawn under `ungrouped`, last, dashed and marked `unplaced`, and named in the warnings strip — deliberately, because a node missing from a supervision view is a worse failure than a node in the wrong box;
- that a declared range matching no node is drawn empty and named too;
- that the panel will name a label that would group better, and that it never switches by itself;
- a pointer to `docs/grouping.md` for the relabelling recipe.

Replace the existing sentence saying `slurm_exporter` publishes no rack label with one that points at the three rungs instead of leaving the reader stuck.

Then update the **Warnings** section: delete the cell-count sentence, since `maxCells` is gone, and add the three grouping lines.

- [ ] **Step 3: Update the dev README**

In `dev/README.md`:

- change the ending of the "There is no rack label, and nowhere for one to come from" section so it points at `dev/relabel/racks.txt` and the generator;
- document `make scrape`, and that `make up` runs it;
- document the grouping dashboard's panels, including the exact rung 2 transformation chain recorded in Task 10 Step 2;
- update the dashboard table with the new panels.

- [ ] **Step 4: Cross-link**

Append to `docs/value-mappings.md`:

```markdown
Grouping has its own document: [`grouping.md`](grouping.md).
```

- [ ] **Step 5: Verify every documented claim**

Run: `make check && make e2e && make validate`
Expected: PASS, with the plugin validator reporting no errors.

Then re-read the three documents against the code and check specifically that: the hostlist examples expand to what the text says; the option names match `types.ts`; and every warning string quoted matches `warnings.ts` exactly.

- [ ] **Step 6: Commit**

```bash
git add docs plugins/nodegrid-panel/src/README.md dev/README.md
git commit -m "docs: explain the three routes to a node topology

The panel's own documentation told the reader that slurm_exporter
publishes no rack label and left them there. It now names the three ways
to get one, in the order of how far each travels beyond the panel, and
says which privilege each needs - because that, not elegance, is what
decides which one a given operator can actually use.

The hostlist syntax, the reason a range table is a panel option when a
colour editor was not, and the per-sample cost of relabelling at 200 racks
are all written down rather than rediscovered."
```

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task. The principle and the three rungs: Tasks 9-11. Hostlist syntax and its seven rules: Tasks 1-2. Storage and the dashboard variable: Tasks 5 and 7. The "why a panel option here" argument: Task 11. Declared order and empty groups: Task 3. Orphans: Tasks 5-6. The warning lines: Task 5. The coverage signal: Task 4. The generator: Task 9. `maxCells` and the cell size split: Task 8. The spec's testing list: distributed across each task's own tests. Rung 2's verification: Task 10. The one spec item with no task is the one the spec puts out of scope — detecting nodes present in the table but absent from Prometheus.

**Placeholder scan.** No "TBD", no "handle edge cases", no "similar to Task N". Task 10 Step 2 is the only step whose outcome is not written in advance, and that is deliberate: the spec records rung 2 as unverified, so discovering the working transformation chain is that step's deliverable, with the three likeliest adjustments listed and an explicit instruction to write down whatever it turns out to be.

**Type consistency.** `KeySource` gains `{ kind: 'ranges'; table: string }` in Task 2 and appears under that exact shape in Tasks 4, 5, 6, 7 and 10. `parseRangeTable` returns `{ groups, index, problems }` in Task 2 and is destructured under those names in Tasks 5 and 9. `BuildOptions.order` is added in Task 3 and passed in Task 5. `CoverageSuggestion` is `{ label, covered, total }` in Task 4 and read under those names in Task 5. `GroupingNotes` is defined in Task 5 and consumed in Tasks 5 and 6. `resolveCellSize` returns `{ width, height }` in Task 8 and is destructured there. `RackFrame` takes `cellWidth` from Task 6 onward, including its use in Task 8.
