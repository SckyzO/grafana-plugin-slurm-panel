import React, { useMemo } from 'react';
import { css } from '@emotion/css';
import { FieldType, getDisplayProcessor } from '@grafana/data';
import type { Field, GrafanaTheme2, PanelProps } from '@grafana/data';
import { useTheme2 } from '@grafana/ui';
import { useNodeModel } from '../hooks/useNodeModel';
import { NodeGroup } from './NodeGroup';
import { PanelWarnings } from './PanelWarnings';
import { collectUnmapped, summarise } from '../utils/unmapped';
import type { PanelOptions } from '../types';

const getStyles = (theme: GrafanaTheme2, layout: PanelOptions['layout']) => ({
  // The warnings strip must sit outside the scrolling area, so the grid
  // scrolls under a fixed header rather than the warning scrolling away.
  outer: css({ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }),
  wrap: css({
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    display: 'flex',
    // Racks read as an elevation drawn side by side; wrapped groups stack
    // as a column so each group keeps the full row width to wrap cells into.
    flexDirection: layout === 'rack' ? 'row' : 'column',
    alignItems: layout === 'rack' ? 'flex-start' : 'stretch',
    flexWrap: layout === 'rack' ? 'wrap' : 'nowrap',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
  }),
  empty: css({ color: theme.colors.text.secondary, padding: theme.spacing(1) }),
});

export function NodeGridPanel({ data, options, fieldConfig }: PanelProps<PanelOptions>) {
  const theme = useTheme2();
  const styles = getStyles(theme, options.layout);
  const { model, warnings, stateField } = useNodeModel(data, options);

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

  const unmapped = useMemo(
    () => collectUnmapped(model.groups.flatMap((g) => g.nodes), display),
    [model.groups, display]
  );
  const lines = useMemo(
    () => summarise(model, warnings, unmapped, options.maxCells),
    [model, warnings, unmapped, options.maxCells]
  );

  if (model.groups.length === 0) {
    // A no-identity warning is the reason there is nothing to draw, so it
    // belongs here as much as in the populated case below.
    return (
      <div className={styles.outer}>
        <PanelWarnings lines={lines} />
        <div className={styles.empty}>No nodes. Check that the state query returns a node label.</div>
      </div>
    );
  }

  return (
    <div className={styles.outer}>
      <PanelWarnings lines={lines} />
      <div className={styles.wrap} data-testid="slurm-node-grid">
        {model.groups.map((group) => (
          <NodeGroup key={group.key} group={group} display={display} options={options} />
        ))}
      </div>
    </div>
  );
}
