import React from 'react';
import { render, screen } from '@testing-library/react';
import {
  EventBusSrv,
  FieldType,
  LoadingState,
  ThresholdsMode,
  createDataFrame,
  getDefaultTimeRange,
} from '@grafana/data';
import type { FieldConfigSource, PanelData, PanelProps } from '@grafana/data';
import { setTemplateSrv } from '@grafana/runtime';
import { NodeGridPanel } from './NodeGridPanel';
import { DEFAULT_MAPPINGS } from '../defaults/mappings';
import { DEFAULT_OPTIONS } from '../types';
import type { PanelOptions } from '../types';
import { fakeTemplateSrv } from '../testing/templateSrv';

const baseProps: Omit<PanelProps<PanelOptions>, 'data' | 'options' | 'fieldConfig'> = {
  id: 1,
  timeRange: getDefaultTimeRange(),
  timeZone: 'browser',
  transparent: false,
  width: 800,
  height: 600,
  renderCounter: 0,
  title: 'Node grid',
  eventBus: new EventBusSrv(),
  onOptionsChange: () => {},
  onFieldConfigChange: () => {},
  replaceVariables: (value) => value,
  onChangeTimeRange: () => {},
};

describe('NodeGridPanel', () => {
  beforeEach(() => {
    setTemplateSrv(fakeTemplateSrv());
  });

  it('interpolates ${__node} and ${__state} into a cell href, rather than leaving the literal template', () => {
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);

    const frame = createDataFrame({
      refId: 'A',
      fields: [
        { name: 'Time', type: FieldType.time, values: [0] },
        {
          name: 'status',
          type: FieldType.number,
          values: [1],
          labels: { node: 'rack1-node07', status: 'drained' },
        },
      ],
    });

    const data: PanelData = { state: LoadingState.Done, series: [frame], timeRange: getDefaultTimeRange() };

    const fieldConfig: FieldConfigSource = {
      defaults: {
        mappings: DEFAULT_MAPPINGS,
        thresholds: { mode: ThresholdsMode.Absolute, steps: [{ value: -Infinity, color: 'green' }] },
        links: [{ title: 'Node detail', url: '/d/some-dash?var-node=${__node}&var-state=${__state}' }],
      },
      overrides: [],
    };

    render(<NodeGridPanel {...baseProps} data={data} options={DEFAULT_OPTIONS} fieldConfig={fieldConfig} />);

    screen.getByTestId('node-cell-rack1-node07').click();

    // The node name and raw state landed in the href, not the placeholder text.
    expect(openSpy).toHaveBeenCalledWith('/d/some-dash?var-node=rack1-node07&var-state=drained', '_self');
    expect(openSpy).not.toHaveBeenCalledWith(expect.stringContaining('${__node}'), expect.anything());
    expect(openSpy).not.toHaveBeenCalledWith(expect.stringContaining('${__state}'), expect.anything());

    openSpy.mockRestore();
  });
});
