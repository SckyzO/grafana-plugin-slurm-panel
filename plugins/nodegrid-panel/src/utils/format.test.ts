import { formatAge, formatBytes } from './format';

describe('formatAge', () => {
  it.each([
    [0, 'just now'],
    [45, '45s'],
    [90, '1m'],
    [3600, '1h'],
    [5400, '1h 30m'],
    [86400, '1d'],
    [176400, '2d 1h'],
  ])('renders %s seconds as %s', (seconds, expected) => {
    expect(formatAge(seconds)).toBe(expected);
  });

  it('does not render a negative age as a future time', () => {
    // Clock skew between the exporter and Prometheus is real.
    expect(formatAge(-5)).toBe('just now');
  });
});

describe('formatBytes', () => {
  it.each([
    [512, '512 MiB'],
    [1024, '1 GiB'],
    [1536, '1.5 GiB'],
    [1048576, '1 TiB'],
  ])('renders %s MiB as %s', (mib, expected) => {
    expect(formatBytes(mib)).toBe(expected);
  });
});
