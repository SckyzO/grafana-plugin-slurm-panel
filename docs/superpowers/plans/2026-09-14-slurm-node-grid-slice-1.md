# Slurm Node Grid — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `tomzone-slurmnodegrid-panel`, a Grafana panel that renders one cell per Slurm node from Prometheus alone, grouped so a cluster reads as racks, with a provisioned dashboard that doubles as the end-to-end fixture.

**Architecture:** An npm-workspaces monorepo split in two. `packages/core` is a pure TypeScript engine — it imports nothing from Grafana and touches no DOM, so ingest, state parsing and grouping are verifiable under plain Node. `plugins/nodegrid-panel` is a thin React panel that binds that engine to Grafana's own mechanisms: colour comes from the field config through `getDisplayProcessor`, states are classified by Value mappings, click-through by Data links. The panel invents no parallel system where Grafana already has one.

**Tech Stack:** TypeScript, React 18.3 (externalised, host-provided), `@grafana/data`/`ui`/`runtime` 12.3, pnpm 12 workspaces, Jest, `@grafana/plugin-e2e` + Playwright, Docker Compose for the dev stack.

**Spec:** `docs/superpowers/specs/2026-09-12-slurm-node-grid-design.md` — read it alongside this plan. Both revision tables matter; the second pass corrects the value mappings this plan ships.

---

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the spec.

- **Node >= 22.** Pin in `.nvmrc`. Local is v22.17.0.
- **Package manager: pnpm >= 11.0.0.** Pin `"packageManager": "pnpm@12.4.1"`. Corepack 0.33.0 is installed; local pnpm is 10.28.2 and must be upgraded before the first install.
- **Supply chain, set at scaffolding time, never retrofitted.** In `pnpm-workspace.yaml`: `strictDepBuilds: true`, `dangerouslyAllowAllBuilds: false`, `minimumReleaseAge: 4320`, `blockExoticSubdeps: true`, and `allowBuilds` as a **map** of package to boolean (an array is a parse error on pnpm 12). `strictDepBuilds` makes the install *fail* until every package wanting a build script has a recorded decision; `false` is the decision "we looked, and it does not get to run". Never `pnpm approve-builds`, never `dangerouslyAllowAllBuilds`.
- **Dependency ranges stay semver.** No git URLs, tarballs, `file:` or `link:` entries. `workspace:` is allowed between packages in this repo.
- **`grafanaDependency: ">=12.3.0"`** in `plugin.json`.
- **`react` and `react-dom` at `^18.3.0`.** The plugin does not move to 19. `react/jsx-runtime` and `react/jsx-dev-runtime` are externalised.
- **`@grafana/data`, `@grafana/ui`, `@grafana/runtime`, `@grafana/schema` at `^12.3.0`** — matched to the `grafanaDependency` floor so a 13-only API cannot be used by accident.
- **Plugin id: `tomzone-slurmnodegrid-panel`.** Org `tomzone`, name `slurmnodegrid`, type `panel`.
- **No hex colours anywhere in the plugin.** Colour, spacing and typography come from `useTheme2()` and theme colour names resolved through `theme.visualization.getColorByName`.
- **`packages/core` imports nothing from `@grafana/*` and touches no DOM.** Enforced by a lint rule, not by discipline.
- **Plugin unit tests live beside their source, under `src/`.** The scaffolded
  Jest config scopes `testMatch` to `src/**`, so a test placed in a top-level
  `tests/` directory is not merely skipped — the suite reports "No tests found"
  and passes **green**. A test that cannot fail is worse than no test.
- **`@grafana/data` needs a DOM at import time**, and its dependency chain defeats Jest's module loader. The one workspace that imports it (`tests/contract`) runs on `node --test` with a jsdom global setup and plain CommonJS — no Jest, no transform. `packages/core` keeps Jest under `testEnvironment: 'node'`, which is what makes a stray Grafana import there fail loudly. The plugin workspace uses `@grafana/create-plugin`'s own Jest setup, which handles Grafana's ESM packages itself. See Task 2, *Why not Jest*.
- **Conventional Commits** (`type(scope): subject`). Commit messages, docs, code comments and any public text are written in the first person as the maintainer. No mention of tooling or generation, in the body or in a trailer.
- **Non-regression is a test, not an intention.** Every bug fix lands with a test that fails before it and passes after.
- **English** for all code, comments, docs and commit messages.
- **Grafana image is pinned, never floating.** `GRAFANA_VERSION` / `GRAFANA_IMAGE` are variables shared by the dev stack and CI.

---

## File Structure

```
slurm-views/
├── package.json                        workspace root, scripts, shared devDeps
├── pnpm-workspace.yaml                 members + supply-chain controls
├── .npmrc                              belt-and-braces script blocking
├── .nvmrc                              22
├── tsconfig.base.json                  shared compiler options
├── eslint.config.js                    flat config, incl. the core-purity rule
├── packages/core/
│   ├── src/model/types.ts              SlurmNode, NodeFacets, IngestResult, IngestWarning
│   ├── src/ingest/labels.ts            label extraction across both frame shapes
│   ├── src/ingest/frames.ts            frames -> SlurmNode[] + warnings
│   ├── src/state/parse.ts              "mixed-" -> { base, modifiers, text }
│   ├── src/group/keys.ts               label | capture | chunk -> key
│   ├── src/group/build.ts              grouping, ordering, overlap accounting
│   ├── src/index.ts                    public surface
│   └── test/fixtures/*.json            captured from the real exporter
├── plugins/nodegrid-panel/
│   ├── src/plugin.json
│   ├── src/module.ts                   registration, useFieldConfig, options
│   ├── src/types.ts                    PanelOptions
│   ├── src/defaults/mappings.ts        the shipped value mappings
│   ├── src/hooks/useNodeModel.ts       frames + options -> grouped model
│   ├── src/components/NodeGridPanel.tsx
│   ├── src/components/NodeGroup.tsx
│   ├── src/components/NodeCell.tsx
│   ├── src/components/NodeTooltip.tsx
│   ├── src/components/GroupHeader.tsx
│   ├── src/components/PanelWarnings.tsx
│   └── src/editor/GroupingEditor.tsx
├── tests/contract/                     what we rely on Grafana to keep doing
├── tests/e2e/                          @grafana/plugin-e2e specs
├── dev/
│   ├── docker-compose.yml
│   ├── synthetic-exporter/             any cluster shape on demand
│   └── provisioning/                   datasources + the dashboard
└── .github/workflows/ci.yml
```

`packages/core` splits by responsibility rather than by layer: ingest, state and grouping each change for their own reasons and each carries its own fixture set. The panel's components split the same way — a cell, a group, a header and a tooltip are four things a reviewer can reject independently.

---

## Task 1: Workspace skeleton, package manager and supply chain

Nothing else can be installed until the package manager meets its floor and the controls are in place. This task ends with a green `pnpm -r test` over one trivial test, which proves the toolchain rather than any behaviour.

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `.nvmrc`, `tsconfig.base.json`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/jest.config.js`
- Create: `packages/core/src/index.ts`, `packages/core/test/smoke.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: the workspace `@slurm-views/core` resolvable as `workspace:*`; root scripts `build`, `test`, `lint`, `typecheck`.

- [ ] **Step 1: Upgrade pnpm to a release above the floor**

```bash
corepack enable
corepack prepare pnpm@12.4.1 --activate
pnpm --version   # must print 12.4.1
```

If corepack refuses (it signs manifests), fall back to `npm install -g pnpm@12.4.1`. Do not proceed on pnpm 10.x — the controls in Step 3 are silently ignored below 11.

- [ ] **Step 2: Write the workspace root**

`package.json`:

```json
{
  "name": "slurm-views",
  "version": "0.1.0",
  "private": true,
  "license": "Apache-2.0",
  "packageManager": "pnpm@12.4.1",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "eslint .",
    "typecheck": "pnpm -r typecheck"
  },
  "devDependencies": {
    "@types/jest": "^29.5.14",
    "@types/node": "^22.10.0",
    "eslint": "^9.17.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.5",
    "typescript": "^5.7.2"
  }
}
```

`.nvmrc`:

```
22
```

- [ ] **Step 3: Write the workspace and supply-chain controls**

`pnpm-workspace.yaml`:

```yaml
packages:
  - 'packages/*'
  - 'plugins/*'

# Supply chain. Set at scaffolding time, not retrofitted.
strictDepBuilds: true
dangerouslyAllowAllBuilds: false
# A map, not a list — pnpm 12 rejects an array here with
# "unexpected event: expected mapping start". Empty means nothing is allowed.
allowBuilds: {}
minimumReleaseAge: 4320
blockExoticSubdeps: true
```

`.npmrc` — pnpm 11+ ignores script settings here, but the file keeps any stray `npm` invocation honest:

```ini
ignore-scripts=true
```

- [ ] **Step 4: Write the shared TypeScript config**

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`noUncheckedIndexedAccess` is deliberate: this engine indexes arrays of frame values constantly, and a missing row must be a type error rather than an `undefined` that reaches the DOM.

- [ ] **Step 5: Write the core package**

`packages/core/package.json`:

```json
{
  "name": "@slurm-views/core",
  "version": "0.1.0",
  "private": true,
  "license": "Apache-2.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "node --experimental-vm-modules ../../node_modules/jest/bin/jest.js",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

`packages/core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*"]
}
```

`packages/core/jest.config.js`:

```js
/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  transform: { '^.+\\.tsx?$': ['ts-jest', { useESM: true, tsconfig: { verbatimModuleSyntax: false } }] },
  testMatch: ['<rootDir>/test/**/*.test.ts'],
};
```

`testEnvironment: 'node'` is the point — if anyone imports `@grafana/data` into `packages/core`, this config fails at the `window is not defined` that `@grafana/data` throws on import.

`packages/core/src/index.ts`:

```ts
export const CORE_VERSION = '0.1.0';
```

- [ ] **Step 6: Write the smoke test**

`packages/core/test/smoke.test.ts`:

```ts
import { CORE_VERSION } from '../src/index.js';

describe('workspace toolchain', () => {
  it('compiles and runs a core module under plain Node', () => {
    expect(CORE_VERSION).toBe('0.1.0');
  });
});
```

- [ ] **Step 7: Extend .gitignore**

```bash
cat >> .gitignore <<'EOF'
dist/
.pnpm-store/
*.tsbuildinfo
playwright-report/
test-results/
playwright/.auth/
EOF
```

- [ ] **Step 8: Install and run**

```bash
pnpm install
pnpm -r test
```

Expected: install completes with no build-script prompt (`strictDepBuilds` blocks any), and one test passes.

- [ ] **Step 9: Verify the supply-chain posture independently**

Run the `grafana-plugins:check-npm` skill against the workspace root. Expected: checks 0–4 all PASS. If any FAIL, fix the config rather than recording an exception.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: set up the pnpm workspace and supply-chain controls"
```

---

## Task 2: Contract test — what we rely on Grafana to keep doing

The panel's whole colour design rests on three behaviours of `getDisplayProcessor`
that are not documented and were established by running it. Two of them are traps
that fail silently. A contract test pins all three, so a Grafana upgrade that
changes any of them breaks a test here rather than a wallboard in production.

**This test runs on Node's built-in test runner, not Jest, and is written in plain
CommonJS rather than TypeScript.** That is deliberate and was settled by
measurement — see *Why not Jest* below. `packages/core` keeps Jest; only this
workspace differs.

**Files:**
- Create: `tests/contract/package.json`
- Create: `tests/contract/value-mappings.test.cjs`
- Modify: `pnpm-workspace.yaml` (add `tests/*`)
- Modify: `eslint.config.js` if the new workspace needs coverage

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: the verified fact that a string field resolves value mappings, which
  Task 3 relies on when it types `SlurmNode.state` as `string` rather than a
  numeric code.

### Why not Jest

Jest was tried first and abandoned on evidence. Under Jest's ESM mode,
`@grafana/data` drags in a chain of dependencies whose named exports cannot be
resolved statically, and each fix uncovers the next:

| Package | Failure | Why config cannot fix it |
|---|---|---|
| `rxjs` | `SyntaxError: Unexpected token 'export'` | pnpm's virtual store puts real files under `node_modules/.pnpm/<pkg>/node_modules/<pkg>`, so a `transformIgnorePatterns` negative lookahead is satisfied at the *first* `node_modules/` segment and the file is never transformed |
| `moment-timezone` | `does not provide an export named 'tz'` | a UMD factory attaches `.tz` at runtime; `cjs-module-lexer` cannot see it statically |
| `lodash` | `does not provide an export named 'isNumber'` | same class, third package — the chain is open-ended |

Jest's CJS mode fails differently and worse: `@grafana/data`'s CJS build
`require()`s `marked@16.3.0`, which is ESM-only with no `require` condition.

Node's own loader has none of these problems, because CommonJS `require()` does no
static named-export analysis. Measured: `node --test` with a jsdom global setup
resolves all three behaviours correctly against `@grafana/data@12.4.10`, with zero
transforms and zero shims.

There is also a principled reason to prefer it here. This test pins how an external
library behaves at runtime. Loading that library the way a consumer actually loads
it is a more faithful pin than loading it through a test runner's re-implementation
of module resolution. Less machinery between the assertion and the library is the
point, not a compromise.

TypeScript is dropped for the same reason: the file calls three functions and
asserts on strings. There is no product code for types to check against, and
type-stripping would put a transform back in the path this task exists to keep
clear.

- [ ] **Step 1: Add the test workspace**

Add `- 'tests/*'` to the `packages:` list in `pnpm-workspace.yaml`, leaving the
supply-chain keys below it untouched.

`tests/contract/package.json`:

```json
{
  "name": "@slurm-views/contract-tests",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "test": "node --test"
  },
  "devDependencies": {
    "@grafana/data": "^12.3.0",
    "jsdom": "^26.0.0"
  }
}
```

No `jest`, no `ts-jest`, no `jest-environment-jsdom`, no `tsconfig.json`. `jsdom`
is a direct dependency because pnpm isolates transitive ones and this file
requires it by name.

- [ ] **Step 2: Write the failing test**

`tests/contract/value-mappings.test.cjs`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

// @grafana/data touches window and document at import time and throws
// "window is not defined" under bare Node, so the DOM goes up first.
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  url: 'http://localhost',
});
for (const key of [
  'window', 'document', 'navigator', 'localStorage',
  'HTMLElement', 'Element', 'Node', 'getComputedStyle', 'requestAnimationFrame',
]) {
  if (globalThis[key] === undefined) {
    try {
      globalThis[key] = key === 'window' ? dom.window : dom.window[key];
    } catch {
      // Some globals are read-only on newer Node; the ones that matter are not.
    }
  }
}

const {
  createTheme, FieldType, getDisplayProcessor, MappingType, stringToJsRegex,
} = require('@grafana/data');

const rule = (pattern, text, color) => ({
  type: MappingType.RegexToText,
  options: { pattern, result: { text, color } },
});

// The plugin keeps its own copy of this list at
// plugins/nodegrid-panel/src/defaults/mappings.ts. The duplication is
// deliberate: this file pins GRAFANA's behaviour, and importing our own
// plugin here would turn a contract test into a test of ourselves.
const DEFAULTS = [
  rule('/^.*\\*$/', 'not responding', 'semi-dark-orange'),
  rule('/^.*~$/', 'powered down', 'text'),
  rule('/^idle.*-$/', 'idle, backfill', 'semi-dark-green'),
  rule('/^idle.*$/', 'idle', 'green'),
  rule('/^mixed.*-$/', 'mixed, backfill', 'semi-dark-blue'),
  rule('/^mixed.*$/', 'mixed', 'blue'),
  rule('/^alloc.*-$/', 'allocated, backfill', 'semi-dark-blue'),
  rule('/^alloc.*$/', 'allocated', 'dark-blue'),
  rule('/^drain.*$/', 'drained', 'yellow'),
  rule('/^(down|fail).*$/', 'down', 'red'),
  rule('/^maint.*$/', 'maintenance', 'purple'),
];

const displayFor = (values, mappings = DEFAULTS) =>
  getDisplayProcessor({
    field: { name: 'status', type: FieldType.string, values, config: { mappings } },
    theme: createTheme(),
  });

// The load-bearing assumption: status is a string, not a number.
test('value mappings resolve on a string field at all', () => {
  const dv = displayFor(['idle'])('idle');
  assert.equal(dv.text, 'idle');
  assert.ok(dv.color, 'expected a colour to be resolved');
});

test('every shipped default maps its state to the intended text', () => {
  const cases = [
    ['idle', 'idle'],
    ['idle*', 'not responding'],
    ['idle~', 'powered down'],
    ['idle-', 'idle, backfill'],
    ['mixed', 'mixed'],
    ['mixed-', 'mixed, backfill'],
    ['mixed*', 'not responding'],
    ['allocated', 'allocated'],
    ['allocated-', 'allocated, backfill'],
    ['drained', 'drained'],
    ['draining', 'drained'],
    ['down', 'down'],
    ['down*', 'not responding'],
    ['fail', 'down'],
    ['failing', 'down'],
    ['maint', 'maintenance'],
  ];
  for (const [value, expected] of cases) {
    assert.equal(displayFor([value])(value).text, expected, `mapping ${value}`);
  }
});

test('a state matching no mapping keeps its raw text', () => {
  for (const value of ['perfctrs', 'blocked', 'inval']) {
    assert.equal(displayFor([value])(value).text, value);
  }
});

// Trap 1: a bare pattern is anchored at both ends, so a prefix rule silently
// becomes an exact match and idle* falls straight through it.
test('Grafana wraps an undelimited pattern in ^...$', () => {
  assert.equal(stringToJsRegex('^idle').source, '^^idle$');
  assert.equal(stringToJsRegex('^idle').test('idle*'), false);
  assert.equal(stringToJsRegex('/^idle/').source, '^idle');
  assert.equal(stringToJsRegex('/^idle/').test('idle*'), true);
});

