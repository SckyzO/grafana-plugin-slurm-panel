import React from 'react';
import { render, screen } from '@testing-library/react';
import { RackFrame } from './RackFrame';
import { rackWidthFor } from './rackGeometry';

// jsdom has no layout engine, but it does parse Emotion's injected
// stylesheet, so getComputedStyle sees literal property values (verified
// against @emotion/css before relying on it here). That is enough to pin
// the properties that make a rack read as a rack: slots fill bottom-up by a
// reversed cross axis, the cabinet has a heavier foot, and its width tracks
// the cell size. A
// mutation that strips these out of RackFrame's styles — even one that
// keeps the component rendering and the test id in place — fails these
// assertions.
describe('RackFrame', () => {
  it('fills bottom-up by a reversed cross axis, gives the cabinet a heavier foot, and sizes it from the cell size', () => {
    render(
      <RackFrame width={rackWidthFor(14)}>
        <button type="button">slot</button>
      </RackFrame>
    );
    const frame = screen.getByTestId('rack-frame');
    const computed = getComputedStyle(frame);

    expect(computed.flexDirection).toBe('row');
    expect(computed.flexWrap).toBe('wrap-reverse');
    expect(computed.borderBottomWidth).toBe('3px');
    expect(computed.width).toBe(`${rackWidthFor(14)}px`);
  });

  it('tracks a different cell size, rather than a value fixed at build time', () => {
    render(
      <RackFrame width={rackWidthFor(20)}>
        <button type="button">slot</button>
      </RackFrame>
    );
    expect(getComputedStyle(screen.getByTestId('rack-frame')).width).toBe(`${rackWidthFor(20)}px`);
  });
});
