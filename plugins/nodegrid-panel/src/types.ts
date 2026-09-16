import type { KeySource, LabelNames, QueryBindings } from '@slurm-views/core';

export type Layout = 'wrap' | 'rack';
export type ColorMode = 'state' | 'cpu' | 'mem' | 'gres';

export interface PanelOptions {
  labels: LabelNames;
  queries: QueryBindings;
  grouping: KeySource;
  multiValueLabel: boolean;
  layout: Layout;
  /** Cell width in pixels. */
  cellWidth: number;
  /**
   * Cell height in pixels. Optional on purpose: the two layouts disagree about
   * the natural shape of a cell, so an unset height derives what that layout
   * already drew — a square in Wrap, a sled in Rack.
   */
  cellHeight?: number;
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
  /**
   * How many slots — chassis positions, not nodes and not rack units — a
   * cabinet is drawn with. Optional on purpose: an unset height levels every
   * cabinet to the tallest one drawn, which is what stops a short rack
   * hanging from the ceiling without anyone declaring anything.
   */
  slotsPerRack?: number;
  /**
   * One line per declaration: a hostlist of group names, a colon, a slot
   * count. Overrides slotsPerRack for the groups it names.
   */
  slotOverrides: string;
  gap: number;
  shapeChannel: boolean;
  colorMode: ColorMode;
}

export const DEFAULT_OPTIONS: PanelOptions = {
  labels: { node: 'node', state: 'status', partition: 'partition', gresType: 'gres_type', reason: 'reason' },
  queries: { state: 'A' },
  grouping: { kind: 'none' },
  multiValueLabel: false,
  layout: 'wrap',
  // 10px is the honest floor: below it a notch stops being legible and a cell
  // stops being a usable hover target.
  cellWidth: 14,
  // cellHeight is deliberately absent. See the type.
  // 1, not 0 and not a flag: "one node per blade" is a true statement about
  // most clusters, and the drawing it produces is the one the panel already
  // produced. A reader who never opens the option sees no change.
  nodesPerBlade: 1,
  bladeOverrides: '',
  // slotsPerRack is deliberately absent, the same way cellHeight is: an empty
  // field is a real state — "level to the tallest" — rather than a sentinel.
  slotOverrides: '',
  gap: 2,
  shapeChannel: false,
  colorMode: 'state',
};