// Trap 2: RegexToText replaces the match rather than labelling the value, so a
// pattern that stops short leaves the remainder glued to the result.
test('RegexToText replaces only the matched portion', () => {
  const short = [rule('/^drain/', 'drained', 'yellow')];
  assert.equal(displayFor(['drained'], short)('drained').text, 'draineded');
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd tests/contract && node --test
```

Expected: FAIL — `Cannot find module 'jsdom'`, because Step 1's manifest has not
been installed yet. Record the real output.

- [ ] **Step 4: Install and make it pass**

```bash
pnpm install
pnpm --filter @slurm-views/contract-tests test
```

Expected: 5 tests, all passing. If the last one now returns `drained` rather than
`draineded`, Grafana has changed `RegexToText` from a replace to a label — that is
good news, but stop and re-read `defaults/mappings.ts` in Task 7 before
continuing, because the patterns can then be simplified. Do not edit the
assertion to make it green.

- [ ] **Step 5: Confirm the rest of the repo is unaffected**

```bash
pnpm -r test
pnpm lint
```

`packages/core` keeps Jest and `testEnvironment: 'node'` — do not change it. That
setting is what makes a stray `@grafana/data` import there fail loudly.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test: pin the Grafana value-mapping behaviour the panel depends on"
```

---

## Task 3: Core model and ingest

The panel's reason to exist is the join: one cell per node, gathering series that Prometheus returns split across `(node, partition)` pairs and facet metrics that carry no `partition` label at all. This task is that join.

Measured on the test cluster: `slurm_node_status` returns **25 series for 20 distinct nodes** — `c1`, `c2` and `c3` each belong to `cpu`, `debug` and `high`. `slurm_node_drain_reason_info` returns 2 series carrying only `node` and `reason`.

**Files:**
- Create: `packages/core/src/model/types.ts`
- Create: `packages/core/src/ingest/labels.ts`
- Create: `packages/core/src/ingest/frames.ts`
- Create: `packages/core/test/fixtures/capture.sh`
- Create: `packages/core/test/fixtures/node-status.numeric-multi.json`
- Create: `packages/core/test/fixtures/node-status.table.json`
- Create: `packages/core/test/ingest.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type SlurmNode = { name: string; state: string; partitions: string[]; labels: Record<string, string>; facets: NodeFacets }`
  - `type NodeFacets = { cpuAlloc?: number; cpuTotal?: number; memAlloc?: number; memTotal?: number; gres: GresEntry[]; drainReason?: string; drainSince?: number }`
  - `type GresEntry = { type: string; used?: number; total?: number }`
  - `type IngestWarning = { kind: 'no-identity' | 'ambiguous-scalar' | 'unmapped'; refId?: string; detail: string }`
  - `type IngestResult = { nodes: SlurmNode[]; warnings: IngestWarning[] }`
  - `function ingest(input: IngestInput): IngestResult`
  - `type IngestInput = { frames: MinimalFrame[]; slots: SlotBindings; labels: LabelNames }`
  - `type MinimalFrame = { refId?: string; fields: MinimalField[] }`
  - `type MinimalField = { name: string; type?: string; labels?: Record<string, string>; values: unknown[] }`
  - `type SlotBindings = { state: string; cpuAlloc?: string; cpuTotal?: string; memAlloc?: string; memTotal?: string; gresUsed?: string; gresTotal?: string; drainReason?: string; drainSince?: string }`
  - `type LabelNames = { node: string; state: string; partition: string; gresType: string; reason: string }`

`MinimalFrame` is structural on purpose — it is the shape of a `DataFrame` without importing one, which is what keeps `packages/core` free of Grafana.

- [ ] **Step 1: Capture the fixtures from the real exporter**

`packages/core/test/fixtures/capture.sh` — committed so the fixtures can be refreshed, not so they must be:

```bash
#!/usr/bin/env bash
# Capture real Prometheus frames from the slurm_exporter test cluster.
#   make -C ../slurm_exporter/scripts/testing setup
# Then: ./capture.sh > node-status.numeric-multi.json
set -euo pipefail

GRAFANA="${GRAFANA:-http://localhost:3000}"
AUTH="${AUTH:-admin:admin}"
DS_UID="${DS_UID:-$(curl -sf -u "$AUTH" "$GRAFANA/api/datasources" \
  | python3 -c 'import json,sys; print(next(d["uid"] for d in json.load(sys.stdin) if d["type"]=="prometheus"))')}"
EXPR="${1:-slurm_node_status}"

curl -sf -u "$AUTH" -H 'Content-Type: application/json' -X POST "$GRAFANA/api/ds/query" \
  -d "{\"queries\":[{\"refId\":\"A\",\"datasource\":{\"type\":\"prometheus\",\"uid\":\"$DS_UID\"},\"expr\":\"$EXPR\",\"instant\":true}],\"from\":\"now-5m\",\"to\":\"now\"}" \
  | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["results"]["A"]["frames"], indent=2))'
```

```bash
chmod +x packages/core/test/fixtures/capture.sh
```

- [ ] **Step 2: Write the numeric-multi fixture**

This is the shape the Prometheus data source actually returns — verified against the running cluster, and it does **not** change when the query sets `format: table`; that conversion happens in the frontend. One frame per series, all labels on the value field.

`packages/core/test/fixtures/node-status.numeric-multi.json`:

```json
[
  { "schema": { "refId": "A", "meta": { "type": "numeric-multi" }, "fields": [
      { "name": "Time", "type": "time" },
      { "name": "slurm_node_status", "type": "number",
        "labels": { "__name__": "slurm_node_status", "node": "c1", "partition": "cpu", "status": "mixed-" } } ] },
    "data": { "values": [[1789388276915], [1]] } },
  { "schema": { "refId": "A", "meta": { "type": "numeric-multi" }, "fields": [
      { "name": "Time", "type": "time" },
      { "name": "slurm_node_status", "type": "number",
        "labels": { "__name__": "slurm_node_status", "node": "c1", "partition": "debug", "status": "mixed-" } } ] },
    "data": { "values": [[1789388276915], [1]] } },
  { "schema": { "refId": "A", "meta": { "type": "numeric-multi" }, "fields": [
      { "name": "Time", "type": "time" },
      { "name": "slurm_node_status", "type": "number",
        "labels": { "__name__": "slurm_node_status", "node": "c1", "partition": "high", "status": "mixed-" } } ] },
    "data": { "values": [[1789388276915], [1]] } },
  { "schema": { "refId": "A", "meta": { "type": "numeric-multi" }, "fields": [
      { "name": "Time", "type": "time" },
      { "name": "slurm_node_status", "type": "number",
        "labels": { "__name__": "slurm_node_status", "node": "c9", "partition": "cpu", "status": "drained" } } ] },
    "data": { "values": [[1789388276915], [1]] } },
  { "schema": { "refId": "A", "meta": { "type": "numeric-multi" }, "fields": [
      { "name": "Time", "type": "time" },
      { "name": "slurm_node_status", "type": "number",
        "labels": { "__name__": "slurm_node_status", "node": "c10", "partition": "cpu", "status": "down" } } ] },
    "data": { "values": [[1789388276915], [1]] } },
  { "schema": { "refId": "A", "meta": { "type": "numeric-multi" }, "fields": [
      { "name": "Time", "type": "time" },
      { "name": "slurm_node_status", "type": "number",
        "labels": { "__name__": "slurm_node_status", "node": "g1", "partition": "gpu", "status": "idle" } } ] },
    "data": { "values": [[1789388276915], [1]] } }
]
```

- [ ] **Step 3: Write the table fixture**

The shape a `format: table` query produces after the frontend transform — one frame, label columns, one row per series. An ingest that reads only one of the two shapes sees no labels at all on the other, which is why both are fixtures.

`packages/core/test/fixtures/node-status.table.json`:

```json
[
  { "schema": { "refId": "A", "meta": { "type": "table" }, "fields": [
      { "name": "Time", "type": "time" },
      { "name": "node", "type": "string" },
      { "name": "partition", "type": "string" },
      { "name": "status", "type": "string" },
      { "name": "Value", "type": "number" } ] },
    "data": { "values": [
      [1789388276915, 1789388276915, 1789388276915, 1789388276915, 1789388276915, 1789388276915],
      ["c1", "c1", "c1", "c9", "c10", "g1"],
      ["cpu", "debug", "high", "cpu", "cpu", "gpu"],
      ["mixed-", "mixed-", "mixed-", "drained", "down", "idle"],
      [1, 1, 1, 1, 1, 1] ] } }
]
```

- [ ] **Step 4: Write the failing test**

`packages/core/test/ingest.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ingest } from '../src/ingest/frames.js';
import type { LabelNames, MinimalFrame, SlotBindings } from '../src/model/types.js';

const load = (name: string): MinimalFrame[] => {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Array<{
    schema: { refId?: string; fields: Array<{ name: string; type?: string; labels?: Record<string, string> }> };
    data: { values: unknown[][] };
  }>;
  return raw.map((f) => ({
    refId: f.schema.refId,
    fields: f.schema.fields.map((fld, i) => ({ ...fld, values: f.data.values[i] ?? [] })),
  }));
};

const LABELS: LabelNames = { node: 'node', state: 'status', partition: 'partition', gresType: 'gres_type', reason: 'reason' };
const SLOTS: SlotBindings = { state: 'A' };

describe.each([
  ['numeric-multi', 'node-status.numeric-multi.json'],
  ['table', 'node-status.table.json'],
])('ingest reads the %s frame shape', (_shape, file) => {
  const result = () => ingest({ frames: load(file), slots: SLOTS, labels: LABELS });

  it('collapses the series of one node into a single node', () => {
    const { nodes } = result();
    expect(nodes).toHaveLength(4);
    expect(nodes.map((n) => n.name).sort()).toEqual(['c1', 'c10', 'c9', 'g1']);
  });

  it('collects every partition a node belongs to', () => {
    expect(result().nodes.find((n) => n.name === 'c1')?.partitions).toEqual(['cpu', 'debug', 'high']);
  });

  it('keeps the state label verbatim, suffix and all', () => {
    const byName = Object.fromEntries(result().nodes.map((n) => [n.name, n.state]));
    expect(byName).toEqual({ c1: 'mixed-', c9: 'drained', c10: 'down', g1: 'idle' });
  });

  it('reports no warnings on well-formed input', () => {
    expect(result().warnings).toEqual([]);
  });
});

describe('ingest reports rather than guesses', () => {
  it('skips a frame carrying no identity, naming its refId', () => {
    const frames: MinimalFrame[] = [
      { refId: 'A', fields: [{ name: 'Time', type: 'time', values: [1] }, { name: 'Value', type: 'number', values: [1] }] },
    ];
    const { nodes, warnings } = ingest({ frames, slots: SLOTS, labels: LABELS });
    expect(nodes).toEqual([]);
    expect(warnings).toEqual([{ kind: 'no-identity', refId: 'A', detail: 'no node label or column' }]);
  });

  it('is stable when the rows come back in a different order', () => {
    const forward = ingest({ frames: load('node-status.numeric-multi.json'), slots: SLOTS, labels: LABELS });
    const reversed = ingest({ frames: load('node-status.numeric-multi.json').reverse(), slots: SLOTS, labels: LABELS });
    expect(reversed.nodes.map((n) => n.name)).toEqual(forward.nodes.map((n) => n.name));
    expect(reversed.nodes.find((n) => n.name === 'c1')?.partitions).toEqual(['cpu', 'debug', 'high']);
  });
});

describe('ingest joins the facets that carry no partition label', () => {
  const stateFrames = load('node-status.numeric-multi.json');
  const drainFrame: MinimalFrame = {
    refId: 'B',
    fields: [
      { name: 'Time', type: 'time', values: [1789388276915] },
      { name: 'slurm_node_drain_reason_info', type: 'number',
        labels: { node: 'c9', reason: 'GPU fell off the bus - RMA pending' }, values: [1] },
    ],
  };
  const gresFrames: MinimalFrame[] = [
    { refId: 'C', fields: [
      { name: 'Time', type: 'time', values: [1789388276915] },
      { name: 'slurm_node_gres_used', type: 'number', labels: { node: 'g1', gres_type: 'gpu:model_a' }, values: [2] } ] },
    { refId: 'C', fields: [
      { name: 'Time', type: 'time', values: [1789388276915] },
      { name: 'slurm_node_gres_used', type: 'number', labels: { node: 'g1', gres_type: 'gpu:model_b' }, values: [1] } ] },
  ];

  it('attaches a drain reason to a node identified only by name', () => {
    const { nodes } = ingest({
      frames: [...stateFrames, drainFrame],
      slots: { state: 'A', drainReason: 'B' },
      labels: LABELS,
    });
    expect(nodes.find((n) => n.name === 'c9')?.facets.drainReason).toBe('GPU fell off the bus - RMA pending');
    expect(nodes.find((n) => n.name === 'c1')?.facets.drainReason).toBeUndefined();
  });

  it('fans a GRES facet out per model rather than keeping one', () => {
    const { nodes } = ingest({
      frames: [...stateFrames, ...gresFrames],
      slots: { state: 'A', gresUsed: 'C' },
      labels: LABELS,
    });
    expect(nodes.find((n) => n.name === 'g1')?.facets.gres).toEqual([
      { type: 'gpu:model_a', used: 2 },
      { type: 'gpu:model_b', used: 1 },
    ]);
  });

  it('reports an ambiguous scalar instead of keeping an arbitrary row', () => {
    const twice: MinimalFrame[] = [
      { refId: 'D', fields: [
        { name: 'Time', type: 'time', values: [1] },
        { name: 'slurm_node_cpu_alloc', type: 'number', labels: { node: 'c1', partition: 'cpu' }, values: [4] } ] },
      { refId: 'D', fields: [
        { name: 'Time', type: 'time', values: [1] },
        { name: 'slurm_node_cpu_alloc', type: 'number', labels: { node: 'c1', partition: 'debug' }, values: [9] } ] },
    ];
    const { warnings } = ingest({
      frames: [...stateFrames, ...twice],
      slots: { state: 'A', cpuAlloc: 'D' },
      labels: LABELS,
    });
    expect(warnings).toContainEqual({
      kind: 'ambiguous-scalar', refId: 'D', detail: 'c1 returned 2 differing values for cpuAlloc',
    });
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

```bash
pnpm --filter @slurm-views/core test
```

Expected: FAIL — `Cannot find module '../src/ingest/frames.js'`.

- [ ] **Step 6: Write the model types**

`packages/core/src/model/types.ts`:

```ts
/** A field of a Grafana DataFrame, described structurally so core imports no Grafana. */
export interface MinimalField {
  name: string;
  type?: string;
  labels?: Record<string, string>;
  values: unknown[];
}

export interface MinimalFrame {
  refId?: string;
  fields: MinimalField[];
}

export interface LabelNames {
  node: string;
  state: string;
  partition: string;
  gresType: string;
  reason: string;
}

export interface SlotBindings {
  state: string;
  cpuAlloc?: string;
  cpuTotal?: string;
  memAlloc?: string;
  memTotal?: string;
  gresUsed?: string;
  gresTotal?: string;
  drainReason?: string;
  drainSince?: string;
}

export interface GresEntry {
  type: string;
  used?: number;
  total?: number;
}

export interface NodeFacets {
  cpuAlloc?: number;
  cpuTotal?: number;
  memAlloc?: number;
  memTotal?: number;
  gres: GresEntry[];
  drainReason?: string;
  drainSince?: number;
}

export interface SlurmNode {
  name: string;
  state: string;
  partitions: string[];
  /** Every label seen on this node's state series, for use as a grouping key. */
  labels: Record<string, string>;
  facets: NodeFacets;
}

export type IngestWarningKind = 'no-identity' | 'ambiguous-scalar' | 'unmapped';

export interface IngestWarning {
  kind: IngestWarningKind;
  refId?: string;
  detail: string;
}

export interface IngestResult {
  nodes: SlurmNode[];
  warnings: IngestWarning[];
}

export interface IngestInput {
  frames: MinimalFrame[];
  slots: SlotBindings;
  labels: LabelNames;
}

/** A single observation pulled out of either frame shape. */
export interface Sample {
  labels: Record<string, string>;
  value: unknown;
}
```

- [ ] **Step 7: Write the label extractor**

`packages/core/src/ingest/labels.ts`:

```ts
import type { MinimalFrame, Sample } from '../model/types.js';

const isValueField = (name: string): boolean => name !== 'Time' && name !== 'time';

/**
 * Flatten a frame into samples, reading whichever shape Prometheus returned.
 *
 * numeric-multi: one frame per series, every label on the value field, one row.
 * table:         one frame, a string column per label, one row per series.
 *
 * A panel that reads only one of the two sees no labels at all on the other,
 * so both paths are load-bearing rather than defensive.
 */
export function toSamples(frame: MinimalFrame): Sample[] {
  const labelled = frame.fields.find(
    (f) => isValueField(f.name) && f.labels && Object.keys(f.labels).length > 0
  );

  if (labelled) {
    return labelled.values.map((value) => ({ labels: { ...labelled.labels }, value }));
  }

  const stringFields = frame.fields.filter((f) => f.type === 'string');
  if (stringFields.length === 0) {
    return [];
  }

  const valueField =
    frame.fields.find((f) => f.name === 'Value') ??
    frame.fields.find((f) => f.type === 'number' && isValueField(f.name));

  const rowCount = stringFields[0]?.values.length ?? 0;
  const samples: Sample[] = [];
  for (let row = 0; row < rowCount; row++) {
    const labels: Record<string, string> = {};
    for (const field of stringFields) {
      const cell = field.values[row];
      if (typeof cell === 'string') {
        labels[field.name] = cell;
      }
    }
    samples.push({ labels, value: valueField?.values[row] });
  }
  return samples;
}
```

- [ ] **Step 8: Write the ingest**

`packages/core/src/ingest/frames.ts`:

```ts
import { toSamples } from './labels.js';
import type {
  GresEntry, IngestInput, IngestResult, IngestWarning, MinimalFrame, NodeFacets, SlurmNode,
} from '../model/types.js';

type ScalarSlot = 'cpuAlloc' | 'cpuTotal' | 'memAlloc' | 'memTotal' | 'drainSince';
const SCALAR_SLOTS: ScalarSlot[] = ['cpuAlloc', 'cpuTotal', 'memAlloc', 'memTotal', 'drainSince'];

const framesFor = (frames: MinimalFrame[], refId: string | undefined): MinimalFrame[] =>
  refId === undefined ? [] : frames.filter((f) => f.refId === refId);

const toNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const emptyFacets = (): NodeFacets => ({ gres: [] });

export function ingest({ frames, slots, labels }: IngestInput): IngestResult {
  const warnings: IngestWarning[] = [];
  const nodes = new Map<string, SlurmNode>();

  // --- identity and state -------------------------------------------------
  for (const frame of framesFor(frames, slots.state)) {
    const identified = toSamples(frame).filter((s) => typeof s.labels[labels.node] === 'string');

    if (identified.length === 0) {
      warnings.push({ kind: 'no-identity', refId: frame.refId, detail: 'no node label or column' });
      continue;
    }

    for (const sample of identified) {
      const name = sample.labels[labels.node]!;
      let node = nodes.get(name);
      if (!node) {
        node = { name, state: sample.labels[labels.state] ?? '', partitions: [], labels: {}, facets: emptyFacets() };
        nodes.set(name, node);
      }
      // Several series per node is the normal case, not an error: one per
      // (node, partition) pair. Collapse them, and keep every partition.
      const partition = sample.labels[labels.partition];
      if (partition !== undefined && !node.partitions.includes(partition)) {
        node.partitions.push(partition);
      }
      for (const [key, value] of Object.entries(sample.labels)) {
        if (key !== '__name__' && node.labels[key] === undefined) {
          node.labels[key] = value;
        }
      }
    }
  }

  for (const node of nodes.values()) {
    node.partitions.sort();
  }

  // --- scalar facets ------------------------------------------------------
  for (const slot of SCALAR_SLOTS) {
    const refId = slots[slot];
    const seen = new Map<string, Set<number>>();

    for (const frame of framesFor(frames, refId)) {
      for (const sample of toSamples(frame)) {
        const name = sample.labels[labels.node];
        const value = toNumber(sample.value);
        if (name === undefined || value === undefined) {
          continue;
        }
        const bucket = seen.get(name) ?? new Set<number>();
        bucket.add(value);
        seen.set(name, bucket);
      }
    }

    for (const [name, values] of seen) {
      const node = nodes.get(name);
      if (!node) {
        continue;
      }
      if (values.size > 1) {
        // Keeping an arbitrary row here is how a panel reports a number
        // nobody can reproduce. Say so instead.
        warnings.push({
          kind: 'ambiguous-scalar', refId,
          detail: `${name} returned ${values.size} differing values for ${slot}`,
        });
        continue;
      }
      node.facets[slot] = [...values][0];
    }
  }

  // --- gres, keyed per model ----------------------------------------------
  const applyGres = (refId: string | undefined, key: 'used' | 'total'): void => {
    for (const frame of framesFor(frames, refId)) {
      for (const sample of toSamples(frame)) {
        const name = sample.labels[labels.node];
        const type = sample.labels[labels.gresType];
        const value = toNumber(sample.value);
        if (name === undefined || type === undefined || value === undefined) {
          continue;
        }
        const node = nodes.get(name);
        if (!node) {
          continue;
        }
        let entry: GresEntry | undefined = node.facets.gres.find((g) => g.type === type);
        if (!entry) {
          entry = { type };
          node.facets.gres.push(entry);
        }
        entry[key] = value;
      }
    }
  };
  applyGres(slots.gresUsed, 'used');
  applyGres(slots.gresTotal, 'total');
  for (const node of nodes.values()) {
    node.facets.gres.sort((a, b) => a.type.localeCompare(b.type));
  }

  // --- drain reason, which carries no partition label ---------------------
  for (const frame of framesFor(frames, slots.drainReason)) {
    for (const sample of toSamples(frame)) {
      const name = sample.labels[labels.node];
      const reason = sample.labels[labels.reason];
      if (name === undefined || reason === undefined) {
        continue;
      }
      const node = nodes.get(name);
      if (node) {
        node.facets.drainReason = reason;
      }
    }
  }

  return { nodes: [...nodes.values()].sort((a, b) => a.name.localeCompare(b.name)), warnings };
}
```

- [ ] **Step 9: Export the surface**

`packages/core/src/index.ts`:

```ts
export const CORE_VERSION = '0.1.0';

export * from './model/types.js';
export { ingest } from './ingest/frames.js';
export { toSamples } from './ingest/labels.js';
```

- [ ] **Step 10: Run the tests to verify they pass**

```bash
pnpm --filter @slurm-views/core test
pnpm --filter @slurm-views/core typecheck
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(core): collapse Prometheus series into one node per cell"
```

---

## Task 4: State parsing for display text

The engine splits `mixed-` into a base and a modifier so the tooltip can say `mixed, planned by backfill`. It does **not** derive severity from it — that is what Value mappings are for. An unrecognised trailing character is kept as part of the base rather than guessed at.

**Files:**
- Create: `packages/core/src/state/parse.ts`
- Create: `packages/core/test/state.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type ParsedState = { base: string; modifiers: StateModifier[]; text: string; raw: string }`
  - `type StateModifier = { symbol: string; label: string }`
  - `function parseState(raw: string): ParsedState`
  - `const BASE_STATES: readonly string[]`

- [ ] **Step 1: Write the failing test**

`packages/core/test/state.test.ts`:

```ts
import { parseState } from '../src/state/parse.js';

describe('parseState splits a sinfo state into base and modifiers', () => {
  it.each([
    ['idle', 'idle', [], 'idle'],
    ['idle*', 'idle', ['*'], 'idle, not responding'],
    ['mixed-', 'mixed', ['-'], 'mixed, planned by backfill'],
    ['allocated~', 'allocated', ['~'], 'allocated, powered down'],
    ['down#', 'down', ['#'], 'down, powering up'],
    ['idle!', 'idle', ['!'], 'idle, power down pending'],
    ['idle%', 'idle', ['%'], 'idle, powering down'],
    ['idle$', 'idle', ['$'], 'idle, in a maintenance reservation'],
    ['idle@', 'idle', ['@'], 'idle, reboot pending'],
    ['idle^', 'idle', ['^'], 'idle, reboot issued'],
  ])('parses %s', (raw, base, symbols, text) => {
    const parsed = parseState(raw);
    expect(parsed.base).toBe(base);
    expect(parsed.modifiers.map((m) => m.symbol)).toEqual(symbols);
    expect(parsed.text).toBe(text);
    expect(parsed.raw).toBe(raw);
  });

  it('accepts inval, which sinfo does not document but the exporter emits', () => {
    expect(parseState('inval').base).toBe('inval');
    expect(parseState('inval').modifiers).toEqual([]);
  });

  it('keeps an unrecognised trailing character rather than guessing at it', () => {
    const parsed = parseState('idle?');
    expect(parsed.base).toBe('idle?');
    expect(parsed.modifiers).toEqual([]);
    expect(parsed.text).toBe('idle?');
  });

  it('does not strip a modifier character off an unknown base state', () => {
    // A state Slurm adds in a future release must survive intact.
    const parsed = parseState('quiescing*');
    expect(parsed.base).toBe('quiescing');
    expect(parsed.modifiers.map((m) => m.symbol)).toEqual(['*']);
  });

  it('handles an empty state without throwing', () => {
    expect(parseState('')).toEqual({ base: '', modifiers: [], text: '', raw: '' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @slurm-views/core test state
```

Expected: FAIL — `Cannot find module '../src/state/parse.js'`.

- [ ] **Step 3: Write the parser**

`packages/core/src/state/parse.ts`:

```ts
export interface StateModifier {
  symbol: string;
  label: string;
}

export interface ParsedState {
  base: string;
  modifiers: StateModifier[];
  /** Human-readable form for the tooltip: "mixed, planned by backfill". */
  text: string;
  raw: string;
}

/** sinfo StateLong base states, plus inval which slurm_exporter emits. */
export const BASE_STATES = [
  'allocated', 'blocked', 'completing', 'down', 'drained', 'draining', 'fail', 'failing',
  'future', 'idle', 'inval', 'maint', 'mixed', 'perfctrs', 'planned', 'power_down',
  'power_up', 'reserved', 'unknown',
] as const;

/**
 * sinfo compresses the node flags into a single trailing character. scontrol
 * shows the same thing expanded, as State=DOWN+DYNAMIC_NORM+NOT_RESPONDING.
 */
const MODIFIERS: Record<string, string> = {
  '*': 'not responding',
  '~': 'powered down',
  '#': 'powering up',
  '!': 'power down pending',
  '%': 'powering down',
  '$': 'in a maintenance reservation',
  '@': 'reboot pending',
  '^': 'reboot issued',
  '-': 'planned by backfill',
};

export function parseState(raw: string): ParsedState {
  if (raw === '') {
    return { base: '', modifiers: [], text: '', raw };
  }

  const last = raw.slice(-1);
  const label = MODIFIERS[last];

  // Only a documented modifier is split off. An unrecognised trailing
  // character stays part of the base state — guessing at it is how a state
  // added in a future Slurm release becomes silently wrong.
  if (label === undefined) {
    return { base: raw, modifiers: [], text: raw, raw };
  }

  const base = raw.slice(0, -1);
  return { base, modifiers: [{ symbol: last, label }], text: `${base}, ${label}`, raw };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @slurm-views/core test state
```

Expected: PASS.

- [ ] **Step 5: Export and commit**

Add to `packages/core/src/index.ts`:

```ts
export { parseState, BASE_STATES } from './state/parse.js';
export type { ParsedState, StateModifier } from './state/parse.js';
```

```bash
pnpm --filter @slurm-views/core test
git add -A
git commit -m "feat(core): read a Slurm state suffix as a modifier"
```

---

## Task 5: Grouping keys

Three sources, from most to least trustworthy. Only one of them invents structure, and it has to say so.

**Files:**
- Create: `packages/core/src/group/keys.ts`
- Create: `packages/core/test/keys.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `SlurmNode` from Task 3.
- Produces:
  - `type KeySource = { kind: 'label'; label: string } | { kind: 'capture'; pattern: string } | { kind: 'chunk'; size: number } | { kind: 'none' }`
  - `type KeyResult = { key: string; assumed: boolean }`
  - `function makeKeyFn(source: KeySource): (node: SlurmNode) => KeyResult`
  - `function describeKeySource(source: KeySource): string`
  - `const UNGROUPED = 'ungrouped'`
  - `function ordinalOf(name: string): number | undefined`

- [ ] **Step 1: Write the failing test**

`packages/core/test/keys.test.ts`:

```ts
import { makeKeyFn, ordinalOf, UNGROUPED } from '../src/group/keys.js';
import type { SlurmNode } from '../src/model/types.js';

const node = (name: string, labels: Record<string, string> = {}): SlurmNode => ({
  name, state: 'idle', partitions: [], labels, facets: { gres: [] },
});

describe('label keys read a value the data already carries', () => {
  const key = makeKeyFn({ kind: 'label', label: 'rack' });

  it('reads the label', () => {
    expect(key(node('c1', { rack: 'r012' }))).toEqual({ key: 'r012', assumed: false });
  });

  it('falls back rather than dropping a node with the label missing', () => {
    expect(key(node('c1'))).toEqual({ key: UNGROUPED, assumed: false });
  });
});

describe('capture keys read structure the node name encodes', () => {
  const key = makeKeyFn({ kind: 'capture', pattern: '^(r\\d+)c\\d+n\\d+$' });

  it('returns the first capture group', () => {
    expect(key(node('r012c04n03'))).toEqual({ key: 'r012', assumed: false });
  });

  it('falls back when the pattern matches nothing', () => {
    expect(key(node('c1'))).toEqual({ key: UNGROUPED, assumed: false });
  });

  it('falls back on a pattern with no capture group', () => {
    expect(makeKeyFn({ kind: 'capture', pattern: '^r\\d+' })(node('r012c04n03')))
      .toEqual({ key: UNGROUPED, assumed: false });
  });

  it('does not throw on a pattern that will not compile', () => {
    // A regex typed into a panel option is typed by a human, mid-thought.
    expect(makeKeyFn({ kind: 'capture', pattern: '^(unclosed' })(node('c1')))
      .toEqual({ key: UNGROUPED, assumed: false });
  });
});

describe('chunk keys invent structure, and say so', () => {
  const key = makeKeyFn({ kind: 'chunk', size: 40 });

  it.each([
    ['compute0001', 'chunk 1'],
    ['compute0040', 'chunk 1'],
    ['compute0041', 'chunk 2'],
    ['compute0421', 'chunk 11'],
  ])('slices %s into %s', (name, expected) => {
    expect(key(node(name))).toEqual({ key: expected, assumed: true });
  });

  it('marks the result assumed even when it lands in the first chunk', () => {
    expect(key(node('c1')).assumed).toBe(true);
  });

  it('falls back for a name carrying no ordinal, and is not assumed', () => {
    // Nothing was invented here, so nothing is claimed.
    expect(key(node('login'))).toEqual({ key: UNGROUPED, assumed: false });
  });

  it('refuses a non-positive chunk size instead of dividing by zero', () => {
    expect(makeKeyFn({ kind: 'chunk', size: 0 })(node('compute0421')))
      .toEqual({ key: UNGROUPED, assumed: false });
  });
});

describe('no grouping puts every node in one group', () => {
  it('returns a single key', () => {
    expect(makeKeyFn({ kind: 'none' })(node('c1'))).toEqual({ key: UNGROUPED, assumed: false });
  });
});

describe('ordinalOf reads the trailing number of a node name', () => {
  it.each([
    ['c1', 1], ['c10', 10], ['compute0421', 421], ['r012c04n03', 3], ['login', undefined],
  ])('reads %s as %s', (name, expected) => {
    expect(ordinalOf(name)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @slurm-views/core test keys
```

Expected: FAIL — `Cannot find module '../src/group/keys.js'`.

- [ ] **Step 3: Write the key functions**

`packages/core/src/group/keys.ts`:

```ts
import type { SlurmNode } from '../model/types.js';

export type KeySource =
  | { kind: 'label'; label: string }
  | { kind: 'capture'; pattern: string }
  | { kind: 'chunk'; size: number }
  | { kind: 'none' };

export interface KeyResult {
  key: string;
  /** True when the key asserts structure the data did not state. */
  assumed: boolean;
}

export const UNGROUPED = 'ungrouped';

const NO_KEY: KeyResult = { key: UNGROUPED, assumed: false };

/** The trailing number of a node name, the only ordering signal a name carries. */
export function ordinalOf(name: string): number | undefined {
  const match = /(\d+)\s*$/.exec(name);
  if (!match?.[1]) {
    return undefined;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function makeKeyFn(source: KeySource): (node: SlurmNode) => KeyResult {
  switch (source.kind) {
    case 'label':
      return (node) => {
        const value = node.labels[source.label];
        return value === undefined ? NO_KEY : { key: value, assumed: false };
      };

    case 'capture': {
      // Compiled once, not per node, and never allowed to throw: this pattern
      // is typed into a panel option by hand and is invalid most of the time
      // it is being typed.
      let regex: RegExp | undefined;
      try {
        regex = new RegExp(source.pattern);
      } catch {
        regex = undefined;
      }
      return (node) => {
        const captured = regex?.exec(node.name)?.[1];
        return captured === undefined ? NO_KEY : { key: captured, assumed: false };
      };
    }

    case 'chunk':
      return (node) => {
        if (!Number.isInteger(source.size) || source.size <= 0) {
          return NO_KEY;
        }
        const ordinal = ordinalOf(node.name);
        if (ordinal === undefined) {
          return NO_KEY;
        }
        // Chunking is the one source that asserts something the data does not
        // say. In HPC the numbering usually follows the floor; usually is not
        // always, so the claim travels with the key.
        return { key: `chunk ${Math.floor((ordinal - 1) / source.size) + 1}`, assumed: true };
      };

    case 'none':
    default:
      return () => NO_KEY;
  }
}

export function describeKeySource(source: KeySource): string {
  switch (source.kind) {
    case 'label':
      return `label ${source.label}`;
    case 'capture':
      return `capture ${source.pattern}`;
    case 'chunk':
      return `${source.size} per group (assumed)`;
    case 'none':
    default:
      return 'no grouping';
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @slurm-views/core test keys
```

Expected: PASS.

- [ ] **Step 5: Export and commit**

Add to `packages/core/src/index.ts`:

```ts
export { makeKeyFn, describeKeySource, ordinalOf, UNGROUPED } from './group/keys.js';
export type { KeySource, KeyResult } from './group/keys.js';
```

```bash
pnpm --filter @slurm-views/core test
git add -A
git commit -m "feat(core): derive a grouping key from a label, a capture or a chunk"
```

---

## Task 6: Grouping

A node may land in several groups, and when it does the panel states both numbers. A count that silently disagrees with `sinfo` is worse than no count.

**Files:**
- Create: `packages/core/src/group/build.ts`
- Create: `packages/core/test/build.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `SlurmNode` (Task 3), `KeySource` / `makeKeyFn` / `ordinalOf` (Task 5).
- Produces:
  - `type NodeGroup = { key: string; nodes: SlurmNode[]; assumed: boolean }`
  - `type GroupedModel = { groups: NodeGroup[]; nodeCount: number; slotCount: number; duplicated: boolean }`
  - `type BuildOptions = { multiValueLabel?: boolean }`
  - `function buildGroups(nodes: SlurmNode[], source: KeySource, opts?: BuildOptions): GroupedModel`

- [ ] **Step 1: Write the failing test**

`packages/core/test/build.test.ts`:

```ts
import { buildGroups } from '../src/group/build.js';
import type { SlurmNode } from '../src/model/types.js';

const node = (name: string, partitions: string[] = [], labels: Record<string, string> = {}): SlurmNode => ({
  name, state: 'idle', partitions, labels, facets: { gres: [] },
});

describe('buildGroups', () => {
  it('groups by a label and sorts the groups by key', () => {
    const model = buildGroups(
      [node('c2', [], { rack: 'r02' }), node('c1', [], { rack: 'r01' })],
      { kind: 'label', label: 'rack' }
    );
    expect(model.groups.map((g) => g.key)).toEqual(['r01', 'r02']);
    expect(model.nodeCount).toBe(2);
    expect(model.slotCount).toBe(2);
    expect(model.duplicated).toBe(false);
  });

  it('orders within a group by the ordinal, not lexically', () => {
    // c10 sorts before c2 as a string; a rack that reads 1, 10, 2 is wrong.
    const model = buildGroups([node('c10'), node('c2'), node('c1')], { kind: 'chunk', size: 40 });
    expect(model.groups[0]?.nodes.map((n) => n.name)).toEqual(['c1', 'c2', 'c10']);
  });

  it('falls back to a natural sort for names carrying no ordinal', () => {
    const model = buildGroups([node('login-b'), node('login-a')], { kind: 'none' });
    expect(model.groups[0]?.nodes.map((n) => n.name)).toEqual(['login-a', 'login-b']);
  });

  it('places a node in every group of a multi-valued key, and reports both counts', () => {
    const model = buildGroups(
      [node('c1', ['cpu', 'debug', 'high']), node('c4', ['cpu'])],
      { kind: 'label', label: 'partition' },
      { multiValueLabel: true }
    );
    expect(model.groups.map((g) => g.key)).toEqual(['cpu', 'debug', 'high']);
    expect(model.nodeCount).toBe(2);
    expect(model.slotCount).toBe(4);
    expect(model.duplicated).toBe(true);
  });

  it('marks a group assumed when the key was invented', () => {
    expect(buildGroups([node('compute0421')], { kind: 'chunk', size: 40 }).groups[0]?.assumed).toBe(true);
  });

  it('does not mark a label group assumed', () => {
    expect(buildGroups([node('c1', [], { rack: 'r01' })], { kind: 'label', label: 'rack' }).groups[0]?.assumed)
      .toBe(false);
  });

  it('is stable when the input order changes between refreshes', () => {
    const nodes = [node('c1', [], { rack: 'r01' }), node('c2', [], { rack: 'r01' }), node('c3', [], { rack: 'r02' })];
    const forward = buildGroups(nodes, { kind: 'label', label: 'rack' });
    const reversed = buildGroups([...nodes].reverse(), { kind: 'label', label: 'rack' });
    expect(reversed.groups.map((g) => g.key)).toEqual(forward.groups.map((g) => g.key));
    expect(reversed.groups.map((g) => g.nodes.map((n) => n.name)))
      .toEqual(forward.groups.map((g) => g.nodes.map((n) => n.name)));
  });

  it('returns an empty model for no nodes rather than one empty group', () => {
    expect(buildGroups([], { kind: 'none' })).toEqual({
      groups: [], nodeCount: 0, slotCount: 0, duplicated: false,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @slurm-views/core test build
```

Expected: FAIL — `Cannot find module '../src/group/build.js'`.

- [ ] **Step 3: Write the grouping**

`packages/core/src/group/build.ts`:

```ts
import { makeKeyFn, ordinalOf, UNGROUPED } from './keys.js';
import type { KeySource } from './keys.js';
import type { SlurmNode } from '../model/types.js';

export interface NodeGroup {
  key: string;
  nodes: SlurmNode[];
  /** True when the key was invented rather than read. */
  assumed: boolean;
}

export interface GroupedModel {
  groups: NodeGroup[];
  /** Distinct nodes. */
  nodeCount: number;
  /** Cells drawn. Larger than nodeCount when a node sits in several groups. */
  slotCount: number;
  duplicated: boolean;
}

export interface BuildOptions {
  /**
   * Treat the key label as one a node may hold several values of — the
   * partition case. The node is then drawn in each of its groups.
   */
  multiValueLabel?: boolean;
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Ordinal first, then a natural sort, so a rack reads 1, 2, 10 rather than 1, 10, 2. */
function compareNodes(a: SlurmNode, b: SlurmNode): number {
  const oa = ordinalOf(a.name);
  const ob = ordinalOf(b.name);
  if (oa !== undefined && ob !== undefined && oa !== ob) {
    return oa - ob;
  }
  return collator.compare(a.name, b.name);
}

export function buildGroups(
  nodes: SlurmNode[],
  source: KeySource,
  opts: BuildOptions = {}
): GroupedModel {
  if (nodes.length === 0) {
    return { groups: [], nodeCount: 0, slotCount: 0, duplicated: false };
  }

  const keyFn = makeKeyFn(source);
  const buckets = new Map<string, { nodes: SlurmNode[]; assumed: boolean }>();
  let slotCount = 0;

  const place = (node: SlurmNode, key: string, assumed: boolean): void => {
    const bucket = buckets.get(key) ?? { nodes: [], assumed: false };
    bucket.nodes.push(node);
    bucket.assumed = bucket.assumed || assumed;
    buckets.set(key, bucket);
    slotCount++;
  };

  const multiValued = opts.multiValueLabel === true && source.kind === 'label';

  for (const node of nodes) {
    if (multiValued && source.kind === 'label' && source.label === 'partition' && node.partitions.length > 0) {
      // A node in three partitions is drawn three times. The header says so.
      for (const partition of node.partitions) {
        place(node, partition, false);
      }
      continue;
    }
    const { key, assumed } = keyFn(node);
    place(node, key, assumed);
  }

  const groups: NodeGroup[] = [...buckets.entries()]
    .map(([key, bucket]) => ({ key, nodes: [...bucket.nodes].sort(compareNodes), assumed: bucket.assumed }))
    .sort((a, b) => {
      // "ungrouped" is a fallback, not a rack; it belongs last.
      if (a.key === UNGROUPED) { return b.key === UNGROUPED ? 0 : 1; }
      if (b.key === UNGROUPED) { return -1; }
      return collator.compare(a.key, b.key);
    });

  return { groups, nodeCount: nodes.length, slotCount, duplicated: slotCount > nodes.length };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @slurm-views/core test
pnpm --filter @slurm-views/core typecheck
```

Expected: PASS.

- [ ] **Step 5: Export and commit**

Add to `packages/core/src/index.ts`:

```ts
export { buildGroups } from './group/build.js';
export type { NodeGroup, GroupedModel, BuildOptions } from './group/build.js';
```

```bash
git add -A
git commit -m "feat(core): group nodes, allowing and reporting overlap"
```

---

## Task 7: Panel scaffold, options and colour from the field config

Scaffolding, the React-19-forward posture and the first rendered cell land together: none of them is independently reviewable, and the thing worth reviewing is a cell that takes its colour from the field config.

**Files:**
- Create: the `@grafana/create-plugin` scaffold under `plugins/nodegrid-panel/`
- Create: `plugins/nodegrid-panel/src/types.ts`
- Create: `plugins/nodegrid-panel/src/defaults/mappings.ts`
- Create: `plugins/nodegrid-panel/src/hooks/useNodeModel.ts`
- Create: `plugins/nodegrid-panel/src/components/NodeGridPanel.tsx`
- Modify: `plugins/nodegrid-panel/src/module.ts`, `src/plugin.json`, `package.json`

**Interfaces:**
- Consumes: everything exported from `@slurm-views/core`.
- Produces:
  - `interface PanelOptions { labels: LabelNames; slots: SlotBindings; grouping: KeySource; multiValueLabel: boolean; layout: 'wrap' | 'rack'; cellSize: number; gap: number; shapeChannel: boolean; colorMode: 'state' | 'cpu' | 'mem' | 'gres'; maxCells: number }`
  - `const DEFAULT_OPTIONS: PanelOptions`
  - `const DEFAULT_MAPPINGS: ValueMapping[]`
  - `function useNodeModel(data: PanelData, options: PanelOptions): { model: GroupedModel; warnings: IngestWarning[]; stateField: Field | undefined }`

- [ ] **Step 1: Scaffold the plugin**

```bash
mkdir -p plugins
cd plugins
pnpm dlx @grafana/create-plugin@7.10.1 \
  --plugin-type=panel \
  --plugin-name=slurmnodegrid \
  --org-name=tomzone
mv tomzone-slurmnodegrid-panel nodegrid-panel
cd ..
```

Confirm the generated id, which must match exactly:

```bash
jq -r '.id, .type' plugins/nodegrid-panel/src/plugin.json
# tomzone-slurmnodegrid-panel
# panel
```

- [ ] **Step 2: Apply the React-19-forward posture**

```bash
cd plugins/nodegrid-panel
pnpm dlx @grafana/create-plugin@latest add externalize-jsx-runtime
grep -r "jsx-runtime" .config/bundler/externals.ts webpack.config.ts 2>/dev/null
cd ../..
```

If the command does not write the externals, add them to `plugins/nodegrid-panel/webpack.config.ts` by hand:

```ts
externals: ['react/jsx-runtime', 'react/jsx-dev-runtime'],
```

Grafana shares its own React instance with plugins, so a plugin that bundles React 19 breaks at runtime. The posture is *forward compatible*, not *up to date*.

- [ ] **Step 3: Pin the dependency floors**

Edit `plugins/nodegrid-panel/package.json` so these exact ranges hold:

```json
{
  "dependencies": {
    "@grafana/data": "^12.3.0",
    "@grafana/runtime": "^12.3.0",
    "@grafana/schema": "^12.3.0",
    "@grafana/ui": "^12.3.0",
    "@slurm-views/core": "workspace:*",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0"
  }
}
```

Set the dependencies block in `plugins/nodegrid-panel/src/plugin.json`:

```json
{ "dependencies": { "grafanaDependency": ">=12.3.0", "grafanaVersion": "12.3.x", "plugins": [] } }
```

Then:

```bash
pnpm install
pnpm --filter tomzone-slurmnodegrid-panel build
```

Expected: a clean build. Scaffolded packages may carry lifecycle scripts; `strictDepBuilds` blocks them and names them. Approve none — if the build genuinely needs one, record why in the commit body.

- [ ] **Step 4: Write the options model**

`plugins/nodegrid-panel/src/types.ts`:

```ts
import type { KeySource, LabelNames, SlotBindings } from '@slurm-views/core';

export type Layout = 'wrap' | 'rack';
export type ColorMode = 'state' | 'cpu' | 'mem' | 'gres';

export interface PanelOptions {
  labels: LabelNames;
  slots: SlotBindings;
  grouping: KeySource;
  multiValueLabel: boolean;
  layout: Layout;
  cellSize: number;
  gap: number;
  shapeChannel: boolean;
  colorMode: ColorMode;
  maxCells: number;
}

export const DEFAULT_OPTIONS: PanelOptions = {
  labels: { node: 'node', state: 'status', partition: 'partition', gresType: 'gres_type', reason: 'reason' },
  slots: { state: 'A' },
  grouping: { kind: 'none' },
  multiValueLabel: false,
  layout: 'wrap',
  // 10px is the honest floor: below it a notch stops being legible and a cell
  // stops being a usable hover target.
  cellSize: 14,
  gap: 2,
  shapeChannel: false,
  colorMode: 'state',
  maxCells: 3000,
};
```

- [ ] **Step 5: Write the shipped value mappings**

`plugins/nodegrid-panel/src/defaults/mappings.ts`:

```ts
import { MappingType } from '@grafana/data';
import type { ValueMapping } from '@grafana/data';

const rule = (pattern: string, text: string, color: string): ValueMapping => ({
  type: MappingType.RegexToText,
  options: { pattern, result: { text, color } },
});

/**
 * The starting set of state mappings, written around two traps that are not
 * visible from the Value mappings UI and both fail silently.
 *
 * 1. Delimit the pattern. Grafana compiles a bare pattern with
 *    stringToJsRegex, which wraps it in ^...$ — so "^idle" becomes /^^idle$/,
 *    an exact match, and "idle*" falls straight through it.
 * 2. Span the whole value. RegexToText substitutes the result for the matched
 *    portion rather than labelling the value, so "/^drain/ -> drained" renders
 *    "drained" as "draineded".
 *
 * Order still matters on top of both: a modifier rule must come before the
 * base rule that would otherwise swallow it.
 *
 * Colours are theme names, resolved by the theme. No hex.
 */
export const DEFAULT_MAPPINGS: ValueMapping[] = [
  rule('/^.*\\*$/', 'not responding', 'semi-dark-orange'),
  rule('/^.*~$/', 'powered down', 'text'),
  rule('/^idle.*-$/', 'idle, backfill', 'semi-dark-green'),
  rule('/^idle.*$/', 'idle', 'green'),
  rule('/^mixed.*-$/', 'mixed, backfill', 'semi-dark-blue'),
  rule('/^mixed.*$/', 'mixed', 'blue'),
  rule('/^alloc.*-$/', 'allocated, backfill', 'semi-dark-blue'),
  rule('/^alloc.*$/', 'allocated', 'dark-blue'),
  rule('/^drain.*$/', 'drained', 'yellow'),
  rule('/^(down|fail).*$/', 'down', 'red'),
  rule('/^maint.*$/', 'maintenance', 'purple'),
];
```

- [ ] **Step 6: Write the model hook**

`plugins/nodegrid-panel/src/hooks/useNodeModel.ts`:

```ts
import { useMemo } from 'react';
import { FieldType } from '@grafana/data';
import type { DataFrame, Field, PanelData } from '@grafana/data';
import { buildGroups, ingest } from '@slurm-views/core';
import type { GroupedModel, IngestWarning, MinimalFrame } from '@slurm-views/core';
import type { PanelOptions } from '../types';

/** DataFrame -> the structural shape core accepts, without core importing Grafana. */
const toMinimal = (frame: DataFrame): MinimalFrame => ({
  refId: frame.refId,
  fields: frame.fields.map((f) => ({
    name: f.name,
    type: f.type,
    labels: f.labels,
    values: typeof (f.values as { toArray?: () => unknown[] }).toArray === 'function'
      ? (f.values as unknown as { toArray: () => unknown[] }).toArray()
      : (f.values as unknown as unknown[]),
  })),
});

export interface NodeModel {
  model: GroupedModel;
  warnings: IngestWarning[];
  /** The field the state colour is resolved against. */
  stateField: Field | undefined;
}

export function useNodeModel(data: PanelData, options: PanelOptions): NodeModel {
  return useMemo(() => {
    const frames = data.series.map(toMinimal);
    const { nodes, warnings } = ingest({ frames, slots: options.slots, labels: options.labels });
    const model = buildGroups(nodes, options.grouping, { multiValueLabel: options.multiValueLabel });

    const stateFrame = data.series.find((f) => f.refId === options.slots.state);
    const stateField =
      stateFrame?.fields.find((f) => f.name === options.labels.state) ??
      stateFrame?.fields.find((f) => f.type === FieldType.string);

    return { model, warnings, stateField };
  }, [data.series, options]);
}
```

- [ ] **Step 7: Write the panel component**

`plugins/nodegrid-panel/src/components/NodeGridPanel.tsx`:

```tsx
import React, { useMemo } from 'react';
import { css } from '@emotion/css';
import { FieldType, getDisplayProcessor } from '@grafana/data';
import type { Field, GrafanaTheme2, PanelProps } from '@grafana/data';
import { useTheme2 } from '@grafana/ui';
import { useNodeModel } from '../hooks/useNodeModel';
import type { PanelOptions } from '../types';

const getStyles = (theme: GrafanaTheme2) => ({
  wrap: css({
    height: '100%',
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
  }),
  cells: css({ display: 'flex', flexWrap: 'wrap' }),
  cell: css({ flex: '0 0 auto', borderRadius: 0 }),
  empty: css({ color: theme.colors.text.secondary, padding: theme.spacing(1) }),
});

export function NodeGridPanel({ data, options, fieldConfig }: PanelProps<PanelOptions>) {
  const theme = useTheme2();
  const styles = getStyles(theme);
  const { model, stateField } = useNodeModel(data, options);

  // Colour is never chosen here. The state string goes through the field
  // config's value mappings and comes back with a theme colour attached.
  const display = useMemo(() => {
    const base: Field = stateField ?? ({
      name: options.labels.state,
      type: FieldType.string,
      values: [],
      config: {},
    } as unknown as Field);
    return getDisplayProcessor({ field: { ...base, config: fieldConfig.defaults }, theme });
  }, [stateField, fieldConfig.defaults, options.labels.state, theme]);

  if (model.groups.length === 0) {
    return <div className={styles.empty}>No nodes. Check that the state query returns a node label.</div>;
  }

  return (
    <div className={styles.wrap} data-testid="slurm-node-grid">
      {model.groups.map((group) => (
        <div key={group.key}>
          <div className={styles.cells} style={{ gap: options.gap }}>
            {group.nodes.map((node) => {
              const dv = display(node.state);
              return (
                <div
                  key={`${group.key}/${node.name}`}
                  className={styles.cell}
                  data-testid={`node-cell-${node.name}`}
                  data-state={node.state}
                  aria-label={`${node.name}, ${dv.text}`}
                  style={{ width: options.cellSize, height: options.cellSize, background: dv.color }}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 8: Register the panel**

`plugins/nodegrid-panel/src/module.ts`:

```ts
import { PanelPlugin } from '@grafana/data';
import { NodeGridPanel } from './components/NodeGridPanel';
import { DEFAULT_OPTIONS } from './types';
import type { PanelOptions } from './types';

export const plugin = new PanelPlugin<PanelOptions>(NodeGridPanel)
  // Without this call Grafana shows no Standard options, no Thresholds and no
  // Value mappings, and every cell is painted the same colour. It is covered
  // by an end-to-end test rather than trusted.
  .useFieldConfig()
  .setPanelOptions((builder) => {
    builder
      .addTextInput({
        path: 'labels.node',
        name: 'Node label',
        description: 'The label carrying node identity.',
        defaultValue: DEFAULT_OPTIONS.labels.node,
        category: ['Data'],
      })
      .addTextInput({
        path: 'labels.state',
        name: 'State label',
        description: 'The label carrying the Slurm state.',
        defaultValue: DEFAULT_OPTIONS.labels.state,
        category: ['Data'],
      })
      .addTextInput({
        path: 'slots.state',
        name: 'State query',
        description: 'refId of the query returning slurm_node_status.',
        defaultValue: DEFAULT_OPTIONS.slots.state,
        category: ['Data'],
      })
      .addRadio({
        path: 'layout',
        name: 'Layout',
        defaultValue: DEFAULT_OPTIONS.layout,
        settings: {
          options: [
            { value: 'wrap', label: 'Wrap' },
            { value: 'rack', label: 'Rack' },
          ],
        },
        category: ['Layout'],
      })
      .addSliderInput({
        path: 'cellSize',
        name: 'Cell size',
        description: 'Below 10px a cell stops being a usable hover target.',
        defaultValue: DEFAULT_OPTIONS.cellSize,
        settings: { min: 6, max: 48, step: 1 },
        category: ['Layout'],
      })
      .addSliderInput({
        path: 'gap',
        name: 'Cell gap',
        description: 'The gap is what makes a grid readable, not a border.',
        defaultValue: DEFAULT_OPTIONS.gap,
        settings: { min: 0, max: 8, step: 1 },
        category: ['Layout'],
      });
  })
  .setNoPadding();
```

The shipped `DEFAULT_MAPPINGS` reach a panel through the provisioned dashboard in Task 12. A "write the defaults" button was attempted in Task 11 and abandoned: a custom option editor receives a `StandardEditorContext`, which carries no `onFieldConfigChange` — that lives on `PanelProps`, a different interface. There is no supported way for a panel to seed `fieldConfig.defaults.mappings` from its own code. `PanelPlugin` has no supported hook for seeding `fieldConfig.defaults.mappings` at registration time, so do not invent one — check before assuming otherwise:

```bash
node -e "const {PanelPlugin}=require('./plugins/nodegrid-panel/node_modules/@grafana/data'); console.log(Object.getOwnPropertyNames(PanelPlugin.prototype).join(' '))"
```

- [ ] **Step 9: Build and typecheck**

```bash
pnpm --filter tomzone-slurmnodegrid-panel build
pnpm --filter tomzone-slurmnodegrid-panel typecheck
npx -y @grafana/react-detect@latest
```

Expected: build succeeds; react-detect reports no `jsxRuntimeImport`, `defaultProps`, `propTypes`, `findDOMNode` or `ReactDOM.render` findings.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(panel): render one cell per node, coloured by the field config"
```

---

## Task 8: Cell, tooltip and group header

The tooltip is what a drained node's owner actually opens. It carries the facts the aggregate dashboards cannot join.

**Files:**
- Create: `plugins/nodegrid-panel/src/utils/format.ts`
- Create: `plugins/nodegrid-panel/src/utils/format.test.ts`
- Create: `plugins/nodegrid-panel/src/components/NodeTooltip.tsx`
- Create: `plugins/nodegrid-panel/src/components/NodeCell.tsx`
- Create: `plugins/nodegrid-panel/src/components/GroupHeader.tsx`
- Create: `plugins/nodegrid-panel/src/components/NodeGroup.tsx`
- Modify: `plugins/nodegrid-panel/src/components/NodeGridPanel.tsx`, `src/module.ts`

**Interfaces:**
- Consumes: `SlurmNode`, `NodeGroup` (as `NodeGroupModel`), `parseState` from core; `PanelOptions` from Task 7.
- Produces:
  - `function formatAge(seconds: number): string`
  - `function formatBytes(mib: number): string`
  - `interface NodeCellProps { node: SlurmNode; size: number; display: DisplayProcessor; shapeChannel: boolean; href?: string; sled?: boolean }`
  - `interface NodeGroupProps { group: NodeGroupModel; display: DisplayProcessor; options: PanelOptions }`
  - `function GroupHeader(props: { group: NodeGroupModel }): JSX.Element`
  - `function NodeTooltip(props: { node: SlurmNode }): JSX.Element`

Note for whoever implements Task 14: it renames `NodeCell`'s `display` prop to
`stateDisplay` and adds `valueDisplay` and `colorMode`. Until then `display` is
the name.

- [ ] **Step 1: Write the failing formatter test**

`plugins/nodegrid-panel/src/utils/format.test.ts`:

```ts
import { formatAge, formatBytes } from './format';

describe('formatAge', () => {
  it.each([
    [0, 'just now'],
    [45, '45s'],
    [90, '1m'],
    [3600, '1h'],
    [5400, '1h 30m'],
    [86400, '1d'],
    [176400, '2d 1h'],
  ])('renders %s seconds as %s', (seconds, expected) => {
    expect(formatAge(seconds)).toBe(expected);
  });

  it('does not render a negative age as a future time', () => {
    // Clock skew between the exporter and Prometheus is real.
    expect(formatAge(-5)).toBe('just now');
  });
});

describe('formatBytes', () => {
  it.each([
    [512, '512 MiB'],
    [1024, '1 GiB'],
    [1536, '1.5 GiB'],
    [1048576, '1 TiB'],
  ])('renders %s MiB as %s', (mib, expected) => {
    expect(formatBytes(mib)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter tomzone-slurmnodegrid-panel test
```

Expected: FAIL — `Cannot find module '../src/utils/format'`.

- [ ] **Step 3: Write the formatters**

`plugins/nodegrid-panel/src/utils/format.ts`:

```ts
/** slurm_node_mem_* are MiB. */
export function formatBytes(mib: number): string {
  const units = ['MiB', 'GiB', 'TiB', 'PiB'];
  let value = mib;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${Math.round(value * 10) / 10} ${units[unit]}`;
}

export function formatAge(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 1) {
    return 'just now';
  }
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);

  if (days > 0) { return hours > 0 ? `${days}d ${hours}h` : `${days}d`; }
  if (hours > 0) { return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`; }
  if (minutes > 0) { return `${minutes}m`; }
  return `${total}s`;
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
pnpm --filter tomzone-slurmnodegrid-panel test
```

Expected: PASS.

- [ ] **Step 5: Write the tooltip**

`plugins/nodegrid-panel/src/components/NodeTooltip.tsx`:

```tsx
import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useTheme2 } from '@grafana/ui';
import { parseState } from '@slurm-views/core';
import type { SlurmNode } from '@slurm-views/core';
import { formatAge, formatBytes } from '../utils/format';

const getStyles = (theme: GrafanaTheme2) => ({
  wrap: css({ display: 'grid', gap: theme.spacing(0.5), minWidth: 200, maxWidth: 360 }),
  // Node identifiers are tabular data, not a small-label decoration.
  name: css({ fontFamily: theme.typography.fontFamilyMonospace, fontWeight: theme.typography.fontWeightMedium }),
  row: css({ display: 'flex', justifyContent: 'space-between', gap: theme.spacing(2) }),
  label: css({ color: theme.colors.text.secondary }),
  reason: css({
    color: theme.colors.text.primary,
    borderTop: `1px solid ${theme.colors.border.weak}`,
    paddingTop: theme.spacing(0.5),
  }),
});

export function NodeTooltip({ node }: { node: SlurmNode }) {
  const theme = useTheme2();
  const styles = getStyles(theme);
  const state = parseState(node.state);
  const { facets } = node;

  const row = (label: string, value: string) => (
    <div className={styles.row} key={label}>
      <span className={styles.label}>{label}</span>
      <span>{value}</span>
    </div>
  );

  return (
    <div className={styles.wrap}>
      <div className={styles.name}>{node.name}</div>
      {/* "mixed, planned by backfill" rather than "mixed-". */}
      {row('State', state.text)}
      {node.partitions.length > 0 && row('Partitions', node.partitions.join(', '))}
      {facets.cpuTotal !== undefined && row('CPU', `${facets.cpuAlloc ?? 0} / ${facets.cpuTotal}`)}
      {facets.memTotal !== undefined &&
        row('Memory', `${formatBytes(facets.memAlloc ?? 0)} / ${formatBytes(facets.memTotal)}`)}
      {facets.gres.map((g) => row(g.type, `${g.used ?? 0} / ${g.total ?? '?'}`))}
      {facets.drainSince !== undefined && row('Drained for', formatAge(facets.drainSince))}
      {facets.drainReason !== undefined && <div className={styles.reason}>{facets.drainReason}</div>}
    </div>
  );
}
```

- [ ] **Step 6: Write the cell**

`plugins/nodegrid-panel/src/components/NodeCell.tsx`:

```tsx
import React from 'react';
import { css, cx } from '@emotion/css';
import type { DisplayProcessor, GrafanaTheme2 } from '@grafana/data';
import { Tooltip, useTheme2 } from '@grafana/ui';
import type { SlurmNode } from '@slurm-views/core';
import { NodeTooltip } from './NodeTooltip';

const getStyles = (theme: GrafanaTheme2) => ({
  cell: css({
    flex: '0 0 auto',
    // No border radius: rounding eats the colour that carries the meaning.
    borderRadius: 0,
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    '&:focus-visible': {
      outline: `2px solid ${theme.colors.primary.border}`,
      outlineOffset: 1,
    },
  }),
  // A node with no value for the state query stays distinguishable from one
  // whose state matched no mapping. Collapsing the two is how a dead node
  // ends up green.
  unmapped: css({ background: 'transparent', boxShadow: `inset 0 0 0 1.5px ${theme.colors.text.disabled}` }),
});

export interface NodeCellProps {
  node: SlurmNode;
  size: number;
  display: DisplayProcessor;
  shapeChannel: boolean;
  href?: string;
  /** Inside a rack a slot is wide and short — a 1U sled, not a square. */
  sled?: boolean;
}

/**
 * The second encoding, off by default. With it on the grid survives
 * greyscale, print, forced-colors and a red-green deficiency whatever
 * palette the site chose.
 */
function shapeFor(text: string): string | undefined {
  if (/not responding|drained|maintenance/.test(text)) {
    return 'polygon(0 0, 66% 0, 100% 34%, 100% 100%, 0 100%)';
  }
  if (/down/.test(text)) {
    return 'polygon(0 0, 100% 0, 100% 62%, 62% 100%, 0 100%, 0 38%)';
  }
  return undefined;
}

export function NodeCell({ node, size, display, shapeChannel, href, sled }: NodeCellProps) {
  const theme = useTheme2();
  const styles = getStyles(theme);
  const dv = display(node.state);
  const mapped = dv.percent === undefined;  // NOT a text comparison — see below

  return (
    <Tooltip content={<NodeTooltip node={node} />} placement="top" interactive>
      <button
        type="button"
        className={cx(styles.cell, !mapped && styles.unmapped)}
        data-testid={`node-cell-${node.name}`}
        data-state={node.state}
        data-mapped={mapped}
        aria-label={`${node.name}, ${dv.text}`}
        style={{
          width: sled ? 'auto' : size,
          alignSelf: sled ? 'stretch' : undefined,
          height: sled ? Math.max(5, Math.round(size / 2)) : size,
          background: mapped ? dv.color : undefined,
          clipPath: shapeChannel ? shapeFor(dv.text) : undefined,
        }}
        onClick={href ? () => window.open(href, '_self') : undefined}
      />
    </Tooltip>
  );
}
```

- [ ] **Step 7: Write the group header and the group**

`plugins/nodegrid-panel/src/components/GroupHeader.tsx`:

```tsx
import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useTheme2 } from '@grafana/ui';
import type { NodeGroup as NodeGroupModel } from '@slurm-views/core';

const getStyles = (theme: GrafanaTheme2) => ({
  // One line: a rail carrying the name, the count and the assumed marker.
  header: css({
    display: 'flex',
    alignItems: 'baseline',
    gap: theme.spacing(1),
    fontSize: theme.typography.bodySmall.fontSize,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    paddingBottom: theme.spacing(0.25),
  }),
  name: css({ fontFamily: theme.typography.fontFamilyMonospace, color: theme.colors.text.primary }),
  count: css({ color: theme.colors.text.secondary }),
  assumed: css({ color: theme.colors.warning.text, fontStyle: 'italic' }),
});

export function GroupHeader({ group }: { group: NodeGroupModel }) {
  const theme = useTheme2();
  const styles = getStyles(theme);
  return (
    <div className={styles.header}>
      <span className={styles.name}>{group.key}</span>
      <span className={styles.count}>{group.nodes.length} nodes</span>
      {/* Chunking invents structure. The claim stays visible in the panel,
          not only in the editor. */}
      {group.assumed && <span className={styles.assumed}>assumed</span>}
    </div>
  );
}
```

`plugins/nodegrid-panel/src/components/NodeGroup.tsx`:

```tsx
import React from 'react';
import { css } from '@emotion/css';
import type { DisplayProcessor, GrafanaTheme2 } from '@grafana/data';
import { useTheme2 } from '@grafana/ui';
import type { NodeGroup as NodeGroupModel } from '@slurm-views/core';
import { GroupHeader } from './GroupHeader';
import { NodeCell } from './NodeCell';
import type { PanelOptions } from '../types';

const getStyles = (theme: GrafanaTheme2, gap: number) => ({
  group: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(0.5) }),
  wrap: css({ display: 'flex', flexWrap: 'wrap', gap: `${gap}px` }),
});

export interface NodeGroupProps {
  group: NodeGroupModel;
  display: DisplayProcessor;
  options: PanelOptions;
}

export function NodeGroup({ group, display, options }: NodeGroupProps) {
  const theme = useTheme2();
  const styles = getStyles(theme, options.gap);

  const cells = group.nodes.map((node) => (
    <NodeCell
      key={node.name}
      node={node}
      size={options.cellSize}
      display={display}
      shapeChannel={options.shapeChannel}
    />
  ));

  return (
    <div className={styles.group} data-testid={`node-group-${group.key}`} data-layout={options.layout}>
      <GroupHeader group={group} />
      <div className={styles.wrap}>{cells}</div>
    </div>
  );
}
```

- [ ] **Step 8: Wire the group into the panel**

In `NodeGridPanel.tsx`, replace the inline cell rendering with:

```tsx
{model.groups.map((group) => (
  <NodeGroup key={group.key} group={group} display={display} options={options} />
))}
```

and add `import { NodeGroup } from './NodeGroup';`. The now-unused `cells` and `cell` style entries go with it — no dead code.

- [ ] **Step 9: Add the shape-channel option**

Add to the `Layout` category in `module.ts`:

```ts
.addBooleanSwitch({
  path: 'shapeChannel',
  name: 'Shape channel',
  description:
    'Carry state as a shape as well as a fill. Keeps the grid readable in greyscale, in print and with a colour-vision deficiency.',
  defaultValue: DEFAULT_OPTIONS.shapeChannel,
  category: ['Layout'],
})
```

Off by default so the panel looks like its neighbours; a site that puts it on a wall turns it on.

- [ ] **Step 10: Build, test, commit**

```bash
pnpm --filter tomzone-slurmnodegrid-panel test
pnpm --filter tomzone-slurmnodegrid-panel build
git add -A
git commit -m "feat(panel): add the node tooltip, group header and cell shape channel"
```

---

> **Why `percent` and not a text comparison.** Grafana returns early when a value
> mapping matches and never computes `percent`; an unmatched value falls through
> to the threshold path, which sets it. `DEFAULT_MAPPINGS` maps `idle` to the text
> `"idle"` — identical to its input — so `dv.text !== node.state` reports the
> commonest healthy state as *unmapped*. And with thresholds configured, which
> `useFieldConfig()` guarantees, a genuinely unmapped value takes the threshold
> base colour: green. The two together painted unknown states as healthy. This is
> pinned in `tests/contract/value-mappings.test.cjs`.

## Task 9: Rack layout

A rack slot is drawn wide and short because that is what a rack slot is. Drawing it square turns an elevation back into a list.

**Files:**
- Create: `plugins/nodegrid-panel/src/components/RackFrame.tsx`
- Modify: `plugins/nodegrid-panel/src/components/NodeGroup.tsx`
- Modify: `plugins/nodegrid-panel/src/components/NodeGridPanel.tsx`

**Interfaces:**
- Consumes: `NodeGroupProps` from Task 8.
- Produces: `interface RackFrameProps { children: React.ReactNode; width: number }`

- [ ] **Step 1: Write the rack frame**

`plugins/nodegrid-panel/src/components/RackFrame.tsx`:

```tsx
import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useTheme2 } from '@grafana/ui';

const getStyles = (theme: GrafanaTheme2, width: number) => ({
  rack: css({
    // column-reverse so slot 1 sits at the bottom, the way a rack is read.
    display: 'flex',
    flexDirection: 'column-reverse',
    flexWrap: 'nowrap',
    width,
    gap: 2,
    padding: theme.spacing(0.5),
    // A cabinet frame, heavier at the foot.
    border: `1px solid ${theme.colors.border.medium}`,
    borderBottomWidth: 3,
  }),
});

export interface RackFrameProps {
  children: React.ReactNode;
  width: number;
}

export function RackFrame({ children, width }: RackFrameProps) {
  const theme = useTheme2();
  return <div className={getStyles(theme, width).rack}>{children}</div>;
}
```

- [ ] **Step 2: Branch the group on layout**

In `NodeGroup.tsx`, pass `sled` to each cell and choose the container:

```tsx
const cells = group.nodes.map((node) => (
  <NodeCell
    key={node.name}
    node={node}
    size={options.cellSize}
    display={display}
    shapeChannel={options.shapeChannel}
    sled={options.layout === 'rack'}
  />
));

return (
  <div className={styles.group} data-testid={`node-group-${group.key}`} data-layout={options.layout}>
    <GroupHeader group={group} />
    {options.layout === 'rack' ? (
      <RackFrame width={Math.max(40, options.cellSize * 4)}>{cells}</RackFrame>
    ) : (
      <div className={styles.wrap}>{cells}</div>
    )}
  </div>
);
```

Add `import { RackFrame } from './RackFrame';`.

- [ ] **Step 3: Lay racks out side by side**

In `NodeGridPanel.tsx`, take the layout into the styles so racks sit in a row and wrapped groups stack:

```tsx
const getStyles = (theme: GrafanaTheme2, layout: PanelOptions['layout']) => ({
  wrap: css({
    height: '100%',
    overflow: 'auto',
    display: 'flex',
    flexDirection: layout === 'rack' ? 'row' : 'column',
    alignItems: layout === 'rack' ? 'flex-start' : 'stretch',
    flexWrap: layout === 'rack' ? 'wrap' : 'nowrap',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
  }),
  empty: css({ color: theme.colors.text.secondary, padding: theme.spacing(1) }),
});
```

and call it as `getStyles(theme, options.layout)`.

- [ ] **Step 4: Build**

```bash
pnpm --filter tomzone-slurmnodegrid-panel build
```

The dev stack does not exist until Task 12, so the visual check happens there. Note that in the commit body rather than claiming it was verified.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(panel): draw a group as a rack of 1U sleds"
```

---

## Task 10: Warnings and counts in the panel

Never paint a node healthy for lack of information, and never put the explanation somewhere nobody looks.

**Files:**
- Create: `plugins/nodegrid-panel/src/utils/unmapped.ts`
- Create: `plugins/nodegrid-panel/src/utils/unmapped.test.ts`
- Create: `plugins/nodegrid-panel/src/components/PanelWarnings.tsx`
- Modify: `plugins/nodegrid-panel/src/components/NodeGridPanel.tsx`, `src/module.ts`

**Interfaces:**
- Consumes: `IngestWarning`, `GroupedModel`, `SlurmNode` from core; `DisplayProcessor` from Grafana.
- Produces:
  - `function collectUnmapped(nodes: SlurmNode[], display: DisplayProcessor): string[]`
  - `function summarise(model: GroupedModel, warnings: IngestWarning[], unmapped: string[], maxCells: number): string[]`

- [ ] **Step 1: Write the failing test**

`plugins/nodegrid-panel/src/utils/unmapped.test.ts`:

```ts
import { collectUnmapped, summarise } from './unmapped';
import type { DisplayProcessor } from '@grafana/data';
import type { GroupedModel, SlurmNode } from '@slurm-views/core';

const node = (name: string, state: string): SlurmNode => ({
  name, state, partitions: [], labels: {}, facets: { gres: [] },
});

// Models Grafana's real shape rather than a convenient one: a matched mapping
// returns early and never sets `percent`; an unmatched value falls through to
// the threshold path, which does. `idle` maps to the text "idle" — identical to
// its input — which is exactly the case a text comparison gets wrong.
const display = ((value: unknown) =>
  value === 'idle'
    ? { text: 'idle', numeric: NaN }
    : { text: String(value), numeric: NaN, percent: 0 }
) as unknown as DisplayProcessor;

describe('collectUnmapped', () => {
  it('names the states that matched no mapping, once each', () => {
    const nodes = [node('c1', 'idle'), node('c2', 'perfctrs'), node('c3', 'perfctrs'), node('c4', 'blocked')];
    expect(collectUnmapped(nodes, display)).toEqual(['blocked', 'perfctrs']);
  });

  it('returns nothing when every state is mapped', () => {
    expect(collectUnmapped([node('c1', 'idle')], display)).toEqual([]);
  });

  it('does not report a state whose mapped text equals its own name', () => {
    // The regression this guards: `idle` maps to "idle", so a text comparison
    // calls the commonest healthy state unmapped and the panel warns about it.
    expect(collectUnmapped([node('c1', 'idle'), node('c2', 'perfctrs')], display))
      .toEqual(['perfctrs']);
  });

  it('ignores a node with no state at all, which is a different problem', () => {
    expect(collectUnmapped([node('c1', '')], display)).toEqual([]);
  });
});

describe('summarise', () => {
  const model = (nodeCount: number, slotCount: number): GroupedModel => ({
    groups: [], nodeCount, slotCount, duplicated: slotCount > nodeCount,
  });

  it('reports both counts when grouping duplicated nodes', () => {
    expect(summarise(model(20, 25), [], [], 3000)).toContain('20 nodes drawn in 25 slots');
  });

  it('says nothing about counts when they agree', () => {
    expect(summarise(model(20, 20), [], [], 3000)).toEqual([]);
  });

  it('names an unmapped state rather than only counting it', () => {
    expect(summarise(model(2, 2), [], ['perfctrs'], 3000))
      .toContain('1 state matched no value mapping: perfctrs');
  });

  it('pluralises several unmapped states', () => {
    expect(summarise(model(2, 2), [], ['blocked', 'perfctrs'], 3000))
      .toContain('2 states matched no value mapping: blocked, perfctrs');
  });

  it('caps the named list and says how many it held back', () => {
    // The panel clips its overflow, so an unbounded list eats the grid.
    const many = Array.from({ length: 12 }, (_, i) => `state${i}`);
    const line = summarise(model(2, 2), [], many, 3000)[0];
    expect(line).toContain('12 states matched no value mapping:');
    expect(line).toContain('and 4 more');
    expect(line).not.toContain('state8');
  });

  it('passes an ingest warning through with its refId', () => {
    expect(summarise(model(0, 0), [{ kind: 'no-identity', refId: 'B', detail: 'no node label or column' }], [], 3000))
      .toContain('Query B skipped: no node label or column');
  });

  it('warns past the cell threshold and suggests a filter', () => {
    expect(summarise(model(4000, 4000), [], [], 3000))
      .toContain('4000 cells exceeds 3000. Filter the query or split the view by region.');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter tomzone-slurmnodegrid-panel test unmapped
```

Expected: FAIL — `Cannot find module '../src/utils/unmapped'`.

- [ ] **Step 3: Write the utilities**

`plugins/nodegrid-panel/src/utils/unmapped.ts`:

```ts
import type { DisplayProcessor } from '@grafana/data';
import type { GroupedModel, IngestWarning, SlurmNode } from '@slurm-views/core';

/**
 * A state whose display text equals its raw value matched no mapping. Naming
 * these in the panel is how a state introduced by a Slurm upgrade becomes
 * visible instead of quietly grey.
 */
/**
 * How many unmapped states to name before summarising the rest. Enough to act
 * on, few enough to stay on one line in a panel that clips its overflow.
 */
const UNMAPPED_NAME_LIMIT = 8;

export function collectUnmapped(nodes: SlurmNode[], display: DisplayProcessor): string[] {
  const unmapped = new Set<string>();
  for (const node of nodes) {
    if (node.state === '') {
      continue;
    }
    // Grafana returns early when a value mapping matches and never computes
    // `percent`; an unmatched value falls through to the threshold path, which
    // sets it. Do not compare text: `idle` maps to "idle", a real match that
    // text comparison reports as a miss. Same signal as NodeCell.
    if (display(node.state).percent !== undefined) {
      unmapped.add(node.state);
    }
  }
  return [...unmapped].sort();
}

export function summarise(
  model: GroupedModel,
  warnings: IngestWarning[],
  unmapped: string[],
  maxCells: number
): string[] {
  const lines: string[] = [];

  if (model.duplicated) {
    // A count that silently disagrees with sinfo is worse than no count.
    lines.push(`${model.nodeCount} nodes drawn in ${model.slotCount} slots`);
  }

  if (unmapped.length > 0) {
    const noun = unmapped.length === 1 ? 'state' : 'states';
    // Name them rather than only counting, so a state introduced by a Slurm
    // upgrade is actionable — but cap the list. The panel's container is
    // overflow:hidden, and an unbounded line eats the grid it annotates. A real
    // cluster shows two or three unknown states and never reaches the cap; a
    // pathological one shows thirty and must not push the wall off screen.
    const shown = unmapped.slice(0, UNMAPPED_NAME_LIMIT);
    const rest = unmapped.length - shown.length;
    const named = rest > 0 ? `${shown.join(', ')}, and ${rest} more` : shown.join(', ');
    lines.push(`${unmapped.length} ${noun} matched no value mapping: ${named}`);
  }

  for (const warning of warnings) {
    lines.push(
      warning.kind === 'no-identity'
        ? `Query ${warning.refId ?? '?'} skipped: ${warning.detail}`
        : warning.detail
    );
  }

  if (model.slotCount > maxCells) {
    // Render what we have and say the view needs splitting, rather than
    // refusing or silently truncating.
    lines.push(`${model.slotCount} cells exceeds ${maxCells}. Filter the query or split the view by region.`);
  }

  return lines;
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
pnpm --filter tomzone-slurmnodegrid-panel test unmapped
```

Expected: PASS.

- [ ] **Step 5: Write the warnings strip**

`plugins/nodegrid-panel/src/components/PanelWarnings.tsx`:

```tsx
import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Icon, useTheme2 } from '@grafana/ui';

const getStyles = (theme: GrafanaTheme2) => ({
  strip: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.25),
    padding: theme.spacing(0.5, 1),
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.warning.text,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  line: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(0.5) }),
});

export function PanelWarnings({ lines }: { lines: string[] }) {
  const theme = useTheme2();
  const styles = getStyles(theme);
  if (lines.length === 0) {
    return null;
  }
  // In the panel, not in a console nobody opens.
  return (
    <div className={styles.strip} data-testid="panel-warnings" role="status">
      {lines.map((line) => (
        <div className={styles.line} key={line}>
          <Icon name="exclamation-triangle" size="sm" />
          <span>{line}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Render it**

In `NodeGridPanel.tsx`, add the imports and the two memos:

```tsx
import { collectUnmapped, summarise } from '../utils/unmapped';
import { PanelWarnings } from './PanelWarnings';

const { model, warnings, stateField } = useNodeModel(data, options);

const unmapped = useMemo(
  () => collectUnmapped(model.groups.flatMap((g) => g.nodes), display),
  [model.groups, display]
);
const lines = useMemo(
  () => summarise(model, warnings, unmapped, options.maxCells),
  [model, warnings, unmapped, options.maxCells]
);
```

Wrap the return so the strip sits above the scrolling area rather than inside it:

```tsx
return (
  <div className={styles.outer}>
    <PanelWarnings lines={lines} />
    <div className={styles.wrap} data-testid="slurm-node-grid">
      {model.groups.map((group) => (
        <NodeGroup key={group.key} group={group} display={display} options={options} />
      ))}
    </div>
  </div>
);
```

with `outer: css({ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' })` and `wrap` gaining `flex: 1, minHeight: 0`.

Add the threshold option to `module.ts` under `Layout`:

```ts
.addNumberInput({
  path: 'maxCells',
  name: 'Cell warning threshold',
  description: 'Past this the panel still renders, and says the view needs splitting.',
  defaultValue: DEFAULT_OPTIONS.maxCells,
  category: ['Layout'],
})
```

- [ ] **Step 7: Build, test, commit**

```bash
pnpm --filter tomzone-slurmnodegrid-panel test
pnpm --filter tomzone-slurmnodegrid-panel build
git add -A
git commit -m "feat(panel): surface skipped queries, unmapped states and overlap counts"
```

---

## Task 11: The grouping editor with a live preview

A regex typed blind into a panel option is one nobody can tell is wrong until the panel is empty.

**Files:**
- Create: `plugins/nodegrid-panel/src/editor/GroupingEditor.tsx`
- Modify: `plugins/nodegrid-panel/src/module.ts`

**Interfaces:**
- Consumes: `KeySource`, `makeKeyFn`, `ingest`, `UNGROUPED` from core; `PanelOptions`, `DEFAULT_MAPPINGS` from Task 7.
- Produces: two `StandardEditorProps` components, registered at option paths `grouping` and `resetMappings`.

- [ ] **Step 1: Write the grouping editor**

`plugins/nodegrid-panel/src/editor/GroupingEditor.tsx`:

```tsx
import React, { useMemo } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2, StandardEditorProps } from '@grafana/data';
import { Field, Input, RadioButtonGroup, useTheme2 } from '@grafana/ui';
import { ingest, makeKeyFn, UNGROUPED } from '@slurm-views/core';
import type { KeySource, MinimalFrame } from '@slurm-views/core';
import type { PanelOptions } from '../types';

const getStyles = (theme: GrafanaTheme2) => ({
  preview: css({
    marginTop: theme.spacing(1),
    padding: theme.spacing(1),
    background: theme.colors.background.secondary,
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  row: css({ display: 'flex', justifyContent: 'space-between', gap: theme.spacing(2) }),
  none: css({ color: theme.colors.warning.text }),
  assumed: css({ color: theme.colors.warning.text, fontStyle: 'italic' }),
});

type Props = StandardEditorProps<KeySource, unknown, PanelOptions>;

export function GroupingEditor({ value, onChange, context }: Props) {
  const theme = useTheme2();
  const styles = getStyles(theme);
  const source: KeySource = value ?? { kind: 'none' };
  const options = context.options;

  // The preview runs the real key function over the node names actually
  // present, so a pattern that matches nothing says so while it is typed.
  const preview = useMemo(() => {
    const series = context.data ?? [];
    if (series.length === 0 || !options) {
      return [];
    }
    const frames: MinimalFrame[] = series.map((frame) => ({
      refId: frame.refId,
      fields: frame.fields.map((f) => ({
        name: f.name,
        type: f.type,
        labels: f.labels,
        values: typeof (f.values as { toArray?: () => unknown[] }).toArray === 'function'
          ? (f.values as unknown as { toArray: () => unknown[] }).toArray()
          : (f.values as unknown as unknown[]),
      })),
    }));
    const { nodes } = ingest({ frames, slots: options.slots, labels: options.labels });
    const keyFn = makeKeyFn(source);
    return nodes.slice(0, 8).map((node) => ({ name: node.name, ...keyFn(node) }));
  }, [context.data, options, source]);

  return (
    <>
      <RadioButtonGroup
        value={source.kind}
        options={[
          { value: 'none', label: 'None' },
          { value: 'label', label: 'Label' },
          { value: 'capture', label: 'Capture' },
          { value: 'chunk', label: 'Chunk' },
        ]}
        onChange={(kind) => {
          if (kind === 'label') { onChange({ kind, label: 'partition' }); }
          else if (kind === 'capture') { onChange({ kind, pattern: '^(r\\d+)' }); }
          else if (kind === 'chunk') { onChange({ kind, size: 40 }); }
          else { onChange({ kind: 'none' }); }
        }}
      />

      {source.kind === 'label' && (
        <Field label="Label" description="A label the data already carries.">
          <Input value={source.label} onChange={(e) => onChange({ kind: 'label', label: e.currentTarget.value })} />
        </Field>
      )}

      {source.kind === 'capture' && (
        <Field label="Pattern" description="The first capture group becomes the key. Example: ^(r\d+)c\d+n\d+$">
          <Input value={source.pattern} onChange={(e) => onChange({ kind: 'capture', pattern: e.currentTarget.value })} />
        </Field>
      )}

      {source.kind === 'chunk' && (
        <Field
          label="Nodes per group"
          description="Slices the node ordinal. This invents structure, and every group it makes says so."
        >
          <Input
            type="number"
            value={source.size}
            onChange={(e) => onChange({ kind: 'chunk', size: Number.parseInt(e.currentTarget.value, 10) || 0 })}
          />
        </Field>
      )}

      {preview.length > 0 && (
        <div className={styles.preview} data-testid="grouping-preview">
          {preview.map((row) => (
            <div className={styles.row} key={row.name}>
              <span>{row.name}</span>
              <span className={row.key === UNGROUPED ? styles.none : row.assumed ? styles.assumed : undefined}>
                {row.key}
                {row.assumed ? ' (assumed)' : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 3: Register the grouping editor**

In `module.ts`, add a `Grouping` category and the reset button under `Data`:

```ts
.addCustomEditor({
  id: 'grouping',
  path: 'grouping',
  name: 'Group by',
  description: 'A label, a capture on the node name, or a chunk of its ordinal.',
  editor: GroupingEditor,
  defaultValue: DEFAULT_OPTIONS.grouping,
  category: ['Grouping'],
})
.addBooleanSwitch({
  path: 'multiValueLabel',
  name: 'Node may appear in several groups',
  description: 'Draw a node once per partition it belongs to. Only the partition label is supported: fanning out an arbitrary multi-valued label would need a per-node map of every value, which the engine does not build.',
  defaultValue: DEFAULT_OPTIONS.multiValueLabel,
  category: ['Grouping'],
})
```

with its import.

- [ ] **Step 4: Build and commit**

```bash
pnpm --filter tomzone-slurmnodegrid-panel build
pnpm --filter tomzone-slurmnodegrid-panel typecheck
git add -A
git commit -m "feat(panel): preview the grouping key against the nodes actually present"
```

---

## Task 12: Dev stack and the provisioned dashboard

Self-contained, pinned, and reaching states a 20-node docker cluster cannot produce.

**Files:**
- Create: `dev/docker-compose.yml`, `dev/.env.example`
- Create: `dev/synthetic-exporter/Dockerfile`, `dev/synthetic-exporter/serve.py`
- Create: `dev/prometheus/prometheus.yml`
- Create: `dev/provisioning/datasources/prometheus.yml`
- Create: `dev/provisioning/dashboards/dashboards.yml`
- Create: `dev/provisioning/dashboards/slurm-node-grid.json`
- Create: `dev/README.md`

**Interfaces:**
- Consumes: the built plugin at `plugins/nodegrid-panel/dist`.
- Produces: Grafana on `:3001` with the plugin loaded and one provisioned dashboard `slurm-node-grid`. Task 13 reads that dashboard as its fixture.

Port 3001 deliberately: `slurm_exporter`'s own stack already holds 3000.

- [ ] **Step 1: Write the synthetic exporter**

`dev/synthetic-exporter/serve.py` — the only way to reach `blocked`, `perfctrs` or all nine modifiers; a 20-node docker cluster cannot produce them:

```python
#!/usr/bin/env python3
"""Publish a synthetic Slurm cluster in the Prometheus text format.

Shape is set by environment variable, so one image covers a 240-node smoke
test and a 3000-node scale test:

    NODES=3000 RACKS=75 PARTITIONS=cpu,gpu,debug
"""
import os
import random
from http.server import BaseHTTPRequestHandler, HTTPServer

NODES = int(os.environ.get("NODES", "240"))
RACKS = int(os.environ.get("RACKS", "6"))
PARTITIONS = os.environ.get("PARTITIONS", "cpu,gpu,debug").split(",")
SEED = int(os.environ.get("SEED", "1"))

# Weighted so a healthy cluster looks healthy, with every awkward state present.
BASE_STATES = [
    "idle", "idle", "idle", "idle", "mixed", "mixed", "allocated",
    "drained", "draining", "down", "fail", "maint", "planned",
    "blocked", "perfctrs", "reserved", "completing", "inval",
]
MODIFIERS = ["", "", "", "", "", "*", "~", "#", "!", "%", "$", "@", "^", "-"]


def cluster():
    rng = random.Random(SEED)
    nodes = []
    per_rack = max(1, NODES // max(1, RACKS))
    for i in range(1, NODES + 1):
        rack = (i - 1) // per_rack + 1
        state = rng.choice(BASE_STATES) + rng.choice(MODIFIERS)
        parts = [PARTITIONS[i % len(PARTITIONS)]]
        if i % 7 == 0:
            parts.append("debug")
        nodes.append({
            "name": "r%03dn%04d" % (rack, i),
            "rack": "r%03d" % rack,
            "state": state,
            "partitions": sorted(set(parts)),
            "cpus": 128,
            "cpu_alloc": rng.choice([0, 16, 64, 128]),
            "mem": 512000,
            "mem_alloc": rng.choice([0, 64000, 256000]),
            "gpus": 8 if "gpu" in parts else 0,
            "gpu_used": rng.choice([0, 2, 8]) if "gpu" in parts else 0,
            "drained": state.startswith("drain"),
        })
    return nodes


NODES_CACHE = cluster()


def render():
    out = [
        "# HELP slurm_node_status Node state, one series per (node, partition).",
        "# TYPE slurm_node_status gauge",
    ]
    for n in NODES_CACHE:
        for p in n["partitions"]:
            out.append(
                'slurm_node_status{node="%s",partition="%s",status="%s",rack="%s"} 1'
                % (n["name"], p, n["state"], n["rack"])
            )
    for metric, key in (
        ("slurm_node_cpu_alloc", "cpu_alloc"),
        ("slurm_node_cpu_total", "cpus"),
        ("slurm_node_mem_alloc", "mem_alloc"),
        ("slurm_node_mem_total", "mem"),
    ):
        out.append("# TYPE %s gauge" % metric)
        for n in NODES_CACHE:
            for p in n["partitions"]:
                out.append('%s{node="%s",partition="%s"} %d' % (metric, n["name"], p, n[key]))

    out.append("# TYPE slurm_node_gres_used gauge")
    out.append("# TYPE slurm_node_gres_total gauge")
    for n in NODES_CACHE:
        if n["gpus"]:
            out.append('slurm_node_gres_used{node="%s",gres_type="gpu:model_a"} %d' % (n["name"], n["gpu_used"]))
            out.append('slurm_node_gres_total{node="%s",gres_type="gpu:model_a"} %d' % (n["name"], n["gpus"]))

    # No partition label on these two, which is the join the panel exists to do.
    out.append("# TYPE slurm_node_drain_reason_info gauge")
    out.append("# TYPE slurm_node_drain_since_timestamp_seconds gauge")
    for n in NODES_CACHE:
        if n["drained"]:
            out.append(
                'slurm_node_drain_reason_info{node="%s",reason="healthcheck: /scratch not mounted"} 1' % n["name"]
            )
            out.append('slurm_node_drain_since_timestamp_seconds{node="%s"} 1789000000' % n["name"])

    return "\n".join(out) + "\n"


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = render().encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; version=0.0.4")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    HTTPServer(("", 9341), Handler).serve_forever()
```

`dev/synthetic-exporter/Dockerfile`:

```dockerfile
FROM python:3.13-alpine
COPY serve.py /serve.py
EXPOSE 9341
CMD ["python3", "/serve.py"]
```

- [ ] **Step 2: Write the compose file**

`dev/docker-compose.yml`:

```yaml
services:
  grafana:
    # Pinned, never floating. `docker compose up -d` does not recreate a
    # running container when a tag moves, so a floating tag silently does not
    # move — slurm_exporter's own stack sat on 12.4.2 for nine days while
    # :latest was 13.2.1. A pinned version that is visibly bumped is honest.
    image: ${GRAFANA_IMAGE:-grafana/grafana}:${GRAFANA_VERSION:-13.2.1}
    ports:
      - '3001:3000'
    environment:
      GF_AUTH_ANONYMOUS_ENABLED: 'true'
      GF_AUTH_ANONYMOUS_ORG_ROLE: Admin
      GF_AUTH_BASIC_ENABLED: 'true'
      GF_DEFAULT_APP_MODE: development
      GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS: tomzone-slurmnodegrid-panel
    volumes:
      - ../plugins/nodegrid-panel/dist:/var/lib/grafana/plugins/tomzone-slurmnodegrid-panel
      - ./provisioning:/etc/grafana/provisioning
    depends_on:
      - prometheus

  prometheus:
    image: prom/prometheus:v3.2.1
    ports:
      - '9091:9090'
    volumes:
      - ./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro

  synthetic-exporter:
    build: ./synthetic-exporter
    environment:
      NODES: ${SYNTH_NODES:-240}
      RACKS: ${SYNTH_RACKS:-6}
```

`dev/prometheus/prometheus.yml`:

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: slurm_exporter
    static_configs:
      - targets: ['synthetic-exporter:9341']
```

`dev/.env.example`:

```ini
# Bump these deliberately, and say so in the commit.
GRAFANA_IMAGE=grafana/grafana
GRAFANA_VERSION=13.2.1

# Cluster shape. 3000 is the realistic ceiling for one panel.
SYNTH_NODES=240
SYNTH_RACKS=6
```

- [ ] **Step 3: Write the provisioning**

`dev/provisioning/datasources/prometheus.yml`:

```yaml
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    uid: slurm-views-prom
    access: proxy
    url: http://prometheus:9090
    isDefault: true
```

`dev/provisioning/dashboards/dashboards.yml`:

```yaml
apiVersion: 1
providers:
  - name: slurm-views
    folder: Slurm
    type: file
    allowUiUpdates: true
    options:
      path: /etc/grafana/provisioning/dashboards
```

- [ ] **Step 4: Write the dashboard**

`dev/provisioning/dashboards/slurm-node-grid.json` — the deliverable and the e2e fixture are the same artefact:

```json
{
  "uid": "slurm-node-grid",
  "title": "Slurm node grid",
  "tags": ["slurm"],
  "timezone": "browser",
  "schemaVersion": 39,
  "version": 1,
  "refresh": "30s",
  "time": { "from": "now-5m", "to": "now" },
  "panels": [
    {
      "id": 1,
      "type": "tomzone-slurmnodegrid-panel",
      "title": "Nodes by rack",
      "gridPos": { "h": 14, "w": 24, "x": 0, "y": 0 },
      "datasource": { "type": "prometheus", "uid": "slurm-views-prom" },
      "targets": [
        { "refId": "A", "expr": "slurm_node_status", "instant": true },
        { "refId": "B", "expr": "slurm_node_cpu_alloc", "instant": true },
        { "refId": "C", "expr": "slurm_node_cpu_total", "instant": true },
        { "refId": "D", "expr": "slurm_node_gres_used", "instant": true },
        { "refId": "E", "expr": "slurm_node_gres_total", "instant": true },
        { "refId": "F", "expr": "slurm_node_drain_reason_info", "instant": true },
        { "refId": "G", "expr": "time() - slurm_node_drain_since_timestamp_seconds", "instant": true }
      ],
      "options": {
        "labels": { "node": "node", "state": "status", "partition": "partition", "gresType": "gres_type", "reason": "reason" },
        "slots": { "state": "A", "cpuAlloc": "B", "cpuTotal": "C", "gresUsed": "D", "gresTotal": "E", "drainReason": "F", "drainSince": "G" },
        "grouping": { "kind": "label", "label": "rack" },
        "multiValueLabel": false,
        "layout": "rack",
        "cellSize": 14,
        "gap": 2,
        "shapeChannel": false,
        "colorMode": "state",
        "maxCells": 3000
      },
      "fieldConfig": {
        "defaults": {
          "mappings": [
            { "type": "regex", "options": { "pattern": "/^.*\\*$/", "result": { "text": "not responding", "color": "semi-dark-orange", "index": 0 } } },
            { "type": "regex", "options": { "pattern": "/^.*~$/", "result": { "text": "powered down", "color": "text", "index": 1 } } },
            { "type": "regex", "options": { "pattern": "/^idle.*-$/", "result": { "text": "idle, backfill", "color": "semi-dark-green", "index": 2 } } },
            { "type": "regex", "options": { "pattern": "/^idle.*$/", "result": { "text": "idle", "color": "green", "index": 3 } } },
            { "type": "regex", "options": { "pattern": "/^mixed.*-$/", "result": { "text": "mixed, backfill", "color": "semi-dark-blue", "index": 4 } } },
            { "type": "regex", "options": { "pattern": "/^mixed.*$/", "result": { "text": "mixed", "color": "blue", "index": 5 } } },
            { "type": "regex", "options": { "pattern": "/^alloc.*-$/", "result": { "text": "allocated, backfill", "color": "semi-dark-blue", "index": 6 } } },
            { "type": "regex", "options": { "pattern": "/^alloc.*$/", "result": { "text": "allocated", "color": "dark-blue", "index": 7 } } },
            { "type": "regex", "options": { "pattern": "/^drain.*$/", "result": { "text": "drained", "color": "yellow", "index": 8 } } },
            { "type": "regex", "options": { "pattern": "/^(down|fail).*$/", "result": { "text": "down", "color": "red", "index": 9 } } },
            { "type": "regex", "options": { "pattern": "/^maint.*$/", "result": { "text": "maintenance", "color": "purple", "index": 10 } } }
          ]
        },
        "overrides": []
      }
    }
  ]
}
```

- [ ] **Step 5: Write dev/README.md**

````markdown
# Development stack

Self-contained. Grafana, Prometheus and a synthetic Slurm exporter.

```bash
cp dev/.env.example dev/.env
pnpm --filter tomzone-slurmnodegrid-panel build
docker compose -f dev/docker-compose.yml up -d --build
```

Grafana on <http://localhost:3001>, dashboard **Slurm / Slurm node grid**.
Port 3001 because `slurm_exporter`'s own stack holds 3000.

## Two data sources

**Synthetic** (default) produces any cluster shape on demand, including the
states a 20-node docker cluster cannot reach — `blocked`, `perfctrs`, and all
nine state modifiers:

```bash
SYNTH_NODES=3000 SYNTH_RACKS=75 docker compose -f dev/docker-compose.yml up -d
```

**Real** points at the `slurm_exporter` test cluster instead. Start it with
`make -C <slurm_exporter>/scripts/testing setup`, then change the Prometheus
scrape target to that cluster's exporter. Drive it with the targets that repo
already ships: `workload N=`, `node-fail`, `node-restore`, `cancel-all`,
`gpu-workers`. Neither path modifies the `slurm_exporter` repository.

## Grafana version

Pinned in `.env`, never floating. `docker compose up -d` does not recreate a
running container when a tag moves, so `:latest` silently stays where it was.
Bump `GRAFANA_VERSION` deliberately and say so in the commit. CI uses the same
two variables.
````

- [ ] **Step 6: Bring it up and look at it**

```bash
pnpm --filter tomzone-slurmnodegrid-panel build
cp dev/.env.example dev/.env
docker compose -f dev/docker-compose.yml up -d --build
curl -sf --retry 30 --retry-delay 2 http://localhost:3001/api/health
```

Open <http://localhost:3001/d/slurm-node-grid>. Check by eye — the validator checks colour, not layout:

- racks read bottom-up as wide short sleds inside a frame, not as stacked squares
- state colours differ per state, which is the first sign `useFieldConfig()` is wired
- a `drained` node's tooltip carries its reason and its age
- the warnings strip names the unmapped states (`perfctrs`, `blocked`, `inval` are all in the synthetic set)
- the panel does not scroll horizontally at a narrow width

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(dev): add the Grafana stack, synthetic exporter and provisioned dashboard"
```

---

## Task 13: End-to-end tests and CI

The two defects worth designing tests around are both invisible to unit tests: a missing `useFieldConfig()` that paints every cell identically, and an ingest path blind to the shape Prometheus returns.

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/nodegrid.spec.ts`
- Create: `.github/workflows/ci.yml`
- Modify: root `package.json`

**Interfaces:**
- Consumes: the dashboard provisioned in Task 12, read by `readProvisionedDashboard`.
- Produces: `pnpm e2e`; a CI matrix over the Grafana versions `plugin-actions/e2e-version` resolves.

- [ ] **Step 1: Add the dependencies and scripts**

```bash
pnpm add -Dw @grafana/plugin-e2e@^3.12.0 @playwright/test@^1.49.0
```

Add to the root `package.json` scripts:

```json
{
  "e2e": "playwright test",
  "e2e:install": "playwright install --with-deps chromium"
}
```

- [ ] **Step 2: Write the Playwright config**

`playwright.config.ts`:

```ts
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import { defineConfig, devices } from '@playwright/test';
import type { PluginOptions } from '@grafana/plugin-e2e';

const require = createRequire(import.meta.url);
const pluginE2eAuth = `${dirname(require.resolve('@grafana/plugin-e2e'))}/auth`;

export default defineConfig<PluginOptions>({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.GRAFANA_URL ?? 'http://localhost:3001',
    trace: 'on-first-retry',
    // Where the provisioned files live, for readProvisionedDashboard.
    provisioningRootDir: 'dev/provisioning',
  },
  projects: [
    { name: 'auth', testDir: pluginE2eAuth, testMatch: [/.*\.js/] },
    {
      name: 'run-tests',
      use: {
        ...devices['Desktop Chrome'],
        // @grafana/plugin-e2e writes the auth state here; the path is fixed.
        storageState: 'playwright/.auth/admin.json',
      },
      dependencies: ['auth'],
    },
  ],
});
```

- [ ] **Step 3: Write the specs**

`tests/e2e/nodegrid.spec.ts`:

```ts
import { expect, test } from '@grafana/plugin-e2e';

test.describe('the node grid renders against a real Grafana', () => {
  test('draws one cell per node from the provisioned dashboard', async ({
    gotoDashboardPage, readProvisionedDashboard, page,
  }) => {
    const dashboard = await readProvisionedDashboard({ fileName: 'slurm-node-grid.json' });
    await gotoDashboardPage(dashboard);

    await expect(page.getByTestId('slurm-node-grid')).toBeVisible();
    const cells = page.locator('[data-testid^="node-cell-"]');
    await expect.poll(() => cells.count(), { timeout: 15_000 }).toBeGreaterThan(10);
  });

  test('paints different states different colours', async ({
    gotoDashboardPage, readProvisionedDashboard, page,
  }) => {
    // This is the useFieldConfig() test. Without that call in module.ts the
    // Value mappings never reach the field and every cell comes out the same
    // colour — which no unit test can see.
    const dashboard = await readProvisionedDashboard({ fileName: 'slurm-node-grid.json' });
    await gotoDashboardPage(dashboard);

    const mapped = page.locator('[data-testid^="node-cell-"][data-mapped="true"]');
    await expect.poll(() => mapped.count(), { timeout: 15_000 }).toBeGreaterThan(10);

    const colours = await mapped.evaluateAll((nodes) =>
      Array.from(new Set(nodes.map((n) => getComputedStyle(n).backgroundColor)))
    );
    expect(colours.length).toBeGreaterThan(2);
  });

  test('spells a state suffix out in words in the tooltip', async ({
    gotoDashboardPage, readProvisionedDashboard, page,
  }) => {
    const dashboard = await readProvisionedDashboard({ fileName: 'slurm-node-grid.json' });
    await gotoDashboardPage(dashboard);

    const cells = page.locator('[data-testid^="node-cell-"]');
    await expect.poll(() => cells.count(), { timeout: 15_000 }).toBeGreaterThan(0);

    await cells.first().hover();
    await expect(page.getByText('State', { exact: true })).toBeVisible();
  });

  test('names the states that matched no mapping', async ({
    gotoDashboardPage, readProvisionedDashboard, page,
  }) => {
    // The synthetic exporter emits perfctrs, blocked and inval, none of which
    // the shipped mappings cover. They must be named, not quietly grey.
    const dashboard = await readProvisionedDashboard({ fileName: 'slurm-node-grid.json' });
    await gotoDashboardPage(dashboard);

    const strip = page.getByTestId('panel-warnings');
    await expect(strip).toBeVisible({ timeout: 15_000 });
    await expect(strip).toContainText('matched no value mapping');
  });
});

test.describe('the options editor', () => {
  test('exposes the standard sections, which proves useFieldConfig is wired', async ({
    panelEditPage, readProvisionedDataSource, page,
  }) => {
    const ds = await readProvisionedDataSource({ fileName: 'prometheus.yml' });
    await panelEditPage.datasource.set(ds.name);
    await panelEditPage.setVisualization('Slurm node grid');

    await expect(page.getByRole('button', { name: /Value mappings/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /Standard options/i })).toBeVisible();
  });

  test('previews the grouping key against the nodes present', async ({
    gotoDashboardPage, readProvisionedDashboard, page,
  }) => {
    const dashboard = await readProvisionedDashboard({ fileName: 'slurm-node-grid.json' });
    const dashboardPage = await gotoDashboardPage(dashboard);
    await dashboardPage.getPanelByTitle('Nodes by rack').edit();

    await expect(page.getByTestId('grouping-preview')).toBeVisible({ timeout: 15_000 });
  });
});
```

- [ ] **Step 4: Run them against the running stack**

```bash
pnpm e2e:install
docker compose -f dev/docker-compose.yml up -d --build
curl -sf --retry 30 --retry-delay 2 http://localhost:3001/api/health
pnpm e2e
```

Expected: PASS. If the colour test reports one distinct colour, `useFieldConfig()` is missing from `module.ts` — that is the defect this test exists to catch, so fix `module.ts` rather than the test.

- [ ] **Step 5: Write the CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:
  build:
    name: Build and unit test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
      - name: Check React 19 compatibility
        run: npx -y @grafana/react-detect@latest

  resolve-versions:
    name: Resolve Grafana images
    runs-on: ubuntu-latest
    timeout-minutes: 3
    outputs:
      matrix: ${{ steps.resolve-versions.outputs.matrix }}
    steps:
      - uses: actions/checkout@v4
      - id: resolve-versions
        uses: grafana/plugin-actions/e2e-version@main

  e2e:
    name: e2e ${{ matrix.GRAFANA_IMAGE.name }}@${{ matrix.GRAFANA_IMAGE.VERSION }}
    needs: [build, resolve-versions]
    runs-on: ubuntu-latest
    timeout-minutes: 30
    strategy:
      fail-fast: false
      matrix:
        GRAFANA_IMAGE: ${{ fromJson(needs.resolve-versions.outputs.matrix) }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm exec playwright install --with-deps chromium
      - name: Start Grafana
        run: |
          GRAFANA_VERSION=${{ matrix.GRAFANA_IMAGE.VERSION }} \
          GRAFANA_IMAGE=${{ matrix.GRAFANA_IMAGE.NAME }} \
          docker compose -f dev/docker-compose.yml up -d --build
      - uses: grafana/plugin-actions/wait-for-grafana@main
        with:
          url: http://localhost:3001/login
      - run: pnpm e2e
      - uses: actions/upload-artifact@v4
        if: ${{ failure() }}
        with:
          name: playwright-report-${{ matrix.GRAFANA_IMAGE.VERSION }}
          path: playwright-report/
          retention-days: 7
```

This matrix is the mechanism that catches a break on a new Grafana before a user does.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test: run the panel end to end across the supported Grafana versions"
```

---

## Task 14: Colour modes and data links

The two loose ends Task 7 left in the options type. An option that silently does nothing is worse than a missing one, so these are wired before the slice is called done.

**Files:**
- Create: `plugins/nodegrid-panel/src/utils/colorMode.ts`
- Create: `plugins/nodegrid-panel/src/utils/colorMode.test.ts`
- Modify: `plugins/nodegrid-panel/src/components/NodeGridPanel.tsx`, `NodeCell.tsx`, `NodeGroup.tsx`, `src/module.ts`

**Interfaces:**
- Consumes: `SlurmNode`, `ColorMode` from Task 7; `NodeCellProps` and `NodeGroupProps` from Task 8.
- Produces:
  - `function fractionFor(node: SlurmNode, mode: ColorMode): number | undefined`
  - a changed `NodeCellProps`: the `display` prop of Task 8 becomes
    `stateDisplay: DisplayProcessor`, joined by `valueDisplay: DisplayProcessor`
    and `colorMode: ColorMode`. `NodeGroupProps` carries the same three through.
    Rename every call site; leaving both names alive is how one of them rots.

- [ ] **Step 1: Write the failing test**

`plugins/nodegrid-panel/src/utils/colorMode.test.ts`:

```ts
import { fractionFor } from './colorMode';
import type { SlurmNode } from '@slurm-views/core';

const node = (facets: Partial<SlurmNode['facets']>): SlurmNode => ({
  name: 'c1', state: 'mixed', partitions: [], labels: {},
  facets: { gres: [], ...facets },
});

describe('fractionFor', () => {
  it('returns nothing in state mode, which is not a continuous scale', () => {
    expect(fractionFor(node({ cpuAlloc: 64, cpuTotal: 128 }), 'state')).toBeUndefined();
  });

  it('reads CPU allocation as a percentage', () => {
    expect(fractionFor(node({ cpuAlloc: 64, cpuTotal: 128 }), 'cpu')).toBe(50);
  });

  it('reads memory allocation as a percentage', () => {
    expect(fractionFor(node({ memAlloc: 128000, memTotal: 512000 }), 'mem')).toBe(25);
  });

  it('sums GRES across models rather than picking one', () => {
    const n = node({ gres: [{ type: 'gpu:model_a', used: 2, total: 4 }, { type: 'gpu:model_b', used: 2, total: 4 }] });
    expect(fractionFor(n, 'gres')).toBe(50);
  });

  it('returns nothing when the total is missing', () => {
    expect(fractionFor(node({ cpuAlloc: 64 }), 'cpu')).toBeUndefined();
  });

  it('returns nothing rather than Infinity when the total is zero', () => {
    expect(fractionFor(node({ cpuAlloc: 0, cpuTotal: 0 }), 'cpu')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter tomzone-slurmnodegrid-panel test colorMode
```

Expected: FAIL — `Cannot find module '../src/utils/colorMode'`.

- [ ] **Step 3: Write it**

`plugins/nodegrid-panel/src/utils/colorMode.ts`:

```ts
import type { SlurmNode } from '@slurm-views/core';
import type { ColorMode } from '../types';

/**
 * The continuous value a non-state colour mode drives, as a percentage, so
 * Grafana's thresholds resolve it the way they resolve any other gauge.
 * Returns undefined when the node has nothing to say, which keeps a node with
 * no data distinguishable from one at 0%.
 */
export function fractionFor(node: SlurmNode, mode: ColorMode): number | undefined {
  const ratio = (used: number | undefined, total: number | undefined): number | undefined =>
    total === undefined || total <= 0 || used === undefined ? undefined : (used / total) * 100;

  switch (mode) {
    case 'cpu':
      return ratio(node.facets.cpuAlloc, node.facets.cpuTotal);
    case 'mem':
      return ratio(node.facets.memAlloc, node.facets.memTotal);
    case 'gres': {
      if (node.facets.gres.length === 0) {
        return undefined;
      }
      // Summed across models: a node with two GPU models has one occupancy,
      // not two competing ones.
      const used = node.facets.gres.reduce((sum, g) => sum + (g.used ?? 0), 0);
      const total = node.facets.gres.reduce((sum, g) => sum + (g.total ?? 0), 0);
      return ratio(used, total);
    }
    case 'state':
    default:
      return undefined;
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
pnpm --filter tomzone-slurmnodegrid-panel test colorMode
```

Expected: PASS.

- [ ] **Step 5: Drive the cell colour from the mode**

In `NodeGridPanel.tsx`, build a second display processor for the continuous case and hand the cell a resolved colour rather than a processor. Replace the `display` memo with:

```tsx
const stateDisplay = useMemo(() => {
  const base: Field = stateField ?? ({
    name: options.labels.state, type: FieldType.string, values: [], config: {},
  } as unknown as Field);
  return getDisplayProcessor({ field: { ...base, config: fieldConfig.defaults }, theme });
}, [stateField, fieldConfig.defaults, options.labels.state, theme]);

// Thresholds, not our own scale.
const valueDisplay = useMemo(
  () => getDisplayProcessor({
    field: {
      name: options.colorMode, type: FieldType.number, values: [],
      config: { ...fieldConfig.defaults, unit: 'percent', min: 0, max: 100 },
    } as unknown as Field,
    theme,
  }),
  [fieldConfig.defaults, options.colorMode, theme]
);
```

Pass both down through `NodeGroup` into `NodeCell`, and in `NodeCell` choose:

```tsx
const fraction = fractionFor(node, colorMode);
const dv = stateDisplay(node.state);
const mapped = dv.percent === undefined;  // NOT a text comparison — see below
// One encoding at a time: state as a fill, or utilisation as a fill. A cell
// carrying both reads well at 200 nodes and turns to noise at 2000.
const background =
  colorMode === 'state'
    ? (mapped ? dv.color : undefined)
    : (fraction === undefined ? undefined : valueDisplay(fraction).color);
```

The `aria-label` keeps naming the state in words in every mode, so meaning never rests on colour alone.

- [ ] **Step 6: Add the colour-mode option and the data link**

In `module.ts`, under `Display`:

```ts
.addRadio({
  path: 'colorMode',
  name: 'Colour by',
  description: 'One encoding at a time. Continuous modes are driven by Thresholds.',
  defaultValue: DEFAULT_OPTIONS.colorMode,
  settings: {
    options: [
      { value: 'state', label: 'State' },
      { value: 'cpu', label: 'CPU' },
      { value: 'mem', label: 'Memory' },
      { value: 'gres', label: 'GPU' },
    ],
  },
  category: ['Display'],
})
```

For click-through, use the Data links the field config already carries. In `NodeGridPanel.tsx`, interpolate the first link per node and hand `NodeCell` an `href`:

```tsx
import { getTemplateSrv } from '@grafana/runtime';

const linkTemplate = fieldConfig.defaults.links?.[0]?.url;
const hrefFor = useCallback(
  (node: SlurmNode): string | undefined =>
    linkTemplate === undefined
      ? undefined
      : getTemplateSrv().replace(linkTemplate, {
          __node: { text: node.name, value: node.name },
          __state: { text: node.state, value: node.state },
        }),
  [linkTemplate]
);
```

Document the two variables (`${__node}`, `${__state}`) in the plugin README — a data link the user cannot address is not a feature.

- [ ] **Step 7: Verify in the dev stack**

```bash
pnpm --filter tomzone-slurmnodegrid-panel test
pnpm --filter tomzone-slurmnodegrid-panel build
docker compose -f dev/docker-compose.yml restart grafana
```

Switch **Colour by** to CPU and confirm the grid re-colours from Thresholds; add a data link `/d/some-dash?var-node=${__node}` and confirm a click navigates.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(panel): colour by utilisation and follow a data link per node"
```

---

## Task 15: Documentation

**Files:**
- Create: `README.md`, `CONTRIBUTING.md`, `docs/value-mappings.md`
- Create: `plugins/nodegrid-panel/src/README.md`

**Interfaces:**
- Consumes: everything shipped.
- Produces: nothing code depends on.

- [ ] **Step 1: Write the repository README**

`README.md` — lead with the measured fact, because it is the argument:

````markdown
# slurm-views

Grafana panels for reading a Slurm cluster per node rather than in aggregate.

`slurm_exporter` publishes one series per `(node, partition)` pair:

```
slurm_node_status{node="c1",partition="cpu",status="mixed-"} 1
```

On a 20-node test cluster that is **25 series for 20 nodes** — `c1` belongs to
`cpu`, `debug` and `high`, so it appears three times. A `stat` panel counting
series reports 25 nodes. And no stock panel can join
`slurm_node_drain_reason_info{node,reason}`, which carries no `partition`
label at all, so the reason a node is drained cannot be shown beside its state.

The value of this panel is the join and the density, not new data.

## What is here

| | |
|---|---|
| `plugins/nodegrid-panel` | `tomzone-slurmnodegrid-panel` — one cell per node |
| `packages/core` | the engine: ingest, state parsing, grouping. No Grafana import |
| `dev/` | a self-contained Grafana + Prometheus + synthetic exporter stack |

## Getting started

See [`dev/README.md`](dev/README.md).

## Licence

Apache-2.0.
````

- [ ] **Step 2: Write the value-mappings note**

`docs/value-mappings.md` — the thing an operator will get wrong, written down once:

````markdown
# Value mappings for Slurm states

The panel ships a starting set of mappings and then gets out of the way: state
colour is Grafana's **Value mappings**, edited in the panel like any other.

Two traps make hand-written rules fail silently. Both were found by running
`getDisplayProcessor`, not by reading about it.

## Delimit the pattern

Grafana compiles a value-mapping pattern with `stringToJsRegex`, which wraps
anything not delimited by slashes in `^...$`:

| Typed | Compiled | Matches |
|---|---|---|
| `^idle` | `/^^idle$/` | `idle` only — **not** `idle*` |
| `^down\|^fail` | `/^^down\|^fail$/` | inconsistent: branch 1 a prefix, branch 2 exact |
| `/^idle/` | `/^idle/` | `idle`, `idle*`, `idle~` — the prefix rule intended |

A rule typed as `^idle` stops being a prefix rule without saying so, and a node
the controller cannot reach goes back to reading as healthy.

## Span the whole value

A regex mapping **replaces the matched portion**; it does not label the value.
Whatever the pattern did not consume stays glued to the result:

| Pattern | Result text | `drained` renders as |
|---|---|---|
| `/^drain/` | `drained` | `draineded` |
| `/^drain.*$/` | `drained` | `drained` |

## Order

Specific before general. A modifier rule must come before the base rule that
would otherwise swallow it — `/^idle.*$/` placed above `/^.*\*$/` swallows
`idle*`.

## The shipped set

See `plugins/nodegrid-panel/src/defaults/mappings.ts`, or copy them from the
provisioned dashboard at `dev/provisioning/dashboards/slurm-node-grid.json` —
its panel already carries them. There is no button that writes these for you:
a custom option editor receives a `StandardEditorContext`, which has no
`onFieldConfigChange`, so the panel cannot seed its own
`fieldConfig.defaults.mappings`. States matching nothing keep their raw text;
with thresholds always configured, Grafana would otherwise colour them with
the threshold base colour — green — so the panel refuses that colour and
draws a hollow ring instead, and names the state in its warnings strip so a
state introduced by a Slurm upgrade is visible.
````

- [ ] **Step 3: Write CONTRIBUTING.md**

Cover, each in a short section: Node >= 22 and pnpm >= 11 with the reason; `pnpm install` / `pnpm test` / `pnpm build` / `pnpm e2e`; that `packages/core` imports nothing from Grafana and why (it keeps the engine testable under plain Node and the panel thin); that a bug fix lands with a test that fails before it and passes after; Conventional Commits; that the Grafana image is pinned and bumped deliberately, never floated; and that the supply-chain controls in `pnpm-workspace.yaml` are not to be relaxed to make an install pass.

- [ ] **Step 4: Write the plugin README**

`plugins/nodegrid-panel/src/README.md` ships inside the plugin and is what a user reads on Grafana's plugin page. Cover: the required `state` query and the optional facet slots with their PromQL; the three grouping sources, with the warning that chunking invents structure and marks its groups **assumed**; the `${__node}` and `${__state}` data-link variables; and a link to the value-mappings note.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: document the panel, the dev stack and the value-mapping traps"
```

---

## Self-review

**Spec coverage.** Every section of the spec maps to a task:

| Spec section | Task |
|---|---|
| Toolchain and compatibility | 1, 7 |
| Architecture | 1, 3 |
| Data contract | 3 |
| Reading a Slurm state | 4 |
| Colour and options — the Grafana way | 2, 7, 11, 15 |
| The string-field assumption | 2 |
| The shape channel | 8 |
| Grouping, rack fidelity levels 1–2 | 5, 6, 9, 11 |
| Rendering and interaction | 7, 8, 9, 14 |
| Scale | 10 |
| Error handling | 3, 10 |
| Verification | 3–6, 13 |
| Development environment | 12 |
| Supply chain | 1 |

**Deliberately not covered**, matching the spec's Out list: named views (slice 1bis), `slurmrestd` and anything job-level, U-accurate rack elevation (level 3), write operations, `sacct` history.

**Two things to watch while executing.**

1. Three API surfaces are asserted rather than verified, and each carries an inline check before use: `PanelPlugin.setNoPadding` vs `setNoPaddingOption` (Task 7 Step 8), `context.onFieldConfigChange` on `StandardEditorContext` (Task 11 Step 2), and `provisioningRootDir` in the `plugin-e2e` `use` block (Task 13 Step 2). If any is absent in `@grafana/data` 12.3 or `plugin-e2e` 3.12, the task says what to do instead. Do not paper over a missing API with a cast.
2. `frame.values.toArray()` was removed from `DataFrame` in newer Grafana; the guard in `useNodeModel` and `GroupingEditor` handles both. If the build's types reject the guard, drop it and read `f.values` directly — it is an array on 12.3+.

**Not in this plan, on purpose.** Plugin signing and catalog submission. The dev stack loads the plugin unsigned, which is correct for slice 1; signing is a release concern and belongs with the first tagged version, not with the first working panel.
