import React from 'react';
import { render, screen } from '@testing-library/react';
import { RackFrame } from './RackFrame';
import { frameHeight, rackWidthFor } from './rackGeometry';

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
      <RackFrame width={rackWidthFor(14)} height={frameHeight(4, 7)}>
        <button type="button">slot</button>
      </RackFrame>
    );
    const frame = screen.getByTestId('rack-frame');
    const computed = getComputedStyle(frame);

    expect(computed.flexDirection).toBe('row');
    expect(computed.flexWrap).toBe('wrap-reverse');
    // Load-bearing together with the reversed cross axis above: flex-start
    // is what makes a half-full cabinet fill from the floor rather than hang
    // from the ceiling.
    expect(computed.alignContent).toBe('flex-start');
    expect(computed.borderBottomWidth).toBe('3px');
    // This equality proves the width prop reaches the rendered CSS — both
    // sides go through rackWidthFor(14), so it proves nothing about that
    // formula's own geometry, which is rackGeometry.test.ts's job instead.
    expect(computed.width).toBe(`${rackWidthFor(14)}px`);
  });

  it('tracks a different cell size, rather than a value fixed at build time', () => {
    render(
      <RackFrame width={rackWidthFor(20)} height={frameHeight(4, 7)}>
        <button type="button">slot</button>
      </RackFrame>
    );
    expect(getComputedStyle(screen.getByTestId('rack-frame')).width).toBe(`${rackWidthFor(20)}px`);
  });

  it('is drawn at the height it is handed, not at the height of its contents', () => {
    // The cabinet's height is a panel-wide decision — a declaration, or the
    // tallest cabinet on the floor. A frame that sized itself to its contents
    // is what made short racks hang from the ceiling.
    render(
      <RackFrame width={rackWidthFor(14)} height={frameHeight(12, 7)}>
        <button type="button">slot</button>
      </RackFrame>
    );
    expect(getComputedStyle(screen.getByTestId('rack-frame')).height).toBe(`${frameHeight(12, 7)}px`);
  });
});
