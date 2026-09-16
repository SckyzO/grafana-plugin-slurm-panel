import { FieldConfigProperty, PanelPlugin } from '@grafana/data';
import { NodeGridPanel } from './components/NodeGridPanel';
import { MIN_CELL_HEIGHT } from './components/rackGeometry';
import { DEFAULT_MAPPINGS } from './defaults/mappings';
import { GroupingEditor } from './editor/GroupingEditor';
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
        path: 'slots.state',
        name: 'State query',
        description: 'refId of the query returning slurm_node_status.',
        defaultValue: DEFAULT_OPTIONS.slots.state,
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
        settings: { min: 6, max: 48, step: 1 },
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
        path: 'gap',
        name: 'Cell gap',
        description: 'The gap is what makes a grid readable, not a border.',
        defaultValue: DEFAULT_OPTIONS.gap,
        settings: { min: 0, max: 8, step: 1 },
        category: ['Layout'],
      })
      .addBooleanSwitch({
        path: 'shapeChannel',
        name: 'Shape channel',
        description:
          'Carry state as a shape as well as a fill. Keeps the grid readable in greyscale, in print and with a colour-vision deficiency.',
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
