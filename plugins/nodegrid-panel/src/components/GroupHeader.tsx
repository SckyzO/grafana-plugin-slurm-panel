import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useTheme2 } from '@grafana/ui';
import type { NodeGroup as NodeGroupModel } from '@slurm-views/core';

const getStyles = (theme: GrafanaTheme2, stacked: boolean) => ({
  // A rail carrying the name, the count and the assumed marker. Side by side
  // in the wrap layout, where the group is as wide as the row; stacked and
  // centred over a cabinet, where the group is only as wide as the frame and
  // a long name beside a count would decide the cabinet's width for it.
  header: css({
    display: 'flex',
    flexDirection: stacked ? 'column' : 'row',
    alignItems: stacked ? 'center' : 'baseline',
    gap: stacked ? 0 : theme.spacing(1),
    fontSize: theme.typography.bodySmall.fontSize,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    paddingBottom: theme.spacing(0.25),
  }),
  name: css({ fontFamily: theme.typography.fontFamilyMonospace, color: theme.colors.text.primary }),
  count: css({ color: theme.colors.text.secondary }),
  assumed: css({ color: theme.colors.warning.text, fontStyle: 'italic' }),
  unplaced: css({ color: theme.colors.error.text, fontStyle: 'italic' }),
});

export interface GroupHeaderProps {
  group: NodeGroupModel;
  unplaced: boolean;
  /** Name over count, centred. The rack layout's shape. */
  stacked?: boolean;
  /** The count is the reader's to hide; the name never is. */
  showCount?: boolean;
}

export function GroupHeader({ group, unplaced, stacked = false, showCount = true }: GroupHeaderProps) {
  const theme = useTheme2();
  const styles = getStyles(theme, stacked);
  return (
    <div className={styles.header}>
      <span className={styles.name}>{group.key}</span>
      {showCount && (
        <span className={styles.count}>
          {group.nodes.length} {group.nodes.length === 1 ? 'node' : 'nodes'}
        </span>
      )}
      {/* Chunking invents structure. The claim stays visible in the panel,
          not only in the editor. */}
      {group.assumed && <span className={styles.assumed}>assumed</span>}
      {/* A different admission, and so a different word: `assumed` means the
          group was invented, `unplaced` means these nodes found no group. */}
      {unplaced && <span className={styles.unplaced}>unplaced</span>}
    </div>
  );
}
