import React from 'react';
import { render, screen } from '@testing-library/react';
import type { SlurmNode } from '@slurm-views/core';
import { NodeTooltip } from './NodeTooltip';

const node = (overrides: Partial<SlurmNode> = {}): SlurmNode => ({
  name: 'rack1-node07',
  state: 'drained',
  partitions: ['cpu'],
  labels: {},
  facets: { gres: [] },
  ...overrides,
});

describe('NodeTooltip', () => {
  it('leads with the hostname, in its own band', () => {
    render(<NodeTooltip node={node()} />);
    expect(screen.getByTestId('tooltip-node-name')).toHaveTextContent('rack1-node07');
  });

  it('spells the state out rather than echoing the raw code', () => {
    render(<NodeTooltip node={node({ state: 'mixed-' })} />);
    // The suffix is a separate fact, not part of the state's name.
    expect(screen.getByText('State')).toBeInTheDocument();
    expect(screen.queryByText('mixed-')).toBeNull();
  });

  it('puts a drain reason under its own label, not loose at the end', () => {
    // Free text an operator wrote: it is the one line here that has no
    // label-and-value shape, and before this it rendered with no label at
    // all — a sentence appearing under the facts with nothing to say it was
    // the reason.
    render(
      <NodeTooltip
        node={node({
          facets: { gres: [], drainSince: 7200, drainReason: 'GPU fell off the bus, ticket OPS-4417' },
        })}
      />
    );

    const band = screen.getByTestId('tooltip-reason');
    expect(band).toHaveTextContent('Reason');
    expect(band).toHaveTextContent('GPU fell off the bus, ticket OPS-4417');

    // The duration stays with the facts above, where it lines up with the
    // other label-and-value rows.
    expect(screen.getByText('Drained for')).toBeInTheDocument();
  });

  it('draws no reason band when there is no reason', () => {
    render(<NodeTooltip node={node({ facets: { gres: [], drainSince: 60 } })} />);
    expect(screen.queryByTestId('tooltip-reason')).toBeNull();
    expect(screen.getByText('Drained for')).toBeInTheDocument();
  });

  it('shows a reason on a node that is down rather than drained', () => {
    // Slurm attaches a reason to down and failing nodes too. Keying the band
    // on the state rather than on the data would hide the most actionable
    // line exactly when something is broken.
    render(<NodeTooltip node={node({ state: 'down', facets: { gres: [], drainReason: 'Not responding' } })} />);
    expect(screen.getByTestId('tooltip-reason')).toHaveTextContent('Not responding');
  });
});
