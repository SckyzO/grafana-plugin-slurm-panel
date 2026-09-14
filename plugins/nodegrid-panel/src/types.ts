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
