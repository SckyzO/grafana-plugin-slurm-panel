import { CORE_VERSION } from '../src/index.js';

describe('workspace toolchain', () => {
  it('compiles and runs a core module under plain Node', () => {
    expect(CORE_VERSION).toBe('0.1.0');
  });
});
