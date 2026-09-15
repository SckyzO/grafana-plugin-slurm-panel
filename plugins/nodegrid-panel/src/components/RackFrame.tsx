import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useTheme2 } from '@grafana/ui';
import { rackWidthFor } from './rackGeometry';

const getStyles = (theme: GrafanaTheme2, width: number, dashed: boolean) => ({
  // column-reverse so slot 1 sits at the bottom, the way a rack is read.
  rack: css({
    display: 'flex',
    flexDirection: 'column-reverse',
    flexWrap: 'nowrap',
    width,
    gap: 2,
    padding: theme.spacing(0.5),
    minHeight: theme.spacing(3),
    // A cabinet frame, heavier at the foot, unless the panel could not resolve
    // what belongs in it: it refuses to draw a solid cabinet around a claim it
    // did not resolve.
    border: `1px ${dashed ? 'dashed' : 'solid'} ${theme.colors.border.medium}`,
    borderBottomWidth: dashed ? 1 : 3,
  }),
});

export interface RackFrameProps {
  children: React.ReactNode;
  /** The cell width the cabinet is sized from. */
  cellWidth: number;
  dashed?: boolean;
}

export function RackFrame({ children, cellWidth, dashed = false }: RackFrameProps) {
  const theme = useTheme2();
  const styles = getStyles(theme, rackWidthFor(cellWidth), dashed);
  return (
    <div className={styles.rack} data-testid="rack-frame" data-dashed={dashed}>
      {children}
    </div>
  );
}
