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
