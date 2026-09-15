import { expandHostlist } from './hostlist.js';
import { UNGROUPED } from './keys.js';

export interface RangeGroup {
  name: string;
  /** Node names this group actually claimed, in declared order. */
  members: string[];
}

export interface RangeProblem {
  /** 1-based, so it matches what the operator sees in the textarea. */
  line: number;
  detail: string;
}

export interface RangeTable {
  groups: RangeGroup[];
  /** node name to group name. The first line that claims a node keeps it. */
  index: Map<string, string>;
  problems: RangeProblem[];
}

/**
 * A node-to-group table: one line per group, `name: hostlist`, in display
 * order.
 *
 * Nothing here throws and nothing here is fatal. One bad line is skipped and
 * reported while the rest still parses, because this string is typed by hand
 * into a panel option and is invalid for most of the time it is being typed.
 * A grid that blanks on every keystroke cannot be used.
 */
export function parseRangeTable(table: string): RangeTable {
  const groups: RangeGroup[] = [];
  const index = new Map<string, string>();
  const problems: RangeProblem[] = [];

  table.split('\n').forEach((raw, i) => {
    const line = i + 1;
    // A 200-line table wants section headings, so `#` comments to end of line.
    const text = (raw.split('#')[0] ?? '').trim();
    if (text === '') {
      return;
    }

    const colon = text.indexOf(':');
    if (colon < 1) {
      problems.push({ line, detail: `Line ${line} has no "name: hostlist" separator.` });
      return;
    }

    const name = text.slice(0, colon).trim();
    const expr = text.slice(colon + 1).trim();
    if (name === '' || expr === '') {
      problems.push({ line, detail: `Line ${line} is missing a ${name === '' ? 'name' : 'hostlist'}.` });
      return;
    }
    if (groups.some((g) => g.name === name)) {
      problems.push({ line, detail: `Line ${line} declares "${name}" again; the first declaration keeps its nodes.` });
      return;
    }
    if (name === UNGROUPED) {
      // The panel draws a node with no group under this exact name. A
      // declared group by that name would place its nodes as asked and then
      // have the panel report them right back as unplaced.
      problems.push({
        line,
        detail: `Line ${line}: "${UNGROUPED}" is reserved for nodes the panel could not place.`,
      });
      return;
    }

    const { names, error } = expandHostlist(expr);
    if (error !== undefined) {
      problems.push({ line, detail: `Line ${line} ("${name}"): ${error}.` });
      return;
    }

    const members: string[] = [];
    for (const nodeName of names) {
      const owner = index.get(nodeName);
      if (owner !== undefined) {
        problems.push({
          line,
          detail: `${nodeName} is claimed by both "${owner}" and "${name}"; kept in "${owner}".`,
        });
        continue;
      }
      index.set(nodeName, name);
      members.push(nodeName);
    }
    groups.push({ name, members });
  });

  return { groups, index, problems };
}
