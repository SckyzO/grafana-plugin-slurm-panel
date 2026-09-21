import { fractionFor } from './colorMode';
import type { SlurmNode } from '@slurm-views/core';

const node = (facets: Partial<SlurmNode['facets']>): SlurmNode => ({
  name: 'c1',
  state: 'mixed',
  partitions: [],
  labels: {},
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
    const n = node({
      gres: [
        { type: 'gpu:model_a', used: 2, total: 4 },
        { type: 'gpu:model_b', used: 2, total: 4 },
      ],
    });
    expect(fractionFor(n, 'gres')).toBe(50);
  });

  it('returns nothing when the total is missing', () => {
    expect(fractionFor(node({ cpuAlloc: 64 }), 'cpu')).toBeUndefined();
  });

  it('returns nothing rather than Infinity when the total is zero', () => {
    expect(fractionFor(node({ cpuAlloc: 0, cpuTotal: 0 }), 'cpu')).toBeUndefined();
  });
});
