import React from 'react';
import { css } from '@emotion/css';
import type { DisplayProcessor, GrafanaTheme2 } from '@grafana/data';
import { useTheme2 } from '@grafana/ui';
import type { NodeGroup as NodeGroupModel, SlurmNode } from '@slurm-views/core';
import { UNGROUPED } from '@slurm-views/core';
import { GroupHeader } from './GroupHeader';
import { NodeCell } from './NodeCell';
import { RackFrame } from './RackFrame';
import { rackWidthFor, resolveCellSize, sledWidthFor } from './rackGeometry';
import type { BladeLayout } from './rackGeometry';
import type { ColorMode, PanelOptions } from '../types';

const getStyles = (theme: GrafanaTheme2, gap: number) => ({
  group: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(0.5) }),
  wrap: css({ display: 'flex', flexWrap: 'wrap', gap: `${gap}px` }),
  unresolved: css({
    border: `1px dashed ${theme.colors.border.medium}`,
    padding: theme.spacing(0.5),
    minHeight: theme.spacing(3),
  }),
});

export interface NodeGroupProps {
  group: NodeGroupModel;
  stateDisplay: DisplayProcessor;
  valueDisplay: DisplayProcessor;
  colorMode: ColorMode;
  /** Resolves the first data link's interpolated URL for a node, if the field config carries one. */
  hrefFor: (node: SlurmNode) => string | undefined;
  options: PanelOptions;
  /**
   * Rack geometry for the whole panel, resolved once by the panel because the
   * width every cabinet shares depends on the densest blade across all of
   * them. Absent wherever no rack is drawn.
   */
  blades?: BladeLayout;
}

export function NodeGroup({ group, stateDisplay, valueDisplay, colorMode, hrefFor, options, blades }: NodeGroupProps) {
  const theme = useTheme2();
  const styles = getStyles(theme, options.gap);

  // With grouping switched off every node is ungrouped on purpose, so the
  // panel has nothing to admit to.
  const unplaced = group.key === UNGROUPED && options.grouping.kind !== 'none';
  const empty = group.nodes.length === 0;
  const unresolved = unplaced || empty;
  const cell = resolveCellSize(options);

  // In a cabinet a cell is as wide as its share of the slot; everywhere else
  // it is the width the reader asked for. The fallback covers a NodeGroup
  // rendered without a layout — every wrap-layout test, and any caller that
  // draws a single group on its own.
  const rackWidth = blades?.rackWidth ?? rackWidthFor(cell.width);
  const cellWidth =
    options.layout === 'rack' ? blades?.sledWidthOf.get(group.key) ?? sledWidthFor(rackWidth, 1) : cell.width;

  const cells = group.nodes.map((node) => (
    <NodeCell
      key={node.name}
      node={node}
      width={cellWidth}
      height={cell.height}
      stateDisplay={stateDisplay}
      valueDisplay={valueDisplay}
      colorMode={colorMode}
      shapeChannel={options.shapeChannel}
      href={hrefFor(node)}
    />
  ));

  return (
    <div
      className={styles.group}
      data-testid={`node-group-${group.key}`}
      data-layout={options.layout}
      data-unplaced={unplaced}
      data-empty={empty}
    >
      <GroupHeader group={group} unplaced={unplaced} />
      {options.layout === 'rack' ? (
        <RackFrame width={rackWidth} dashed={unresolved}>{cells}</RackFrame>
      ) : (
        // A dashed box round what the panel did not resolve, the same idiom as
        // the hollow ring on a state with no value mapping.
        <div className={unresolved ? `${styles.wrap} ${styles.unresolved}` : styles.wrap}>{cells}</div>
      )}
    </div>
  );
}
