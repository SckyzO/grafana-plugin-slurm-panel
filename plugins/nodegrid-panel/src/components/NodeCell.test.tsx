import React from 'react';
import { render, screen } from '@testing-library/react';
import { FieldType, ThresholdsMode, createTheme, getDisplayProcessor } from '@grafana/data';
import type { DisplayProcessor } from '@grafana/data';
import type { SlurmNode } from '@slurm-views/core';
import { NodeCell } from './NodeCell';
import { DEFAULT_MAPPINGS } from '../defaults/mappings';

const theme = createTheme();

// Thresholds are always configured in the real panel (module.ts calls
// useFieldConfig()), and that is exactly what made the old heuristic
// dangerous: an unmapped value still resolves a colour, from the threshold
// base step, not from a mapping.
const displayFor = (state: string): DisplayProcessor =>
  getDisplayProcessor({
    field: {
      name: 'status',
      type: FieldType.string,
      values: [state],
      config: {
        mappings: DEFAULT_MAPPINGS,
        thresholds: { mode: ThresholdsMode.Absolute, steps: [{ value: -Infinity, color: 'green' }] },
      },
    },
    theme,
  });

const nodeWith = (state: string): SlurmNode => ({
  name: `node-${state}`,
  state,
  partitions: [],
  labels: {},
  facets: { gres: [] },
});

describe('NodeCell', () => {
  it('renders idle as mapped: filled, no unmapped ring', () => {
    render(<NodeCell node={nodeWith('idle')} size={14} display={displayFor('idle')} shapeChannel={false} />);
    const cell = screen.getByTestId('node-cell-node-idle');
    expect(cell).toHaveAttribute('data-mapped', 'true');
    expect(cell.style.background).not.toBe('');
    expect(cell).toHaveAttribute('aria-label', 'node-idle, idle');
  });

  it('renders perfctrs (a real, unmapped Slurm base state) as unmapped: ring, no fill', () => {
    render(
      <NodeCell node={nodeWith('perfctrs')} size={14} display={displayFor('perfctrs')} shapeChannel={false} />
    );
    const cell = screen.getByTestId('node-cell-node-perfctrs');
    expect(cell).toHaveAttribute('data-mapped', 'false');
    expect(cell.style.background).toBe('');
    expect(cell).toHaveAttribute('aria-label', 'node-perfctrs, perfctrs');
  });
});
