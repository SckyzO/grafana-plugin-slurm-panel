import type { MinimalFrame, Sample } from '../model/types.js';

const isValueField = (name: string): boolean => name !== 'Time' && name !== 'time';

/**
 * Flatten a frame into samples, reading whichever shape Prometheus returned.
 *
 * numeric-multi: one frame per series, every label on the value field, one row.
 * table:         one frame, a string column per label, one row per series.
 *
 * A panel that reads only one of the two sees no labels at all on the other,
 * so both paths are load-bearing rather than defensive.
 */
/**
 * A label dictionary that inherits nothing.
 *
 * Prometheus label names are `[a-zA-Z_][a-zA-Z0-9_]*`, which admits
 * `constructor`, `toString`, `valueOf` and `hasOwnProperty`. Read off a plain
 * object literal, those four are not `undefined` — they are the members
 * inherited from `Object.prototype` — so a lookup that means "have I seen
 * this label?" answers yes for a label nobody sent, and a value that should
 * be a string is a `Function`. TypeScript cannot see it: the index signature
 * promises `string | undefined` and the prototype chain is not part of the
 * type.
 *
 * Not a prototype-pollution guard. Assigning a string to `__proto__` is inert
 * — the setter takes an object or null — and nothing here mutates
 * `Object.prototype`. This is the read side: an object with no prototype has
 * nothing to inherit, so every lookup answers about the data alone.
 */
const withoutPrototype = (from: Record<string, string> = {}): Record<string, string> =>
  Object.assign(Object.create(null) as Record<string, string>, from);

export function toSamples(frame: MinimalFrame): Sample[] {
  const labelled = frame.fields.find(
    (f) => isValueField(f.name) && f.labels && Object.keys(f.labels).length > 0
  );

  if (labelled) {
    return labelled.values.map((value) => ({ labels: withoutPrototype(labelled.labels), value }));
  }

  const stringFields = frame.fields.filter((f) => f.type === 'string');
  if (stringFields.length === 0) {
    return [];
  }

  const valueField =
    frame.fields.find((f) => f.name === 'Value') ??
    frame.fields.find((f) => f.type === 'number' && isValueField(f.name));

  const rowCount = stringFields[0]?.values.length ?? 0;
  const samples: Sample[] = [];
  for (let row = 0; row < rowCount; row++) {
    const labels: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const field of stringFields) {
      const cell = field.values[row];
      if (typeof cell === 'string') {
        labels[field.name] = cell;
      }
    }
    samples.push({ labels, value: valueField?.values[row] });
  }
  return samples;
}
