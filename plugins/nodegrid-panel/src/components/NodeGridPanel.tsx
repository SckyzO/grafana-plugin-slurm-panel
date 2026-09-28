import React, { useCallback, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { FieldType, getDisplayProcessor, textUtil } from '@grafana/data';
import type { Field, GrafanaTheme2, PanelProps } from '@grafana/data';
import { getTemplateSrv } from '@grafana/runtime';
import { useTheme2 } from '@grafana/ui';
import { parseBladeTable, parseSlotTable } from '@slurm-views/core';
import type { SlurmNode } from '@slurm-views/core';
import { useNodeModel } from '../hooks/useNodeModel';
import { NodeGroup } from './NodeGroup';
import { PanelWarnings } from './PanelWarnings';
import { layoutBlades, layoutSlots, resolveCellSize } from './rackGeometry';
import { collectUnmapped, summarise, unresolvedBindings } from '../utils/warnings';
import type { UnresolvedBinding } from '../utils/warnings';
import type { PanelOptions } from '../types';

const getStyles = (theme: GrafanaTheme2, layout: PanelOptions['layout'], centred: boolean) => ({
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
    // Only ever in the rack layout: the wrap layout is one column, and
    // centring a column moves nothing.
    justifyContent: layout === 'rack' && centred ? 'center' : 'flex-start',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
  }),
  empty: css({ color: theme.colors.text.secondary, padding: theme.spacing(1) }),
});

/** One empty list, so a panel with no answer yet does not hand its memos a new one each render. */
const NO_BINDINGS: UnresolvedBinding[] = [];

export function NodeGridPanel({ data, options, fieldConfig, replaceVariables }: PanelProps<PanelOptions>) {
  const theme = useTheme2();
  const styles = getStyles(theme, options.layout, options.centreRacks);
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
  //
  // Sanitised here because this is the boundary where an untrusted string
  // becomes a URL, and again at the click in NodeCell, which is exported and
  // whose href prop the type does not constrain. Here first: the template can name a
  // dashboard variable, and a dashboard variable is settable from the query
  // string by anyone who can view the dashboard — `?var-target=javascript:…`
  // needs no edit rights at all. Grafana sanitises the links it renders
  // itself; a panel that navigates by hand does not inherit that.
  // sanitizeUrl turns a javascript: URL into about:blank and leaves an
  // ordinary relative link untouched.
  const linkTemplate = fieldConfig.defaults.links?.[0]?.url;
  const hrefFor = useCallback(
    (node: SlurmNode): string | undefined =>
      linkTemplate === undefined
        ? undefined
        : textUtil.sanitizeUrl(
            getTemplateSrv().replace(linkTemplate, {
              __node: { text: node.name, value: node.name },
              __state: { text: node.state, value: node.state },
            })
          ),
    [linkTemplate]
  );

  const unmapped = useMemo(
    () =>
      collectUnmapped(
        model.groups.flatMap((g) => g.nodes),
        stateDisplay
      ),
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
  const slots = useMemo(() => {
    const table = parseSlotTable(options.slotOverrides);
    const layout = layoutSlots({
      groups: model.groups.map((g) => ({ key: g.key, nodes: g.nodes.length })),
      blades: blades.layout,
      declared: table.slots,
      fallback: options.slotsPerRack,
      cellHeight: cell.height,
    });
    return { table, layout };
  }, [options.slotOverrides, options.slotsPerRack, cell.height, model.groups, blades.layout]);
  // Undefined until the queries are Done. The last answer is kept across a
  // refresh, which draws the panel again while Loading with the previous
  // series: recomputing then would blank the binding lines for the length of
  // every query and put them back after it, shifting the grid each time.
  // Kept in state, the way React stores information from previous renders:
  // `fresh` is memoised, so once kept it is the same array and this settles.
  const fresh = useMemo(() => unresolvedBindings(data, options.queries), [data, options.queries]);
  const [kept, setKept] = useState<UnresolvedBinding[] | undefined>(undefined);
  if (fresh !== undefined && fresh !== kept) {
    setKept(fresh);
  }
  const unresolved = fresh ?? kept ?? NO_BINDINGS;
  const answered = fresh !== undefined || kept !== undefined;
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
          : undefined,
        options.layout === 'rack'
          ? {
              problems: slots.table.problems.map((p) => p.detail),
              undrawn: slots.layout.undrawn,
              overflowing: slots.layout.overflowing,
            }
          : undefined,
        { colorMode: options.colorMode, stateLabel: options.labels.state, queries: options.queries, unresolved }
      ),
    [
      model,
      warnings,
      unmapped,
      grouping,
      options.layout,
      options.colorMode,
      options.labels.state,
      options.queries,
      unresolved,
      blades,
      slots,
    ]
  );

  if (model.groups.length === 0) {
    // A no-identity warning is the reason there is nothing to draw, so it
    // belongs here as much as in the populated case below. Nothing to say
    // before the queries are back: an empty grid then is not an answer. And
    // when the strip already names the state query as unresolved, advice
    // about its node label would send the reader to the wrong place.
    const stateUnresolved = unresolved.some((b) => b.roles.includes('state'));
    return (
      <div className={styles.outer}>
        <PanelWarnings lines={lines} />
        {answered && (
          <div className={styles.empty}>
            {stateUnresolved ? 'No nodes.' : 'No nodes. Check that the state query returns a node label.'}
          </div>
        )}
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
            slots={slots.layout}
          />
        ))}
      </div>
    </div>
  );
}
