import React, { useMemo } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2, StandardEditorProps } from '@grafana/data';
import { Field, Input, RadioButtonGroup, useTheme2 } from '@grafana/ui';
import { ingest, makeKeyFn, UNGROUPED } from '@slurm-views/core';
import type { KeySource, MinimalFrame } from '@slurm-views/core';
import type { PanelOptions } from '../types';

const getStyles = (theme: GrafanaTheme2) => ({
  preview: css({
    marginTop: theme.spacing(1),
    padding: theme.spacing(1),
    background: theme.colors.background.secondary,
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  row: css({ display: 'flex', justifyContent: 'space-between', gap: theme.spacing(2) }),
  none: css({ color: theme.colors.warning.text }),
  assumed: css({ color: theme.colors.warning.text, fontStyle: 'italic' }),
});

type Props = StandardEditorProps<KeySource, unknown, PanelOptions>;

// DataFrame -> the structural shape core accepts, without core importing
// Grafana. `Field.values` is already a plain array in the installed
// @grafana/data (the old Vector/`toArray()` wrapper is gone), so this needs
// no cast.
const toMinimalFrame = (frame: Props['context']['data'][number]): MinimalFrame => ({
  refId: frame.refId,
  fields: frame.fields.map((f) => ({
    name: f.name,
    type: f.type,
    labels: f.labels,
    values: f.values,
  })),
});

export function GroupingEditor({ value, onChange, context }: Props) {
  const theme = useTheme2();
  const styles = getStyles(theme);
  const source: KeySource = value ?? { kind: 'none' };
  const options = context.options;

  // The preview runs the real key function over the node names actually
  // present, so a pattern that matches nothing says so while it is typed.
  const preview = useMemo(() => {
    if (context.data.length === 0 || !options) {
      return [];
    }
    const frames: MinimalFrame[] = context.data.map(toMinimalFrame);
    const { nodes } = ingest({ frames, slots: options.slots, labels: options.labels });
    const keyFn = makeKeyFn(source);
    return nodes.slice(0, 8).map((node) => ({ name: node.name, ...keyFn(node) }));
  }, [context.data, options, source]);

  return (
    <>
      <RadioButtonGroup
        value={source.kind}
        options={[
          { value: 'none', label: 'None' },
          { value: 'label', label: 'Label' },
          { value: 'capture', label: 'Capture' },
          { value: 'chunk', label: 'Chunk' },
        ]}
        onChange={(kind) => {
          if (kind === 'label') {
            onChange({ kind, label: 'partition' });
          } else if (kind === 'capture') {
            onChange({ kind, pattern: '^(r\\d+)' });
          } else if (kind === 'chunk') {
            onChange({ kind, size: 40 });
          } else {
            onChange({ kind: 'none' });
          }
        }}
      />

      {source.kind === 'label' && (
        <Field label="Label" description="A label the data already carries.">
          <Input value={source.label} onChange={(e) => onChange({ kind: 'label', label: e.currentTarget.value })} />
        </Field>
      )}

      {source.kind === 'capture' && (
        <Field label="Pattern" description="The first capture group becomes the key. Example: ^(r\d+)c\d+n\d+$">
          <Input
            value={source.pattern}
            onChange={(e) => onChange({ kind: 'capture', pattern: e.currentTarget.value })}
          />
        </Field>
      )}

      {source.kind === 'chunk' && (
        <Field
          label="Nodes per group"
          description="Slices the node ordinal. This invents structure, and every group it makes says so."
        >
          <Input
            type="number"
            value={source.size}
            onChange={(e) => onChange({ kind: 'chunk', size: Number.parseInt(e.currentTarget.value, 10) || 0 })}
          />
        </Field>
      )}

      {preview.length > 0 && (
        <div className={styles.preview} data-testid="grouping-preview">
          {preview.map((row) => (
            <div className={styles.row} key={row.name}>
              <span>{row.name}</span>
              <span className={row.key === UNGROUPED ? styles.none : row.assumed ? styles.assumed : undefined}>
                {row.key}
                {row.assumed ? ' (assumed)' : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
