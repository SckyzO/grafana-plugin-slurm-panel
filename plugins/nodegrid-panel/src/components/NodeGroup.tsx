import React from 'react';
import { css } from '@emotion/css';
import type { DisplayProcessor, GrafanaTheme2 } from '@grafana/data';
import { useTheme2 } from '@grafana/ui';
import type { NodeGroup as NodeGroupModel } from '@slurm-views/core';
import { GroupHeader } from './GroupHeader';
import { NodeCell } from './NodeCell';
import { RackFrame } from './RackFrame';
import type { PanelOptions } from '../types';

const getStyles = (theme: GrafanaTheme2, gap: number) => ({
  group: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(0.5) }),
  wrap: css({ display: 'flex', flexWrap: 'wrap', gap: `${gap}px` }),
});

export interface NodeGroupProps {
  group: NodeGroupModel;
  display: DisplayProcessor;
  options: PanelOptions;
}

export function NodeGroup({ group, display, options }: NodeGroupProps) {
  const theme = useTheme2();
  const styles = getStyles(theme, options.gap);

  const cells = group.nodes.map((node) => (
    <NodeCell
      key={node.name}
      node={node}
      size={options.cellSize}
      display={display}
      shapeChannel={options.shapeChannel}
      sled={options.layout === 'rack'}
    />
  ));

  return (
    <div className={styles.group} data-testid={`node-group-${group.key}`} data-layout={options.layout}>
      <GroupHeader group={group} />
      {options.layout === 'rack' ? (
        <RackFrame width={Math.max(40, options.cellSize * 4)}>{cells}</RackFrame>
      ) : (
        <div className={styles.wrap}>{cells}</div>
      )}
    </div>
  );
}
