import { collapseHostlist, expandHostlist } from '../group/hostlist.js';

/**
 * The supported range for nodes in one cabinet slot. 1 is a single-node
 * server, which is the truth for most clusters and the panel's default; 8 is
 * the widest chassis this is built for, and a bound is what stops a typo
 * turning one rack into a thousand-column row.
 */
export const MIN_BLADE = 1;
export const MAX_BLADE = 8;

export interface BladeProblem {
  /** 1-based, so it matches what the operator sees in the textarea. */
  line: number;
  detail: string;
}

export interface BladeTable {
  /** Group name to nodes per blade. The first line naming a group keeps it. */
  sizes: Map<string, number>;
  problems: BladeProblem[];
}

/**
 * How many nodes share a cabinet slot, per group.
 *
 * One line per declaration: a Slurm hostlist of *group* names, a colon, then a
 * count. The hostlist is on the left rather than the right, which is the
 * mirror of the Ranges table and is what makes a floor of 125 cabinets two
 * lines instead of 125.
 *
 * Nothing here throws and nothing is fatal. A bad line is skipped and
 * reported against its own line number, because a table that blanks the whole
 * panel on one typo cannot be edited in a textarea.
 */
export function parseBladeTable(table: string): BladeTable {
  const sizes = new Map<string, number>();
  const problems: BladeProblem[] = [];

  table.split('\n').forEach((raw, i) => {
    const line = i + 1;
    // A floor plan long enough to want this option is long enough to want
    // section headings, so `#` comments to end of line — as in the Ranges table.
    const text = (raw.split('#')[0] ?? '').trim();
    if (text === '') {
      return;
    }

    const colon = text.indexOf(':');
    if (colon < 1) {
      problems.push({ line, detail: `Line ${line} has no "groups: count" separator.` });
      return;
    }

    const expr = text.slice(0, colon).trim();
    const countText = text.slice(colon + 1).trim();
    if (expr === '' || countText === '') {
      problems.push({
        line,
        detail: `Line ${line} is missing a ${expr === '' ? 'group list' : 'count'}.`,
      });
      return;
    }

    if (!/^\d+$/.test(countText)) {
      problems.push({
        line,
        detail: `Line ${line} ("${countText}") is not a whole number of nodes per blade.`,
      });
      return;
    }

    const count = Number(countText);
    if (count < MIN_BLADE || count > MAX_BLADE) {
      problems.push({
        line,
        detail: `Line ${line} asks for ${count} nodes per blade; the range is ${MIN_BLADE} to ${MAX_BLADE}.`,
      });
      return;
    }

    const { names, error } = expandHostlist(expr);
    if (error !== undefined) {
      problems.push({ line, detail: `Line ${line} ("${expr}"): ${error}.` });
      return;
    }

    const repeated: string[] = [];
    for (const name of names) {
      if (sizes.has(name)) {
        repeated.push(name);
        continue;
      }
      sizes.set(name, count);
    }

    if (repeated.length > 0) {
      // Collapsed back into a hostlist: a duplicated rack[1-120] line is one
      // problem, not a hundred and twenty.
      const list = collapseHostlist(repeated).join(',');
      const verb = repeated.length === 1 ? 'is' : 'are';
      problems.push({
        line,
        detail: `${list} ${verb} already declared above; the first declaration keeps its count.`,
      });
    }
  });

  return { sizes, problems };
}
