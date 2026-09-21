import React from 'react';
import { render, screen } from '@testing-library/react';
import { FieldType, ThresholdsMode, createTheme, getDisplayProcessor } from '@grafana/data';
import type { DisplayProcessor } from '@grafana/data';
import type { NodeGroup as NodeGroupModel, SlurmNode } from '@slurm-views/core';
import { NodeGroup } from './NodeGroup';
import type { NodeGroupProps } from './NodeGroup';
import { frameHeight, layoutBlades, layoutSlots, rackWidthFor, resolveCellSize, sledWidthFor } from './rackGeometry';
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

const renderGroup = (group: NodeGroupModel, options: PanelOptions, overrides: Partial<NodeGroupProps> = {}) => {
  // blades became a required prop once NodeGroup stopped reimplementing
  // rackWidthFor/sledWidthFor as its own fallback (NodeGridPanel is the only
  // production caller and always resolves one). This default mirrors that
  // removed fallback exactly — a single blade of one, sized from this
  // group's own cell width — so every test written before blades existed
  // still reads the same.
  const defaultBlades = layoutBlades({
    groupKeys: [group.key],
    sizes: new Map(),
    fallback: 1,
    cellWidth: resolveCellSize(options).width,
  });

  // slots is required for the same reason blades is: NodeGridPanel is the only
  // production caller and always resolves one. With no declaration and one
  // group, this levels to that group's own content — which is the height the
  // frame drew before cabinet heights existed.
  const defaultSlots = layoutSlots({
    groups: [{ key: group.key, nodes: group.nodes.length }],
    blades: defaultBlades,
    declared: new Map(),
    fallback: undefined,
    cellHeight: resolveCellSize(options).height,
  });

  return render(
    <NodeGroup
      group={group}
      stateDisplay={display}
      valueDisplay={display}
      colorMode="state"
      hrefFor={noLink}
      options={options}
      blades={defaultBlades}
      slots={defaultSlots}
      {...overrides}
    />
  );
};

const group: NodeGroupModel = {
  key: 'rack-1',
  nodes: [mkNode('node-a'), mkNode('node-b')],
  assumed: false,
};

