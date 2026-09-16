import React from 'react';
import { css } from '@emotion/css';
import type { DisplayProcessor, GrafanaTheme2 } from '@grafana/data';
import { useTheme2 } from '@grafana/ui';
import type { NodeGroup as NodeGroupModel, SlurmNode } from '@slurm-views/core';
import { UNGROUPED } from '@slurm-views/core';
import { GroupHeader } from './GroupHeader';
import { NodeCell } from './NodeCell';
import { RackFrame } from './RackFrame';
import { resolveCellSize } from './rackGeometry';
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
   * them. NodeGridPanel is the only production caller and always resolves
   * and passes one — a caller that draws a rack without it would have
   * nothing honest to fall back to, so this is required rather than
   * reimplementing rackWidthFor/sledWidthFor here for a caller that does not
   * exist.
   */
  blades: BladeLayout;
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
  // it is the width the reader asked for. blades.sledWidthOf is keyed by
  // every group layoutBlades was given, and the panel always builds it from
  // the same group list it renders, so group.key is always present here —
  // guessing a blade-1 width for a missing key would contradict this panel's
  // rule that it names what it cannot resolve rather than guessing.
  const rackWidth = blades.rackWidth;
  const cellWidth = options.layout === 'rack' ? blades.sledWidthOf.get(group.key)! : cell.width;

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
