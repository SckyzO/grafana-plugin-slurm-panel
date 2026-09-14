import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useTheme2 } from '@grafana/ui';
import { parseState } from '@slurm-views/core';
import type { SlurmNode } from '@slurm-views/core';
import { formatAge, formatBytes } from '../utils/format';

const getStyles = (theme: GrafanaTheme2) => ({
  wrap: css({ display: 'grid', gap: theme.spacing(0.5), minWidth: 200, maxWidth: 360 }),
  // Node identifiers are tabular data, not a small-label decoration.
  name: css({ fontFamily: theme.typography.fontFamilyMonospace, fontWeight: theme.typography.fontWeightMedium }),
  row: css({ display: 'flex', justifyContent: 'space-between', gap: theme.spacing(2) }),
  label: css({ color: theme.colors.text.secondary }),
  reason: css({
    color: theme.colors.text.primary,
    borderTop: `1px solid ${theme.colors.border.weak}`,
    paddingTop: theme.spacing(0.5),
  }),
});

export function NodeTooltip({ node }: { node: SlurmNode }) {
  const theme = useTheme2();
  const styles = getStyles(theme);
  const state = parseState(node.state);
  const { facets } = node;

  const row = (label: string, value: string) => (
    <div className={styles.row} key={label}>
      <span className={styles.label}>{label}</span>
      <span>{value}</span>
    </div>
  );

  return (
    <div className={styles.wrap}>
      <div className={styles.name}>{node.name}</div>
      {/* "mixed, planned by backfill" rather than "mixed-". */}
      {row('State', state.text)}
      {node.partitions.length > 0 && row('Partitions', node.partitions.join(', '))}
      {facets.cpuTotal !== undefined && row('CPU', `${facets.cpuAlloc ?? 0} / ${facets.cpuTotal}`)}
      {facets.memTotal !== undefined &&
        row('Memory', `${formatBytes(facets.memAlloc ?? 0)} / ${formatBytes(facets.memTotal)}`)}
      {facets.gres.map((g) => row(g.type, `${g.used ?? 0} / ${g.total ?? '?'}`))}
      {facets.drainSince !== undefined && row('Drained for', formatAge(facets.drainSince))}
      {facets.drainReason !== undefined && <div className={styles.reason}>{facets.drainReason}</div>}
    </div>
  );
}
