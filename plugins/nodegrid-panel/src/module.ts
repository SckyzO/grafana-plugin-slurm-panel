import { PanelPlugin } from '@grafana/data';
import { NodeGridPanel } from './components/NodeGridPanel';
import { DEFAULT_OPTIONS } from './types';
import type { PanelOptions } from './types';

export const plugin = new PanelPlugin<PanelOptions>(NodeGridPanel)
  // Without this call Grafana shows no Standard options, no Thresholds and no
  // Value mappings, and every cell is painted the same colour. It is covered
  // by an end-to-end test rather than trusted.
  .useFieldConfig()
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
        path: 'cellSize',
        name: 'Cell size',
        description: 'Below 10px a cell stops being a usable hover target.',
        defaultValue: DEFAULT_OPTIONS.cellSize,
        settings: { min: 6, max: 48, step: 1 },
        category: ['Layout'],
      })
      .addSliderInput({
        path: 'gap',
        name: 'Cell gap',
        description: 'The gap is what makes a grid readable, not a border.',
        defaultValue: DEFAULT_OPTIONS.gap,
        settings: { min: 0, max: 8, step: 1 },
        category: ['Layout'],
      });
  })
  .setNoPadding();
