import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useTheme2 } from '@grafana/ui';
import { parseState } from '@slurm-views/core';
import type { SlurmNode } from '@slurm-views/core';
import { formatAge, formatBytes } from '../utils/format';

const getStyles = (theme: GrafanaTheme2) => ({
  wrap: css({ display: 'grid', gap: theme.spacing(0.5), minWidth: 200, maxWidth: 360 }),
  // The hostname is what the reader came for: every other line answers a
  // question about *this* node, and a tooltip that opens on a hover has to
  // say which one before it says anything else.
  //
  // Sized up rather than weighted up. This theme's fontWeightBold is 500,
  // the same value as fontWeightMedium, so asking for bold here would change
  // nothing on screen; the step has to come from the scale and the rule.
  name: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.h5.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    lineHeight: theme.typography.h5.lineHeight,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    paddingBottom: theme.spacing(0.5),
    // A hostname has no spaces to break at, so a long one would widen the
    // tooltip past its own maximum rather than wrap.
    overflowWrap: 'anywhere',
  }),
  row: css({ display: 'flex', justifyContent: 'space-between', gap: theme.spacing(2) }),
  label: css({ color: theme.colors.text.secondary }),
  // Its own band under a rule: a drain reason is free text written by an
  // operator, so it is the one line here that does not fit the
  // label-and-value shape the rows above use.
  reason: css({
    borderTop: `1px solid ${theme.colors.border.weak}`,
    paddingTop: theme.spacing(0.5),
    display: 'grid',
    gap: theme.spacing(0.25),
  }),
  reasonText: css({
    color: theme.colors.text.primary,
    // Reasons carry node names, ticket ids and paths, none of which break.
    overflowWrap: 'anywhere',
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
      <div className={styles.name} data-testid="tooltip-node-name">
        {node.name}
      </div>
      {/* "mixed, planned by backfill" rather than "mixed-". */}
      {row('State', state.text)}
      {node.partitions.length > 0 && row('Partitions', node.partitions.join(', '))}
      {facets.cpuTotal !== undefined && row('CPU', `${facets.cpuAlloc ?? 0} / ${facets.cpuTotal}`)}
      {facets.memTotal !== undefined &&
        row('Memory', `${formatBytes(facets.memAlloc ?? 0)} / ${formatBytes(facets.memTotal)}`)}
      {facets.gres.map((g) => row(g.type, `${g.used ?? 0} / ${g.total ?? '?'}`))}
      {facets.drainSince !== undefined && row('Drained for', formatAge(facets.drainSince))}
      {/* Shown whenever a reason is present rather than only on a drained
          node: Slurm attaches one to down and failing nodes too, and the
          reason is the most actionable line in the tooltip when it exists. */}
      {facets.drainReason !== undefined && (
        <div className={styles.reason} data-testid="tooltip-reason">
          <span className={styles.label}>Reason</span>
          <span className={styles.reasonText}>{facets.drainReason}</span>
        </div>
      )}
    </div>
  );
}
