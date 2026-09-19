import { plugin } from './module';
import { DEFAULT_OPTIONS } from './types';
import type { PanelOptions } from './types';

interface Registered {
  path?: string;
  name?: string;
  showIf?: (options: PanelOptions) => boolean | undefined;
}

/**
 * Every option the module actually registers, captured by driving the real
 * options supplier with a recording builder.
 *
 * Not a mock of the editor: this is the same function Grafana calls, so a
 * `showIf` that is missing, inverted or attached to the wrong path fails here.
 * Nothing else in the suite looks at it, which is how a Cell gap slider came
 * to be offered in the Rack layout, where it governs nothing at all.
 */
const registeredOptions = (): Registered[] => {
  const seen: Registered[] = [];
  const builder: unknown = new Proxy(
    {},
    {
      get:
        () =>
        (config: Registered): unknown => {
          seen.push(config);
          return builder;
        },
    }
  );
  (plugin as unknown as { optionsSupplier: (b: unknown) => void }).optionsSupplier(builder);
  return seen;
};

const optionAt = (path: string): Registered => {
  const found = registeredOptions().find((o) => o.path === path);
  if (found === undefined) {
    throw new Error(`no option registered at path "${path}"`);
  }
  return found;
};

const rack: PanelOptions = { ...DEFAULT_OPTIONS, layout: 'rack' };
const wrap: PanelOptions = { ...DEFAULT_OPTIONS, layout: 'wrap' };

describe('the layout-dependent options', () => {
  it('offers Cell gap only where it governs something', () => {
    // In the Rack layout a cabinet's internal spacing is RACK_GAP, a constant,
    // so this slider moved and nothing happened. A control that silently
    // ignores the reader is worse than one that is absent.
    expect(optionAt('gap').showIf?.(wrap)).toBe(true);
    expect(optionAt('gap').showIf?.(rack)).toBe(false);
  });

  it('offers the cabinet options only inside a cabinet', () => {
    for (const path of ['nodesPerBlade', 'bladeOverrides', 'slotsPerRack', 'slotOverrides', 'centreRacks']) {
      expect(optionAt(path).showIf?.(rack)).toBe(true);
      expect(optionAt(path).showIf?.(wrap)).toBe(false);
    }
  });

  it('leaves the options that govern both layouts unconditional', () => {
    for (const path of ['layout', 'cellWidth', 'cellHeight', 'shapeChannel', 'colorMode', 'showNodeCount']) {
      expect(optionAt(path).showIf).toBeUndefined();
    }
  });
});

describe('the defaults a reader inherits without configuring anything', () => {
  it('keeps the node count and the left-packed cabinets it always had', () => {
    // Both options exist so a reader can change what the panel drew before
    // they existed. Neither default may change what it drew.
    expect(DEFAULT_OPTIONS.showNodeCount).toBe(true);
    expect(DEFAULT_OPTIONS.centreRacks).toBe(false);
  });

  it('ships the shape channel off, and offers it', () => {
    // A trade, pinned so it stays a decision rather than drifting: "not
    // responding" against "allocated" measures 4.8 under protanopia, so a
    // reader with a red-green deficiency needs this switch — and the notches
    // cost legibility at 14px for every reader who does not. It ships off and
    // the option is one click away, which is only defensible while the option
    // exists, so this pins both.
    expect(DEFAULT_OPTIONS.shapeChannel).toBe(false);
    expect(optionAt('shapeChannel').name).toBe('Shape channel');
  });
});
