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
