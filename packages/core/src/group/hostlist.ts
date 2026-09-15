/**
 * Slurm hostlist syntax, both ways.
 *
 * `sinfo` prints node sets as `c[1-10,20]`, and every Slurm administrator
 * reads and writes that notation daily. The range table borrows it rather than
 * inventing a grammar, and the same grammar collapses a list of names back for
 * display — which is what keeps a warning about 240 orphans to one line.
 */

/**
 * The most names one expression may expand to. A range table is typed by hand,
 * so `node[1-100000]` is always one keystroke away, and expanding it would
 * hang the render. This is a constant and not an option: a threshold nobody
 * can name a good value for is not a setting, it is a constant with a form
 * around it.
 */
export const EXPANSION_CAP = 20000;

export interface Expansion {
  names: string[];
  /** Set when the expression could not be read. `names` is then empty. */
  error?: string;
}

/** Split on the commas that are outside brackets: `c[1-3],g[1-2]` is two items. */
function splitTop(expr: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of expr) {
    if (ch === '[') {
      depth++;
    } else if (ch === ']') {
      depth = Math.max(0, depth - 1);
    }
    if (ch === ',' && depth === 0) {
      items.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  items.push(current);
  return items.map((s) => s.trim()).filter((s) => s !== '');
}

/** prefix, optional bracketed body, optional suffix — and no stray brackets. */
const ITEM = /^([^[\]]*)(?:\[([^[\]]*)\])?([^[\]]*)$/;
const BOUND = /^(\d+)(?:-(\d+))?$/;

export function expandHostlist(expr: string): Expansion {
  const names: string[] = [];

  for (const item of splitTop(expr)) {
    const parts = ITEM.exec(item);
    if (parts === null) {
      return { names: [], error: `cannot read "${item}"` };
    }
    const prefix = parts[1] ?? '';
    const body = parts[2];
    const suffix = parts[3] ?? '';

    if (body === undefined) {
      if (prefix === '' && suffix === '') {
        return { names: [], error: `cannot read "${item}"` };
      }
      names.push(prefix + suffix);
      continue;
    }

    for (const raw of body.split(',')) {
      const part = raw.trim();
      const bound = BOUND.exec(part);
      if (bound === null) {
        return { names: [], error: `"${part}" is not a number or a range` };
      }
      const startText = bound[1] ?? '';
      const endText = bound[2];
      const start = Number(startText);
      const end = endText === undefined ? start : Number(endText);
      if (end < start) {
        return { names: [], error: `"${part}" counts backwards` };
      }
      if (names.length + (end - start + 1) > EXPANSION_CAP) {
        return { names: [], error: `expands past ${EXPANSION_CAP} names` };
      }
      // Slurm keeps the written width: node[001-100] is node001, not node1.
      const width = startText.length > 1 && startText.startsWith('0') ? startText.length : 0;
      for (let n = start; n <= end; n++) {
        names.push(prefix + String(n).padStart(width, '0') + suffix);
      }
    }
  }

  return { names };
}

const TRAILING = /^(.*?)(\d+)$/;

/**
 * Names collapsed back to hostlist items, one per prefix-and-width run.
 *
 * Width is part of the grouping key on purpose: `c1` and `c01` expand back
 * differently, so a range spanning both would print a string that no longer
 * means what it came from.
 */
export function collapseHostlist(names: string[]): string[] {
  const runs = new Map<string, { prefix: string; width: number; numbers: number[] }>();
  const plain: string[] = [];

  for (const name of names) {
    const match = TRAILING.exec(name);
    if (match === null) {
      plain.push(name);
      continue;
    }
    const prefix = match[1] ?? '';
    const digits = match[2] ?? '';
    const width = digits.length > 1 && digits.startsWith('0') ? digits.length : 0;
    const key = `${prefix} ${width}`;
    const run = runs.get(key) ?? { prefix, width, numbers: [] };
    run.numbers.push(Number(digits));
    runs.set(key, run);
  }

  const out = [...plain];

  for (const { prefix, width, numbers } of runs.values()) {
    const sorted = [...new Set(numbers)].sort((a, b) => a - b);
    const pad = (n: number): string => String(n).padStart(width, '0');
    const parts: string[] = [];
    let start = sorted[0] ?? 0;
    let prev = start;
    const flush = (): void => {
      parts.push(start === prev ? pad(start) : `${pad(start)}-${pad(prev)}`);
    };
    for (const n of sorted.slice(1)) {
      if (n === prev + 1) {
        prev = n;
        continue;
      }
      flush();
      start = n;
      prev = n;
    }
    flush();
    const single = parts.length === 1 && !parts[0]!.includes('-');
    out.push(single ? prefix + parts[0] : `${prefix}[${parts.join(',')}]`);
  }

  return out.sort();
}