describe('NodeGroup', () => {
  it('counts one node as a node, not as nodes', () => {
    // A group of one is not a corner case here: grouping by state gives one
    // group per state, and the scenarios dashboard draws forty-four of them
    // side by side, every one of them reading "1 nodes".
    const alone: NodeGroupModel = { key: 'rack-9', nodes: [mkNode('node-a')], assumed: false };
    renderGroup(alone, { ...DEFAULT_OPTIONS, layout: 'rack' });

    expect(screen.getByText('1 node')).toBeInTheDocument();
    expect(screen.queryByText('1 nodes')).not.toBeInTheDocument();
  });

  it('counts anything other than one as nodes', () => {
    renderGroup(group, { ...DEFAULT_OPTIONS, layout: 'rack' });
    expect(screen.getByText('2 nodes')).toBeInTheDocument();
  });

  it('draws a rack frame of sleds when layout is rack', () => {
    renderGroup(group, { ...DEFAULT_OPTIONS, layout: 'rack' });

    expect(screen.getByTestId('node-group-rack-1')).toHaveAttribute('data-layout', 'rack');
    const rack = screen.getByTestId('rack-frame');
    expect(rack).toBeInTheDocument();
    // NodeGroup threads the resolved cell width through to RackFrame rather
    // than computing (or hardcoding) the rack's width itself.
    expect(getComputedStyle(rack).width).toBe(`${rackWidthFor(resolveCellSize(DEFAULT_OPTIONS).width)}px`);

    // A sled fills the cabinet's inner width when one node has the blade to
    // itself. That width is resolved by NodeGroup and handed over, rather
    // than a stretch NodeCell decides for itself: `auto` only filled a
    // cabinet while the frame was a column.
    const cell = screen.getByTestId('node-cell-node-a');
    const width = rackWidthFor(resolveCellSize(DEFAULT_OPTIONS).width);
    expect(cell.style.width).toBe(`${sledWidthFor(width, 1)}px`);
  });

  it('splits the cabinet between the nodes sharing a blade', () => {
    // Assert the geometry, not a count of cells: eight nodes are eight cells
    // at any blade size, so counting them would pass whatever the layout did.
    const eight: NodeGroupModel = {
      key: 'rack1',
      assumed: false,
      nodes: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'].map(mkNode),
    };
    const blades = layoutBlades({
      groupKeys: ['rack1'],
      sizes: new Map([['rack1', 4]]),
      fallback: 1,
      cellWidth: 20,
    });

    renderGroup(eight, { ...DEFAULT_OPTIONS, layout: 'rack' }, { blades });

    expect(getComputedStyle(screen.getByTestId('rack-frame')).width).toBe(`${blades.rackWidth}px`);
    expect(screen.getByTestId('node-cell-c1').style.width).toBe(`${blades.sledWidthOf.get('rack1')}px`);
  });

  it('uses the blade declared for this group, not the one next to it', () => {
    // Four and two on purpose: two equal blades would pass just as well with
    // the lookups swapped, which is how a width/height inversion once
    // survived review on this panel.
    const blades = layoutBlades({
      groupKeys: ['rack1', 'rack2'],
      sizes: new Map([
        ['rack1', 4],
        ['rack2', 2],
      ]),
      fallback: 1,
      cellWidth: 20,
    });
    const duo: NodeGroupModel = { key: 'rack2', assumed: false, nodes: [mkNode('c1'), mkNode('c2')] };

    renderGroup(duo, { ...DEFAULT_OPTIONS, layout: 'rack' }, { blades });

    expect(screen.getByTestId('node-cell-c1').style.width).toBe(`${blades.sledWidthOf.get('rack2')}px`);
    expect(blades.sledWidthOf.get('rack2')).not.toBe(blades.sledWidthOf.get('rack1'));
  });

  it('ignores blades entirely in the wrap layout', () => {
    const blades = layoutBlades({
      groupKeys: ['rack-1'],
      sizes: new Map([['rack-1', 4]]),
      fallback: 1,
      cellWidth: 20,
    });

    renderGroup(group, { ...DEFAULT_OPTIONS, layout: 'wrap', cellWidth: 20 }, { blades });

    expect(screen.queryByTestId('rack-frame')).toBeNull();
    expect(screen.getByTestId('node-cell-node-a').style.width).toBe('20px');
  });

  it('lays cells out in a wrapping row, with no rack frame, when layout is wrap', () => {
    renderGroup(group, { ...DEFAULT_OPTIONS, layout: 'wrap' });

    expect(screen.getByTestId('node-group-rack-1')).toHaveAttribute('data-layout', 'wrap');
    expect(screen.queryByTestId('rack-frame')).not.toBeInTheDocument();

    const cell = screen.getByTestId('node-cell-node-a');
    expect(cell.style.width).toBe(`${resolveCellSize(DEFAULT_OPTIONS).width}px`);
  });

  it('gives a cell its width and its height, and not the same number twice', () => {
    // Splitting one size into two created a failure mode a single number could
    // not have: the props can be swapped, transposing every grid. No symmetric
    // fixture notices, because width and height are both 14 by default.
    renderGroup(
      { key: 'rack1', nodes: [mkNode('c1')], assumed: false },
      { ...DEFAULT_OPTIONS, layout: 'wrap', cellWidth: 20, cellHeight: 6 }
    );
    const cell = screen.getByTestId('node-cell-c1');
    expect(cell.style.width).toBe('20px');
    expect(cell.style.height).toBe('6px');
  });

  it('resolves a click-through link per node via hrefFor', () => {
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
    const hrefFor = (node: SlurmNode) => `/d/some-dash?var-node=${node.name}`;

    renderGroup(group, { ...DEFAULT_OPTIONS, layout: 'wrap' }, { hrefFor });

    screen.getByTestId('node-cell-node-a').click();
    expect(openSpy).toHaveBeenCalledWith('/d/some-dash?var-node=node-a', '_self');

    openSpy.mockRestore();
  });

  it('stands a short cabinet on the floor inside a band the tall one sets', () => {
    // The defect this fixes, at component level: rack2 has half the nodes and
    // must still reach the same floor. The band is the shared height; the
    // frame inside it is aligned to the band's bottom.
    const options: PanelOptions = { ...DEFAULT_OPTIONS, layout: 'rack' };
    const cellHeight = resolveCellSize(options).height;
    const blades = layoutBlades({
      groupKeys: ['rack1', 'rack2'],
      sizes: new Map(),
      fallback: 1,
      cellWidth: resolveCellSize(options).width,
    });
    const slots = layoutSlots({
      groups: [
        { key: 'rack1', nodes: 8 },
        { key: 'rack2', nodes: 4 },
      ],
      blades,
      declared: new Map([['rack2', 4]]),
      fallback: undefined,
      cellHeight,
    });

    render(
      <NodeGroup
        group={{ key: 'rack2', nodes: [mkNode('c1'), mkNode('c2'), mkNode('c3'), mkNode('c4')], assumed: false }}
        stateDisplay={display}
        valueDisplay={display}
        colorMode="state"
        hrefFor={noLink}
        options={options}
        blades={blades}
        slots={slots}
      />
    );

    const band = screen.getByTestId('rack-band');
    expect(getComputedStyle(band).height).toBe(`${frameHeight(8, cellHeight)}px`);
    expect(getComputedStyle(band).alignItems).toBe('flex-end');
    expect(getComputedStyle(screen.getByTestId('rack-frame')).height).toBe(`${frameHeight(4, cellHeight)}px`);
  });

  it('draws no band in the wrap layout', () => {
    // The band is a cabinet's floor. Wrap draws no cabinet.
    renderGroup({ key: 'rack1', nodes: [mkNode('c1')], assumed: false }, { ...DEFAULT_OPTIONS, layout: 'wrap' });
    expect(screen.queryByTestId('rack-band')).toBeNull();
  });
});

