import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Icon, useTheme2 } from '@grafana/ui';

const getStyles = (theme: GrafanaTheme2) => ({
  strip: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.25),
    padding: theme.spacing(0.5, 1),
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.warning.text,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  line: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(0.5) }),
});

export function PanelWarnings({ lines }: { lines: string[] }) {
  const theme = useTheme2();
  const styles = getStyles(theme);
  if (lines.length === 0) {
    return null;
  }
  // In the panel, not in a console nobody opens.
  return (
    <div className={styles.strip} data-testid="panel-warnings" role="status">
      {lines.map((line) => (
        <div className={styles.line} key={line}>
          <Icon name="exclamation-triangle" size="sm" />
          <span>{line}</span>
        </div>
      ))}
    </div>
  );
}
