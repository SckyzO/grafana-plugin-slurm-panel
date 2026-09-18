import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useTheme2 } from '@grafana/ui';
import { RACK_BORDER, RACK_FOOT, RACK_GAP, RACK_PADDING } from './rackGeometry';

const getStyles = (theme: GrafanaTheme2, width: number, height: number, dashed: boolean) => ({
  rack: css({
    display: 'flex',
    // A row that wraps, with the cross axis reversed: rows fill left to right
    // and the first one sits at the bottom, so node 1 is at the foot of the
    // cabinet, which is how a rack is read. At one node per blade this is one
    // sled per row, which is what column-reverse drew before it.
    flexDirection: 'row',
    flexWrap: 'wrap-reverse',
    // With the cross axis reversed, flex-start is the bottom: a half-full
    // cabinet fills from the floor rather than hanging from the ceiling.
    alignContent: 'flex-start',
    width,
    // An explicit height, not a min-height: rows that do not fit then spill
    // past the cross-end, the top, outside the frame's border, rather than
    // growing the cabinet silently past what was declared.
    height,
    // Sourced from rackGeometry rather than hardcoded here a second time,
    // sledWidthFor and frameHeight assume these same three numbers, and the
    // two disagreeing is exactly what let a sled overflow the frame before
    // 5ebb879.
    gap: RACK_GAP,
    padding: RACK_PADDING,
    // A cabinet frame, heavier at the foot, unless the panel could not resolve
    // what belongs in it: it refuses to draw a solid cabinet around a claim it
    // did not resolve.
    border: `${RACK_BORDER}px ${dashed ? 'dashed' : 'solid'} ${theme.colors.border.medium}`,
    borderBottomWidth: dashed ? RACK_BORDER : RACK_FOOT,
  }),
});

export interface RackFrameProps {
  children: React.ReactNode;
  /** The cabinet's width in pixels, resolved by layoutBlades. */
  width: number;
  /** The cabinet's height in pixels, resolved by layoutSlots. */
  height: number;
  dashed?: boolean;
}

export function RackFrame({ children, width, height, dashed = false }: RackFrameProps) {
  const theme = useTheme2();
  const styles = getStyles(theme, width, height, dashed);
  return (
    <div className={styles.rack} data-testid="rack-frame" data-dashed={dashed}>
      {children}
    </div>
  );
}
