import { FieldConfigProperty, PanelPlugin } from '@grafana/data';
import { MAX_BLADE, MAX_SLOT, MIN_BLADE, MIN_SLOT } from '@slurm-views/core';
import { NodeGridPanel } from './components/NodeGridPanel';
import { MIN_CELL_HEIGHT } from './components/rackGeometry';
import { DEFAULT_MAPPINGS } from './defaults/mappings';
import { BladeEditor } from './editor/BladeEditor';
import { GroupingEditor } from './editor/GroupingEditor';
import { SlotEditor } from './editor/SlotEditor';
import { DEFAULT_OPTIONS } from './types';
import type { PanelOptions } from './types';

export const plugin = new PanelPlugin<PanelOptions>(NodeGridPanel)
  // Without this call Grafana shows no Standard options, no Thresholds and no
  // Value mappings, and every cell is painted the same colour. It is covered
  // by an end-to-end test rather than trusted.
  .useFieldConfig({
    standardOptions: {
      // Ship the Slurm state colours as the default value of the standard
      // Mappings option, so a panel dropped on a new dashboard is coloured
      // before anyone configures anything.
      //
      // This is not the mechanism that was tried and abandoned earlier. A
      // custom option editor cannot do this: it receives a
      // StandardEditorContext, which has no onFieldConfigChange, so it can
      // never write fieldConfig.defaults. `standardOptions` is the supported
      // route, and it is a default rather than a lock — the Value mappings
      // section still lists every rule, and editing, reordering or deleting them
      // works exactly as it would on any other panel.
      //
      // These rules are not obvious and do not survive being retyped from
      // memory: an undelimited pattern gets wrapped in ^...$ by Grafana, and
      // RegexToText replaces the matched portion rather than labelling the
      // value. See docs/value-mappings.md.
      [FieldConfigProperty.Mappings]: { defaultValue: DEFAULT_MAPPINGS },
    },
  })
  .setPanelOptions((builder) => {
    builder
      .addTextInput({
        path: 'labels.node',
        name: 'Node label',
        description: 'The label carrying node identity.',
        defaultValue: DEFAULT_OPTIONS.labels.node,
        category: ['Data'],
      })
      .addTextInput({
        path: 'labels.state',
        name: 'State label',
        description: 'The label carrying the Slurm state.',
        defaultValue: DEFAULT_OPTIONS.labels.state,
        category: ['Data'],
      })
      .addTextInput({
        path: 'queries.state',
        name: 'State query',
        description: 'refId of the query returning slurm_node_status.',
        defaultValue: DEFAULT_OPTIONS.queries.state,
        category: ['Data'],
      })
      .addRadio({
        path: 'layout',
        name: 'Layout',
        defaultValue: DEFAULT_OPTIONS.layout,
        settings: {
          options: [
            { value: 'wrap', label: 'Wrap' },
            { value: 'rack', label: 'Rack' },
          ],
        },
        category: ['Layout'],
      })
      .addSliderInput({
        path: 'cellWidth',
        name: 'Cell width',
        description: 'Below 10px a cell stops being a usable hover target.',
        defaultValue: DEFAULT_OPTIONS.cellWidth,
        // Up to 64: a rack cabinet is as wide as its blade is deep, so a quad
        // blade at the old ceiling of 48 already ran to 200px and a floor of
        // nine cabinets no longer fit a half-width panel. The ceiling exists
        // to stop a slider producing a grid of four cells, not to pick a size.
        settings: { min: 6, max: 64, step: 1 },
        category: ['Layout'],
      })
      .addNumberInput({
        path: 'cellHeight',
        name: 'Cell height',
        description: 'Leave empty to derive it: a square in Wrap, a sled in Rack.',
        settings: { placeholder: 'auto', min: MIN_CELL_HEIGHT, max: 48 },
        category: ['Layout'],
      })
      .addSliderInput({
        path: 'nodesPerBlade',
        name: 'Nodes per blade',
        description:
          'How many nodes share one slot in the cabinet. 1 is a single-node server, and draws one sled per node.',
        defaultValue: DEFAULT_OPTIONS.nodesPerBlade,
        settings: { min: MIN_BLADE, max: MAX_BLADE, step: 1 },
        category: ['Layout'],
        // A blade means nothing outside a cabinet.
        showIf: (options) => options.layout === 'rack',
      })
      .addCustomEditor({
        id: 'bladeOverrides',
        path: 'bladeOverrides',
        name: 'Nodes per blade, by group',
        description:
          'One line per declaration: a hostlist of group names, a colon, a count. Note the mirror of Ranges — the hostlist is on the left here, and names groups rather than nodes. # comments to end of line.',
        editor: BladeEditor,
        defaultValue: DEFAULT_OPTIONS.bladeOverrides,
        category: ['Layout'],
        showIf: (options) => options.layout === 'rack',
      })
      .addNumberInput({
        path: 'slotsPerRack',
        name: 'Slots per rack',
        description:
          'How many chassis positions a cabinet has — slots, not nodes: a slot holds a whole blade. Leave empty to level every cabinet to the tallest one drawn.',
        settings: { placeholder: 'auto', min: MIN_SLOT, max: MAX_SLOT },
        category: ['Layout'],
        // A cabinet's height means nothing outside a cabinet.
        showIf: (options) => options.layout === 'rack',
      })
      .addCustomEditor({
        id: 'slotOverrides',
        path: 'slotOverrides',
        name: 'Slots per rack, by group',
        description:
          'One line per declaration: a hostlist of group names, a colon, a slot count. A declared cabinet keeps its height even when its neighbours are taller. # comments to end of line.',
        editor: SlotEditor,
        defaultValue: DEFAULT_OPTIONS.slotOverrides,
        category: ['Layout'],
        showIf: (options) => options.layout === 'rack',
      })
      .addSliderInput({
        path: 'gap',
        name: 'Cell gap',
        description:
          'Space between cells in the Wrap layout. The gap is what makes a grid readable, not a border.',
        defaultValue: DEFAULT_OPTIONS.gap,
        settings: { min: 0, max: 8, step: 1 },
        category: ['Layout'],
        // Wrap only, and hidden elsewhere rather than left inert: a cabinet's
        // internal spacing is RACK_GAP, a constant, so this slider did nothing
        // at all in the Rack layout while still inviting a reader to drag it.
        // A control that silently ignores you is worse than one that is absent.
        showIf: (options) => options.layout === 'wrap',
      })
      .addBooleanSwitch({
        path: 'showNodeCount',
        name: 'Node count',
        description: 'Show how many nodes each group holds, under its name.',
        defaultValue: DEFAULT_OPTIONS.showNodeCount,
        category: ['Layout'],
      })
      .addBooleanSwitch({
        path: 'centreRacks',
        name: 'Centre the cabinets',
        description: 'Centre the row of cabinets in the panel instead of packing it against the left edge.',
        defaultValue: DEFAULT_OPTIONS.centreRacks,
        category: ['Layout'],
        // Nothing to centre outside a cabinet: the wrap layout is one column.
        showIf: (options) => options.layout === 'rack',
      })
      .addBooleanSwitch({
        path: 'shapeChannel',
        name: 'Shape channel',
        description:
          'Carry state as a shape as well as a fill. Off by default. Turn it on for a red-green colour deficiency, for greyscale, or for print: "not responding" and "allocated" measure Delta E 4.8 under protanopia, which the fill alone cannot separate.',
        defaultValue: DEFAULT_OPTIONS.shapeChannel,
        category: ['Display'],
      })
      .addRadio({
        path: 'colorMode',
        name: 'Colour by',
        description: 'One encoding at a time. Continuous modes are driven by Thresholds.',
        defaultValue: DEFAULT_OPTIONS.colorMode,
        settings: {
          options: [
            { value: 'state', label: 'State' },
            { value: 'cpu', label: 'CPU' },
            { value: 'mem', label: 'Memory' },
            { value: 'gres', label: 'GPU' },
          ],
        },
        category: ['Display'],
      })
      .addCustomEditor({
        id: 'grouping',
        path: 'grouping',
        name: 'Group by',
        description: 'A label, a capture on the node name, a declared range table, or a chunk of its ordinal.',
        editor: GroupingEditor,
        defaultValue: DEFAULT_OPTIONS.grouping,
        category: ['Grouping'],
      })
      .addBooleanSwitch({
        path: 'multiValueLabel',
        name: 'Node may appear in several groups',
        description:
          'Draw a node once per partition it belongs to. Only the partition label is supported: fanning out an arbitrary multi-valued label would need a per-node map of every value, which the engine does not build.',
        defaultValue: DEFAULT_OPTIONS.multiValueLabel,
        category: ['Grouping'],
      });
  })
  .setNoPadding();
