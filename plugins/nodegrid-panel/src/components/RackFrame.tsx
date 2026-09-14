import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useTheme2 } from '@grafana/ui';

const getStyles = (theme: GrafanaTheme2, width: number) => ({
  // column-reverse so slot 1 sits at the bottom, the way a rack is read.
  rack: css({
    display: 'flex',
    flexDirection: 'column-reverse',
    flexWrap: 'nowrap',
    width,
    gap: 2,
    padding: theme.spacing(0.5),
    // A cabinet frame, heavier at the foot.
    border: `1px solid ${theme.colors.border.medium}`,
    borderBottomWidth: 3,
  }),
});

export interface RackFrameProps {
  children: React.ReactNode;
  width: number;
}

export function RackFrame({ children, width }: RackFrameProps) {
  const theme = useTheme2();
  const styles = getStyles(theme, width);
  return (
    <div className={styles.rack} data-testid="rack-frame">
      {children}
    </div>
  );
}
