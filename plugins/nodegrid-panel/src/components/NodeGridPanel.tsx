import React, { useMemo } from 'react';
import { css } from '@emotion/css';
import { FieldType, getDisplayProcessor } from '@grafana/data';
import type { Field, GrafanaTheme2, PanelProps } from '@grafana/data';
import { useTheme2 } from '@grafana/ui';
import { useNodeModel } from '../hooks/useNodeModel';
import type { PanelOptions } from '../types';

const getStyles = (theme: GrafanaTheme2) => ({
  wrap: css({
    height: '100%',
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
  }),
  cells: css({ display: 'flex', flexWrap: 'wrap' }),
  cell: css({ flex: '0 0 auto', borderRadius: 0 }),
  empty: css({ color: theme.colors.text.secondary, padding: theme.spacing(1) }),
});

export function NodeGridPanel({ data, options, fieldConfig }: PanelProps<PanelOptions>) {
  const theme = useTheme2();
  const styles = getStyles(theme);
  const { model, stateField } = useNodeModel(data, options);

  // Colour is never chosen here. The state string goes through the field
  // config's value mappings and comes back with a theme colour attached.
  const display = useMemo(() => {
    const base: Field = stateField ?? ({
      name: options.labels.state,
      type: FieldType.string,
      values: [],
      config: {},
    } as unknown as Field);
    return getDisplayProcessor({ field: { ...base, config: fieldConfig.defaults }, theme });
  }, [stateField, fieldConfig.defaults, options.labels.state, theme]);

  if (model.groups.length === 0) {
    return <div className={styles.empty}>No nodes. Check that the state query returns a node label.</div>;
  }

  return (
    <div className={styles.wrap} data-testid="slurm-node-grid">
      {model.groups.map((group) => (
        <div key={group.key}>
          <div className={styles.cells} style={{ gap: options.gap }}>
            {group.nodes.map((node) => {
              const dv = display(node.state);
              return (
                <div
                  key={`${group.key}/${node.name}`}
                  className={styles.cell}
                  data-testid={`node-cell-${node.name}`}
                  data-state={node.state}
                  aria-label={`${node.name}, ${dv.text}`}
                  style={{ width: options.cellSize, height: options.cellSize, background: dv.color }}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
