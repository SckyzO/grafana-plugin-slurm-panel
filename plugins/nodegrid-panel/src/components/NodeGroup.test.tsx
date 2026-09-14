import React from 'react';
import { render, screen } from '@testing-library/react';
import { FieldType, ThresholdsMode, createTheme, getDisplayProcessor } from '@grafana/data';
import type { DisplayProcessor } from '@grafana/data';
import type { NodeGroup as NodeGroupModel, SlurmNode } from '@slurm-views/core';
import { NodeGroup } from './NodeGroup';
import { DEFAULT_MAPPINGS } from '../defaults/mappings';
import { DEFAULT_OPTIONS } from '../types';

const theme = createTheme();

const display: DisplayProcessor = getDisplayProcessor({
  field: {
    name: 'status',
    type: FieldType.string,
    values: ['idle'],
    config: {
      mappings: DEFAULT_MAPPINGS,
      thresholds: { mode: ThresholdsMode.Absolute, steps: [{ value: -Infinity, color: 'green' }] },
    },
  },
  theme,
});

const nodeWith = (name: string): SlurmNode => ({
  name,
  state: 'idle',
  partitions: [],
  labels: {},
  facets: { gres: [] },
});

const group: NodeGroupModel = {
  key: 'rack-1',
  nodes: [nodeWith('node-a'), nodeWith('node-b')],
  assumed: false,
};

describe('NodeGroup', () => {
  it('draws a rack frame of sleds when layout is rack', () => {
    render(<NodeGroup group={group} display={display} options={{ ...DEFAULT_OPTIONS, layout: 'rack' }} />);

    expect(screen.getByTestId('node-group-rack-1')).toHaveAttribute('data-layout', 'rack');
    expect(screen.getByTestId('rack-frame')).toBeInTheDocument();

    // A sled is wide and short, not a square: NodeCell only stretches to fill
    // the rack's width (auto) when it received sled={true}.
    const cell = screen.getByTestId('node-cell-node-a');
    expect(cell.style.width).toBe('auto');
  });

  it('lays cells out in a wrapping row, with no rack frame, when layout is wrap', () => {
    render(<NodeGroup group={group} display={display} options={{ ...DEFAULT_OPTIONS, layout: 'wrap' }} />);

    expect(screen.getByTestId('node-group-rack-1')).toHaveAttribute('data-layout', 'wrap');
    expect(screen.queryByTestId('rack-frame')).not.toBeInTheDocument();

    const cell = screen.getByTestId('node-cell-node-a');
    expect(cell.style.width).toBe(`${DEFAULT_OPTIONS.cellSize}px`);
  });
});
