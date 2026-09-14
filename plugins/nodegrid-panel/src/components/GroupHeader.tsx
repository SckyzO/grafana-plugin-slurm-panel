import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useTheme2 } from '@grafana/ui';
import type { NodeGroup as NodeGroupModel } from '@slurm-views/core';

const getStyles = (theme: GrafanaTheme2) => ({
  // One line: a rail carrying the name, the count and the assumed marker.
  header: css({
    display: 'flex',
    alignItems: 'baseline',
    gap: theme.spacing(1),
    fontSize: theme.typography.bodySmall.fontSize,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    paddingBottom: theme.spacing(0.25),
  }),
  name: css({ fontFamily: theme.typography.fontFamilyMonospace, color: theme.colors.text.primary }),
  count: css({ color: theme.colors.text.secondary }),
  assumed: css({ color: theme.colors.warning.text, fontStyle: 'italic' }),
});

export function GroupHeader({ group }: { group: NodeGroupModel }) {
  const theme = useTheme2();
  const styles = getStyles(theme);
  return (
    <div className={styles.header}>
      <span className={styles.name}>{group.key}</span>
      <span className={styles.count}>{group.nodes.length} nodes</span>
      {/* Chunking invents structure. The claim stays visible in the panel,
          not only in the editor. */}
      {group.assumed && <span className={styles.assumed}>assumed</span>}
    </div>
  );
}
