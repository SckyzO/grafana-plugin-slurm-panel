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
    // nodeCount and slotCount deliberately differ here: with both at 4000 the
    // assertion below cannot tell whether the code compares slotCount or
    // nodeCount against maxCells. slotCount (4000) exceeds it; nodeCount
    // (2000) does not.
    expect(summarise(model(2000, 4000), [], [], 3000))
      .toContain('4000 cells exceeds 3000. Filter the query or split the view by region.');
  });
});
