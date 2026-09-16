import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FieldType } from '@grafana/data';
import type { DataFrame, RegistryItem, StandardEditorContext } from '@grafana/data';
import { setTemplateSrv } from '@grafana/runtime';
import type { KeySource } from '@slurm-views/core';
import { GroupingEditor } from './GroupingEditor';
import { DEFAULT_OPTIONS } from '../types';
import type { PanelOptions } from '../types';
import { fakeTemplateSrv } from '../testing/templateSrv';

// Table-format frame: one string column per label, one row per node — the
// same shape `toSamples` reads when a query returns node/status/partition as
// columns rather than as per-series labels. See packages/core's ingest/labels.ts.
const tableFrame = (rows: Array<{ node: string; status: string; partition: string }>): DataFrame => ({
  refId: DEFAULT_OPTIONS.queries.state,
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

// GroupingEditor's value/onChange are controlled: typing into the Ranges
// textarea only accumulates across keystrokes if the harness feeds each
// onChange back in as the next value, the way the real options form does.
// Without this, React restores the DOM to the original `value` prop after
// every keystroke userEvent fires.
const renderEditor = (
  value: KeySource,
  onChange: (next?: KeySource) => void = jest.fn(),
  data: DataFrame[] = [tableFrame(rows)]
) => {
  const context = contextWith(data, DEFAULT_OPTIONS);
  const handleChange = (next?: KeySource) => {
    onChange(next);
    if (next) {
      utils.rerender(<GroupingEditor value={next} onChange={handleChange} context={context} item={item} />);
    }
  };
  const utils = render(<GroupingEditor value={value} onChange={handleChange} context={context} item={item} />);
  return utils;
};

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
    renderEditor({ kind: 'label', label: 'partition' }, jest.fn(), []);
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

describe('the Ranges source', () => {
  beforeEach(() => {
    setTemplateSrv(fakeTemplateSrv({ racks: 'rack1: r1n[01-02]' }));
  });

  it('offers Ranges and seeds a table that shows the syntax', async () => {
    const onChange = jest.fn();
    renderEditor({ kind: 'none' }, onChange);
    await userEvent.click(screen.getByText('Ranges'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ranges', table: expect.stringContaining(':') })
    );
  });

  it('edits the table', async () => {
    const onChange = jest.fn();
    renderEditor({ kind: 'ranges', table: 'rack1: c[1-2]' }, onChange);
    const box = screen.getByRole('textbox');
    await userEvent.clear(box);
    await userEvent.type(box, 'x: c1');
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'ranges', table: 'x: c1' });
  });

  it('previews the placement the table would produce', () => {
    // The fixtures in this file name their nodes r1n01/r1n02/r2n01, not c1/c2.
    renderEditor({ kind: 'ranges', table: 'rack1: r1n[01-02]' }, jest.fn());
    expect(screen.getByTestId('grouping-preview')).toHaveTextContent('rack1');
  });

  it('resolves a dashboard variable before deciding what the table matches', () => {
    // Without the interpolation the preview parses the literal "$racks" as one
    // malformed line, places nothing, and tells the operator their table
    // matches nothing. Delete the interpolation from GroupingEditor and this
    // test goes red; the other Ranges tests do not, because they use literal
    // tables.
    renderEditor({ kind: 'ranges', table: '$racks' }, jest.fn());
    expect(screen.getByTestId('grouping-preview')).toHaveTextContent('rack1');
  });
});
