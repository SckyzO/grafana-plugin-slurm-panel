import React from 'react';
import { render, screen } from '@testing-library/react';
import { FieldType } from '@grafana/data';
import type { DataFrame, RegistryItem, StandardEditorContext } from '@grafana/data';
import type { KeySource } from '@slurm-views/core';
import { GroupingEditor } from './GroupingEditor';
import { DEFAULT_OPTIONS } from '../types';
import type { PanelOptions } from '../types';

// Table-format frame: one string column per label, one row per node — the
// same shape `toSamples` reads when a query returns node/status/partition as
// columns rather than as per-series labels. See packages/core's ingest/labels.ts.
const tableFrame = (rows: Array<{ node: string; status: string; partition: string }>): DataFrame => ({
  refId: DEFAULT_OPTIONS.slots.state,
  length: rows.length,
  fields: [
    { name: 'node', type: FieldType.string, config: {}, values: rows.map((r) => r.node) },
    { name: 'status', type: FieldType.string, config: {}, values: rows.map((r) => r.status) },
    { name: 'partition', type: FieldType.string, config: {}, values: rows.map((r) => r.partition) },
  ],
});

const rows = [
  { node: 'r1n01', status: 'idle', partition: 'batch' },
  { node: 'r1n02', status: 'idle', partition: 'batch' },
  { node: 'r2n01', status: 'idle', partition: 'gpu' },
];

const item: RegistryItem = { id: 'grouping', name: 'Group by' };

const contextWith = (data: DataFrame[], options: PanelOptions | undefined): StandardEditorContext<PanelOptions> => ({
  data,
  options,
});

const renderEditor = (value: KeySource, data: DataFrame[] = [tableFrame(rows)]) =>
  render(
    <GroupingEditor
      value={value}
      onChange={jest.fn()}
      context={contextWith(data, DEFAULT_OPTIONS)}
      item={item}
    />
  );

describe('GroupingEditor preview', () => {
  it('maps each node to its label value for a label source', () => {
    renderEditor({ kind: 'label', label: 'partition' });
    const preview = screen.getByTestId('grouping-preview');
    expect(preview).toHaveTextContent('r1n01batch');
    expect(preview).toHaveTextContent('r1n02batch');
    expect(preview).toHaveTextContent('r2n01gpu');
  });

  it('maps each node to its captured group for a capture source', () => {
    renderEditor({ kind: 'capture', pattern: '^(r\\d+)' });
    const preview = screen.getByTestId('grouping-preview');
    expect(preview).toHaveTextContent('r1n01r1');
    expect(preview).toHaveTextContent('r1n02r1');
    expect(preview).toHaveTextContent('r2n01r2');
  });

  it('marks a chunk key as assumed', () => {
    renderEditor({ kind: 'chunk', size: 1 });
    const preview = screen.getByTestId('grouping-preview');
    expect(preview).toHaveTextContent('r1n01chunk 1 (assumed)');
    expect(preview).toHaveTextContent('r2n01chunk 1 (assumed)');
  });

  it('falls back to the ungrouped key instead of throwing on an uncompilable pattern', () => {
    renderEditor({ kind: 'capture', pattern: '(unterminated[' });
    const preview = screen.getByTestId('grouping-preview');
    expect(preview).toHaveTextContent('r1n01ungrouped');
    expect(preview).toHaveTextContent('r2n01ungrouped');
  });

  it('renders no preview when the query has not returned any series yet', () => {
    renderEditor({ kind: 'label', label: 'partition' }, []);
    expect(screen.queryByTestId('grouping-preview')).not.toBeInTheDocument();
  });

  it('renders no preview when panel options are not yet available', () => {
    render(
      <GroupingEditor
        value={{ kind: 'label', label: 'partition' }}
        onChange={jest.fn()}
        context={contextWith([tableFrame(rows)], undefined)}
        item={item}
      />
    );
    expect(screen.queryByTestId('grouping-preview')).not.toBeInTheDocument();
  });
});
