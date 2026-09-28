import React from 'react';
import { render, screen } from '@testing-library/react';
import { PanelWarnings } from './PanelWarnings';

describe('PanelWarnings', () => {
  // Keyed on the text, two identical lines were two children with one key:
  // React warns, and may reconcile one onto the other. Nothing upstream
  // promises the lines are distinct.
  it('draws two identical lines as two lines, without a key collision', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <PanelWarnings lines={['Query A skipped: no node label or column', 'Query A skipped: no node label or column']} />
    );
    expect(screen.getAllByText('Query A skipped: no node label or column')).toHaveLength(2);
    expect(error.mock.calls.some((call) => String(call[0]).includes('same key'))).toBe(false);
    error.mockRestore();
  });
});
