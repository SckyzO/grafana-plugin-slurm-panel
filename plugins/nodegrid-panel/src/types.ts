import type { KeySource, LabelNames, SlotBindings } from '@slurm-views/core';

export type Layout = 'wrap' | 'rack';
export type ColorMode = 'state' | 'cpu' | 'mem' | 'gres';

export interface PanelOptions {
  labels: LabelNames;
  slots: SlotBindings;
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
  gap: number;
  shapeChannel: boolean;
  colorMode: ColorMode;
}

export const DEFAULT_OPTIONS: PanelOptions = {
  labels: { node: 'node', state: 'status', partition: 'partition', gresType: 'gres_type', reason: 'reason' },
  slots: { state: 'A' },
  grouping: { kind: 'none' },
  multiValueLabel: false,
  layout: 'wrap',
  // 10px is the honest floor: below it a notch stops being legible and a cell
  // stops being a usable hover target.
  cellWidth: 14,
  // cellHeight is deliberately absent. See the type.
  gap: 2,
  shapeChannel: false,
  colorMode: 'state',
};
