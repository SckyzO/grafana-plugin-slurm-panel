import React from 'react';
import { css, cx } from '@emotion/css';
import type { DisplayProcessor, GrafanaTheme2 } from '@grafana/data';
import { Tooltip, useTheme2 } from '@grafana/ui';
import type { SlurmNode } from '@slurm-views/core';
import { NodeTooltip } from './NodeTooltip';

const getStyles = (theme: GrafanaTheme2) => ({
  cell: css({
    flex: '0 0 auto',
    // No border radius: rounding eats the colour that carries the meaning.
    borderRadius: 0,
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    '&:focus-visible': {
      outline: `2px solid ${theme.colors.primary.border}`,
      outlineOffset: 1,
    },
  }),
  // A node with no value for the state query stays distinguishable from one
  // whose state matched no mapping. Collapsing the two is how a dead node
  // ends up green. `percent` (see `mapped` below) is what keeps this true:
  // it is only set when the value fell through to the threshold path.
  unmapped: css({ background: 'transparent', boxShadow: `inset 0 0 0 1.5px ${theme.colors.text.disabled}` }),
});

export interface NodeCellProps {
  node: SlurmNode;
  size: number;
  display: DisplayProcessor;
  shapeChannel: boolean;
  href?: string;
  /** Inside a rack a slot is wide and short — a 1U sled, not a square. */
  sled?: boolean;
}

/**
 * The second encoding, off by default. With it on the grid survives
 * greyscale, print, forced-colors and a red-green deficiency whatever
 * palette the site chose.
 */
function shapeFor(text: string): string | undefined {
  if (/not responding|drained|maintenance/.test(text)) {
    return 'polygon(0 0, 66% 0, 100% 34%, 100% 100%, 0 100%)';
  }
  if (/down/.test(text)) {
    return 'polygon(0 0, 100% 0, 100% 62%, 62% 100%, 0 100%, 0 38%)';
  }
  return undefined;
}

export function NodeCell({ node, size, display, shapeChannel, href, sled }: NodeCellProps) {
  const theme = useTheme2();
  const styles = getStyles(theme);
  const dv = display(node.state);
  // Grafana returns early when a value mapping matches, so `percent` is only
  // set when nothing did and the value fell through to the threshold path.
  // Do not compare text: a mapping whose result equals its input — `idle`
  // maps to "idle" — is a real match that text comparison reports as a miss.
  const mapped = dv.percent === undefined;

  return (
    <Tooltip content={<NodeTooltip node={node} />} placement="top" interactive>
      <button
        type="button"
        className={cx(styles.cell, !mapped && styles.unmapped)}
        data-testid={`node-cell-${node.name}`}
        data-state={node.state}
        data-mapped={mapped}
        aria-label={`${node.name}, ${dv.text}`}
        style={{
          width: sled ? 'auto' : size,
          alignSelf: sled ? 'stretch' : undefined,
          height: sled ? Math.max(5, Math.round(size / 2)) : size,
          background: mapped ? dv.color : undefined,
          clipPath: shapeChannel ? shapeFor(dv.text) : undefined,
        }}
        onClick={href ? () => window.open(href, '_self') : undefined}
      />
    </Tooltip>
  );
}
