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

  // The shape channel is the accessibility claim the shipped README makes over
  // three paragraphs, two screenshots and a Delta E measurement — and until
  // these tests it was invisible to the suite. Both of these mutations passed
  // 285 unit tests and 22 browser tests: shapeFor returning undefined for
  // everything, and shapeFor returning one single shape for every state, which
  // notches `idle` exactly like `down`.
  //
  // Read off the inline style rather than a class, because clipPath is what
  // the browser actually cuts and what a reader in greyscale actually sees.
  const cutFor = (state: string, shapeChannel = true): string => {
    render(
      <NodeCell
        node={nodeWith(state)}
        width={14}
        height={14}
        stateDisplay={displayFor(state)}
        valueDisplay={displayFor(state)}
        colorMode="state"
        shapeChannel={shapeChannel}
      />
    );
    return screen.getByTestId(`node-cell-node-${state}`).style.clipPath;
  };

  it('cuts a corner off the states the fill cannot separate, and leaves the rest square', () => {
    // `drained` is purple and `not responding` orange, but under protanopia
    // the orange sits 4.8 from allocated — no palette fixed it, which is the
    // whole reason this channel exists.
    expect(cutFor('drained')).toMatch(/^polygon\(/);
    expect(cutFor('down')).toMatch(/^polygon\(/);

    // A working node stays square. If this ever returns a polygon the channel
    // has stopped carrying information: every cell notched is every cell the
    // same.
    expect(cutFor('idle')).toBe('');
    expect(cutFor('allocated')).toBe('');
  });

  it('gives the two families different cuts, which is the information the channel carries', () => {
    // The mutation that survived the whole suite was one shape for everything.
    // Nothing above catches it; this does.
    expect(cutFor('drained')).not.toBe(cutFor('down'));
  });

  it('cuts a node suspended with ~ like a broken one, because the match is on the mapped text', () => {
    // Recorded, not endorsed. The match is a substring of the *mapped* text,
    // not the raw state, and the `~` suffix maps to "powered down" — which
    // contains "down", so it takes the down cut although the palette puts it
    // in the grey family rather than the red one.
    //
    // The wider consequence is a known defect, not a design: the test is a
    // case-sensitive substring of a label the README invites an operator to
    // edit. Renaming `drained` to `Drained` silently removes its cut, and a
    // healthy state relabelled to anything containing "down" silently gains
    // one. The channel is off by default, so the readers it fails are exactly
    // the ones who turned it on because they depend on it. This test pins
    // today's behaviour so a fix is visible as a change; it does not argue
    // that today's behaviour is right.
    expect(cutFor('idle~')).toBe(cutFor('down'));

    // And the distinction that makes it subtle: the raw state `power_down`
    // maps to "power management", which contains no "down" at all, so it
    // stays square. Two states a reader would call the same thing, cut
    // differently, entirely as a consequence of the mapped wording.
    expect(cutFor('power_down')).toBe('');
  });

  it('draws nothing but squares when the channel is off, which is the shipped default', () => {
    // DEFAULT_OPTIONS.shapeChannel is false: the majority who configure
    // nothing get no notches, and this is the test that says so at the cell.
    for (const state of ['drained', 'down', 'idle']) {
      expect(cutFor(state, false)).toBe('');
    }
  });

  it('sanitises an href it is handed, not only one hrefFor built', () => {
    // NodeGridPanel sanitises at the boundary, which covers the only producer
    // there is today. This covers the other half: NodeCell is exported and
    // `href` is a plain `string | undefined`, so the type permits a caller
    // that never went through hrefFor. Without this test the second pass was
    // an assertion in a comment — removing it left all 292 tests green.
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
    openSpy.mockClear();

    render(
      <NodeCell
        node={nodeWith('idle')}
        width={14}
        height={14}
        stateDisplay={displayFor('idle')}
        valueDisplay={displayFor('idle')}
        colorMode="state"
        shapeChannel={false}
        href="javascript:alert(document.domain)"
      />
    );
    screen.getByTestId('node-cell-node-idle').click();

    expect(openSpy).toHaveBeenCalledWith('about:blank', '_self');

    openSpy.mockRestore();
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
