import { collapseHostlist, expandHostlist } from '../group/hostlist.js';

export interface CountProblem {
  /** 1-based, so it matches what the operator sees in the textarea. */
  line: number;
  detail: string;
}

export interface CountTable {
  /** Group name to count. The first line naming a group keeps it. */
  counts: Map<string, number>;
  problems: CountProblem[];
}

export interface CountBounds {
  min: number;
  max: number;
  /**
   * What the count counts, worded to sit mid-sentence: "nodes per blade",
   * "slots". Both problem messages below read as English with either.
   */
  noun: string;
}

/**
 * One line per declaration: a Slurm hostlist of *group* names, a colon, then a
 * whole number inside bounds.
 *
 * The hostlist is on the left rather than the right, which is the mirror of
 * the Ranges table and is what makes a floor of 125 cabinets two lines instead
 * of 125.
 *
 * Nothing here throws and nothing is fatal. A bad line is skipped and reported
 * against its own line number, because a table that blanks the whole panel on
 * one typo cannot be edited in a textarea.
 */
export function parseCountTable(table: string, { min, max, noun }: CountBounds): CountTable {
  const counts = new Map<string, number>();
  const problems: CountProblem[] = [];

  table.split('\n').forEach((raw, i) => {
    const line = i + 1;
    // A floor plan long enough to want this option is long enough to want
    // section headings, so `#` comments to end of line, as in the Ranges table.
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
    // expr cannot be empty here: text is already trimmed and colon < 1 above
    // has already returned, so at least one non-space character sits before
    // the colon.
    if (countText === '') {
      problems.push({ line, detail: `Line ${line} is missing a count.` });
      return;
    }

    if (!/^\d+$/.test(countText)) {
      problems.push({ line, detail: `Line ${line} ("${countText}") is not a whole number of ${noun}.` });
      return;
    }

    const count = Number(countText);
    if (count < min || count > max) {
      problems.push({ line, detail: `Line ${line} asks for ${count} ${noun}; the range is ${min} to ${max}.` });
      return;
    }

    const { names, error } = expandHostlist(expr);
    if (error !== undefined) {
      problems.push({ line, detail: `Line ${line} ("${expr}"): ${error}.` });
      return;
    }

    const repeated: string[] = [];
    for (const name of names) {
      if (counts.has(name)) {
        repeated.push(name);
        continue;
      }
      counts.set(name, count);
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

  return { counts, problems };
}