describe('groups the panel could not resolve', () => {
  const ungrouped = { key: 'ungrouped', nodes: [mkNode('c1')], assumed: false };
  const empty = { key: 'rack7', nodes: [], assumed: false };
  const ranges = { kind: 'ranges', table: 'rack7: c[99-99]' } as const;

  it('marks an ungrouped group as unplaced when a source was chosen', () => {
    renderGroup(ungrouped, { ...DEFAULT_OPTIONS, grouping: ranges });
    expect(screen.getByTestId('node-group-ungrouped')).toHaveAttribute('data-unplaced', 'true');
    expect(screen.getByText('unplaced')).toBeInTheDocument();
  });

  it('does not mark it when grouping is switched off', () => {
    // Everything is ungrouped on purpose; admitting to it would be noise.
    renderGroup(ungrouped, { ...DEFAULT_OPTIONS, grouping: { kind: 'none' } });
    expect(screen.getByTestId('node-group-ungrouped')).toHaveAttribute('data-unplaced', 'false');
    expect(screen.queryByText('unplaced')).not.toBeInTheDocument();
  });

  it('keeps unplaced distinct from assumed, because they admit different things', () => {
    renderGroup({ key: 'chunk 1', nodes: [mkNode('c1')], assumed: true }, DEFAULT_OPTIONS);
    expect(screen.getByText('assumed')).toBeInTheDocument();
    expect(screen.queryByText('unplaced')).not.toBeInTheDocument();
  });

  it('draws a declared group that matched no node, rather than dropping it', () => {
    renderGroup(empty, { ...DEFAULT_OPTIONS, grouping: ranges });
    const group = screen.getByTestId('node-group-rack7');
    expect(group).toHaveAttribute('data-empty', 'true');
    expect(screen.getByText('0 nodes')).toBeInTheDocument();
  });

  it('stacks the group name over its count and centres them on the cabinet', () => {
    // A long name beside a count decides the group's width, and in the rack
    // layout the group's width is what pushes a cabinet onto the next line.
    renderGroup({ key: 'rack1', nodes: [mkNode('c1')], assumed: false }, { ...DEFAULT_OPTIONS, layout: 'rack' });
    const header = screen.getByText('rack1').parentElement!;
    expect(getComputedStyle(header).flexDirection).toBe('column');
    expect(getComputedStyle(header).alignItems).toBe('center');
  });

  it('keeps the name beside the count in the wrap layout, where the group owns the row', () => {
    renderGroup({ key: 'rack1', nodes: [mkNode('c1')], assumed: false }, { ...DEFAULT_OPTIONS, layout: 'wrap' });
    expect(getComputedStyle(screen.getByText('rack1').parentElement!).flexDirection).toBe('row');
  });

  it('hides the count when the reader asks, and never the name', () => {
    renderGroup(
      { key: 'rack1', nodes: [mkNode('c1'), mkNode('c2')], assumed: false },
      { ...DEFAULT_OPTIONS, layout: 'rack', showNodeCount: false }
    );
    expect(screen.getByText('rack1')).toBeInTheDocument();
    expect(screen.queryByText('2 nodes')).toBeNull();
  });
});
