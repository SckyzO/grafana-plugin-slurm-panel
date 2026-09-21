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
    render(
      <NodeCell
        node={nodeWith('idle')}
        width={14}
        height={14}
        stateDisplay={displayFor('idle')}
        valueDisplay={displayFor('idle')}
        colorMode="state"
        shapeChannel={false}
      />
    );
    const cell = screen.getByTestId('node-cell-node-idle');
    expect(cell).toHaveAttribute('data-mapped', 'true');
    expect(cell.style.background).not.toBe('');
    expect(cell).toHaveAttribute('aria-label', 'node-idle, idle');
  });

  // Not a Slurm state. It used to be `perfctrs`, until the shipped rules were
  // completed against the sinfo man page and perfctrs became mapped — which is
  // the trap: a test for unmapped behaviour must not be written against a
  // value that can quietly become mapped. This stands in for whatever a future
  // Slurm introduces.
  const UNKNOWN_STATE = 'zzz_not_a_slurm_state';

  it('renders a state the rules have never seen as unmapped: ring, no fill', () => {
    render(
      <NodeCell
        node={nodeWith(UNKNOWN_STATE)}
        width={14}
        height={14}
        stateDisplay={displayFor(UNKNOWN_STATE)}
        valueDisplay={displayFor(UNKNOWN_STATE)}
        colorMode="state"
        shapeChannel={false}
      />
    );
    const cell = screen.getByTestId(`node-cell-node-${UNKNOWN_STATE}`);
    expect(cell).toHaveAttribute('data-mapped', 'false');
    expect(cell.style.background).toBe('');
    expect(cell).toHaveAttribute('aria-label', `node-${UNKNOWN_STATE}, ${UNKNOWN_STATE}`);
  });

  it('drives the fill from utilisation, via Thresholds, when colour mode is not state', () => {
    const node: SlurmNode = {
      ...nodeWith(UNKNOWN_STATE),
      facets: { gres: [], cpuAlloc: 64, cpuTotal: 128 },
    };
    render(
      <NodeCell
        node={node}
        width={14}
        height={14}
        stateDisplay={displayFor(UNKNOWN_STATE)}
        valueDisplay={displayFor(UNKNOWN_STATE)}
        colorMode="cpu"
        shapeChannel={false}
      />
    );
    const cell = screen.getByTestId(`node-cell-node-${UNKNOWN_STATE}`);
    // The state is unmapped, but in a
    // continuous mode the ring must not appear: the fill no longer encodes
    // state, so a state-mapping ring would answer a question nobody asked of
    // the colour here.
    expect(cell).toHaveAttribute('data-mapped', 'false');
    expect(cell.style.background).not.toBe('');
    // The state stays named in words regardless of colour mode.
    expect(cell).toHaveAttribute('aria-label', `node-${UNKNOWN_STATE}, ${UNKNOWN_STATE}`);
  });

  it('draws a node with no data for a continuous mode exactly like an unfilled one', () => {
    // `style.background === ''` on its own does not say this. React drops an
    // undefined background, and a <button> with no background falls back to
    // the browser's own ButtonFace — a solid mid-grey that reads as a real
    // measurement. On a cluster where most nodes have no GPU that was most of
    // the grid. Compare against the cell already known to be drawn as empty
    // and require the identical treatment. `cx` merges emotion styles into a
    // single class, so the class name itself is the comparison.
    const classNameOf = (element: HTMLElement): string => element.className;

    const state = render(
      <NodeCell
        node={nodeWith(UNKNOWN_STATE)}
        width={14}
        height={14}
        stateDisplay={displayFor(UNKNOWN_STATE)}
        valueDisplay={displayFor(UNKNOWN_STATE)}
        colorMode="state"
        shapeChannel={false}
      />
    );
    const emptyInStateMode = screen.getByTestId(`node-cell-node-${UNKNOWN_STATE}`);
    expect(emptyInStateMode).toHaveAttribute('data-filled', 'false');
    const emptyClass = classNameOf(emptyInStateMode);
    state.unmount();

    const filled = render(
      <NodeCell
        node={nodeWith('idle')}
        width={14}
        height={14}
        stateDisplay={displayFor('idle')}
        valueDisplay={displayFor('idle')}
        colorMode="state"
        shapeChannel={false}
      />
    );
    const filledClass = classNameOf(screen.getByTestId('node-cell-node-idle'));
    filled.unmount();

    // Without this the test would pass if every cell shared one class — which
    // is precisely the bug, every cell left to the browser's default.
    expect(filledClass).not.toBe(emptyClass);

    render(
      <NodeCell
        node={nodeWith('idle')}
        width={14}
        height={14}
        stateDisplay={displayFor('idle')}
        valueDisplay={displayFor('idle')}
        colorMode="mem"
        shapeChannel={false}
      />
    );
    const noMemoryData = screen.getByTestId('node-cell-node-idle');
    expect(noMemoryData).toHaveAttribute('data-filled', 'false');
    expect(noMemoryData.style.background).toBe('');
    expect(classNameOf(noMemoryData)).toBe(emptyClass);
  });

  it('marks a filled cell as filled, so data-filled discriminates', () => {
    render(
      <NodeCell
        node={nodeWith('idle')}
        width={14}
        height={14}
        stateDisplay={displayFor('idle')}
        valueDisplay={displayFor('idle')}
        colorMode="state"
        shapeChannel={false}
      />
    );
    expect(screen.getByTestId('node-cell-node-idle')).toHaveAttribute('data-filled', 'true');
  });
});
