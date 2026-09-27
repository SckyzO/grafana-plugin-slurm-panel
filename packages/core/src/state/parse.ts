export interface StateModifier {
  symbol: string;
  label: string;
}

export interface ParsedState {
  base: string;
  modifiers: StateModifier[];
  /** Human-readable form for the tooltip: "mixed, planned by backfill". */
  text: string;
  raw: string;
}

/**
 * sinfo compresses the node flags into a single trailing character. scontrol
 * shows the same thing expanded, as State=DOWN+DYNAMIC_NORM+NOT_RESPONDING.
 */
const MODIFIERS: Record<string, string> = {
  '*': 'not responding',
  '~': 'powered down',
  '#': 'powering up',
  '!': 'power down pending',
  '%': 'powering down',
  '$': 'in a maintenance reservation',
  '@': 'reboot pending',
  '^': 'reboot issued',
  '-': 'planned by backfill',
};

export function parseState(raw: string): ParsedState {
  if (raw === '') {
    return { base: '', modifiers: [], text: '', raw };
  }

  const last = raw.slice(-1);
  const label = MODIFIERS[last];

  // Only a documented modifier is split off. An unrecognised trailing
  // character stays part of the base state — guessing at it is how a state
  // added in a future Slurm release becomes silently wrong.
  if (label === undefined) {
    return { base: raw, modifiers: [], text: raw, raw };
  }

  const base = raw.slice(0, -1);
  return { base, modifiers: [{ symbol: last, label }], text: `${base}, ${label}`, raw };
}
