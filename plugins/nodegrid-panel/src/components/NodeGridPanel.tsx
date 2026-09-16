import React, { useCallback, useMemo } from 'react';
import { css } from '@emotion/css';
import { FieldType, getDisplayProcessor } from '@grafana/data';
import type { Field, GrafanaTheme2, PanelProps } from '@grafana/data';
import { getTemplateSrv } from '@grafana/runtime';
import { useTheme2 } from '@grafana/ui';
import { parseBladeTable } from '@slurm-views/core';
import type { SlurmNode } from '@slurm-views/core';
import { useNodeModel } from '../hooks/useNodeModel';
import { NodeGroup } from './NodeGroup';
import { PanelWarnings } from './PanelWarnings';
import { layoutBlades, layoutSlots, resolveCellSize } from './rackGeometry';
import { collectUnmapped, summarise } from '../utils/warnings';
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

export function NodeGridPanel({ data, options, fieldConfig, replaceVariables }: PanelProps<PanelOptions>) {
  const theme = useTheme2();
  const styles = getStyles(theme, options.layout);
  const { model, warnings, stateField, grouping } = useNodeModel(data, options, replaceVariables);

  // Colour is never chosen here. The state string goes through the field
  // config's value mappings and comes back with a theme colour attached.
  const stateDisplay = useMemo(() => {
    const base: Field = stateField ?? {
      name: options.labels.state,
      type: FieldType.string,
      values: [],
      config: {},
    };
    return getDisplayProcessor({ field: { ...base, config: fieldConfig.defaults }, theme });
  }, [stateField, fieldConfig.defaults, options.labels.state, theme]);

  // The continuous colour modes resolve a 0-100 utilisation fraction through
  // the same Thresholds the operator already configured, not a scale of our
  // own — this processor is what does that resolution.
  const valueDisplay = useMemo(() => {
    const field: Field = {
      name: options.colorMode,
      type: FieldType.number,
      values: [],
      config: { ...fieldConfig.defaults, unit: 'percent', min: 0, max: 100 },
    };
    return getDisplayProcessor({ field, theme });
  }, [fieldConfig.defaults, options.colorMode, theme]);

  // The first data link on the field config, interpolated per node. A link
  // the user cannot address with ${__node} / ${__state} is worse than no
  // link, so this goes through getTemplateSrv() rather than naive string
  // substitution.
  const linkTemplate = fieldConfig.defaults.links?.[0]?.url;
  const hrefFor = useCallback(
    (node: SlurmNode): string | undefined =>
      linkTemplate === undefined
        ? undefined
        : getTemplateSrv().replace(linkTemplate, {
            __node: { text: node.name, value: node.name },
            __state: { text: node.state, value: node.state },
          }),
    [linkTemplate]
  );

  const unmapped = useMemo(
    () => collectUnmapped(model.groups.flatMap((g) => g.nodes), stateDisplay),
    [model.groups, stateDisplay]
  );
  // Goes through the same resolution as every other consumer of cell size,
  // rather than reading options.cellWidth directly: two paths that can read
  // the same number differently is the defect class the border fix
  // (5ebb879) already fell into once.
  const cell = resolveCellSize(options);
  // Resolved once for the whole panel, because the width every cabinet shares
  // depends on the densest blade across all of them. Computed in both layouts
  // and consumed only in Rack: the cost is one pass over the groups, and a
  // conditional hook is worse than a wasted one.
  const blades = useMemo(() => {
    const table = parseBladeTable(options.bladeOverrides);
    const layout = layoutBlades({
      groupKeys: model.groups.map((g) => g.key),
      sizes: table.sizes,
      fallback: options.nodesPerBlade,
      cellWidth: cell.width,
    });
    return { table, layout };
  }, [options.bladeOverrides, options.nodesPerBlade, cell.width, model.groups]);
  // Resolved once for the whole panel, for the same reason blades is: the
  // levelled height and the band every cabinet shares depend on every group
  // at once. Consumed only in Rack, computed in both — a conditional hook is
  // worse than a wasted one.
  //
  // Nothing is declared yet: an empty table and no panel-wide number is the
  // levelling default, which is what makes a short cabinet stand on the floor
  // without anyone configuring anything. Task 4 points these two at options.
  const slots = useMemo(
    () =>
      layoutSlots({
        groups: model.groups.map((g) => ({ key: g.key, nodes: g.nodes.length })),
        blades: blades.layout,
        declared: new Map<string, number>(),
        fallback: undefined,
        cellHeight: cell.height,
      }),
    [cell.height, model.groups, blades.layout]
  );
  const lines = useMemo(
    () =>
      summarise(
        model,
        warnings,
        unmapped,
        grouping,
        // Only in the rack layout: the options are hidden in Wrap, so warning
        // about a table nobody can see would be warning about nothing.
        options.layout === 'rack'
          ? {
              problems: blades.table.problems.map((p) => p.detail),
              undrawn: blades.layout.undrawn,
              squeezed: blades.layout.squeezed,
            }
          : undefined
      ),
    [model, warnings, unmapped, grouping, options.layout, blades]
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
          <NodeGroup
            key={group.key}
            group={group}
            stateDisplay={stateDisplay}
            valueDisplay={valueDisplay}
            colorMode={options.colorMode}
            hrefFor={hrefFor}
            options={options}
            blades={blades.layout}
            slots={slots}
          />
        ))}
      </div>
    </div>
  );
}
