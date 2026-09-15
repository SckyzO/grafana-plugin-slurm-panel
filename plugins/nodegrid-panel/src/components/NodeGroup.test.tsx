import React from 'react';
import { render, screen } from '@testing-library/react';
import { FieldType, ThresholdsMode, createTheme, getDisplayProcessor } from '@grafana/data';
import type { DisplayProcessor } from '@grafana/data';
import type { NodeGroup as NodeGroupModel, SlurmNode } from '@slurm-views/core';
import { NodeGroup } from './NodeGroup';
import type { NodeGroupProps } from './NodeGroup';
import { rackWidthFor } from './rackGeometry';
import { DEFAULT_MAPPINGS } from '../defaults/mappings';
import { DEFAULT_OPTIONS } from '../types';
import type { PanelOptions } from '../types';

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

const noLink = () => undefined;

const mkNode = (name: string): SlurmNode => ({
  name,
  state: 'idle',
  partitions: [],
  labels: {},
  facets: { gres: [] },
});

const renderGroup = (
  group: NodeGroupModel,
  options: PanelOptions,
  overrides: Partial<NodeGroupProps> = {}
) =>
  render(
    <NodeGroup
      group={group}
      stateDisplay={display}
      valueDisplay={display}
      colorMode="state"
      hrefFor={noLink}
      options={options}
      {...overrides}
    />
  );

const group: NodeGroupModel = {
  key: 'rack-1',
  nodes: [mkNode('node-a'), mkNode('node-b')],
  assumed: false,
};

describe('NodeGroup', () => {
  it('draws a rack frame of sleds when layout is rack', () => {
    renderGroup(group, { ...DEFAULT_OPTIONS, layout: 'rack' });

    expect(screen.getByTestId('node-group-rack-1')).toHaveAttribute('data-layout', 'rack');
    const rack = screen.getByTestId('rack-frame');
    expect(rack).toBeInTheDocument();
    // NodeGroup threads options.cellSize through to RackFrame rather than
    // computing (or hardcoding) the rack's width itself.
    expect(getComputedStyle(rack).width).toBe(`${rackWidthFor(DEFAULT_OPTIONS.cellSize)}px`);

    // A sled is wide and short, not a square: NodeCell only stretches to fill
    // the rack's width (auto) when it received sled={true}.
    const cell = screen.getByTestId('node-cell-node-a');
    expect(cell.style.width).toBe('auto');
  });

  it('lays cells out in a wrapping row, with no rack frame, when layout is wrap', () => {
    renderGroup(group, { ...DEFAULT_OPTIONS, layout: 'wrap' });

    expect(screen.getByTestId('node-group-rack-1')).toHaveAttribute('data-layout', 'wrap');
    expect(screen.queryByTestId('rack-frame')).not.toBeInTheDocument();

    const cell = screen.getByTestId('node-cell-node-a');
    expect(cell.style.width).toBe(`${DEFAULT_OPTIONS.cellSize}px`);
  });

  it('resolves a click-through link per node via hrefFor', () => {
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
    const hrefFor = (node: SlurmNode) => `/d/some-dash?var-node=${node.name}`;

    renderGroup(group, { ...DEFAULT_OPTIONS, layout: 'wrap' }, { hrefFor });

    screen.getByTestId('node-cell-node-a').click();
    expect(openSpy).toHaveBeenCalledWith('/d/some-dash?var-node=node-a', '_self');

    openSpy.mockRestore();
  });
});
