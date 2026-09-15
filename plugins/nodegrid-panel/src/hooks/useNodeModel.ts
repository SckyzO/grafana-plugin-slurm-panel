import { useMemo } from 'react';
import { FieldType } from '@grafana/data';
import type { DataFrame, Field, InterpolateFunction, PanelData } from '@grafana/data';
import { buildGroups, declaredKeys, ingest, parseRangeTable } from '@slurm-views/core';
import type { GroupedModel, IngestWarning, KeySource, MinimalFrame } from '@slurm-views/core';
import { groupingNotes } from '../utils/warnings';
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

    const grouping = groupingNotes({
      model,
      nodes,
      source,
      table,
      nodeLabel: options.labels.node,
      stateLabel: options.labels.state,
    });

    const stateFrame = data.series.find((f) => f.refId === options.slots.state);
    const stateField =
      stateFrame?.fields.find((f) => f.name === options.labels.state) ??
      stateFrame?.fields.find((f) => f.type === FieldType.string);

    return { model, warnings, stateField, grouping };
  }, [data.series, options, replaceVariables]);
}
