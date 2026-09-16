import React from 'react';
import type { StandardEditorProps } from '@grafana/data';
import { TextArea } from '@grafana/ui';

/**
 * A textarea for the per-group slot table.
 *
 * Grafana's option builder has no textarea — addTextInput is one line — so a
 * table that wants several needs a custom editor. Same construction as the
 * blade table and the Ranges table, and deliberately nothing more than a
 * textarea: this option edits a string, and what the parser cannot read is
 * reported in the panel's own warnings strip, where the reader is already
 * looking.
 */
export function SlotEditor({ value, onChange }: StandardEditorProps<string>) {
  return (
    <TextArea
      rows={5}
      placeholder={'rack[1-120]: 42\nrack[121-125]: 47'}
      value={value ?? ''}
      onChange={(e) => onChange(e.currentTarget.value)}
    />
  );
}
