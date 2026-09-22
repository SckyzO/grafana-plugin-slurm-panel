import { expandHostlist, parseState } from '../src/index.js';

describe('workspace toolchain', () => {
  it('compiles and runs a core module under plain Node', () => {
    // What this test is for is the toolchain, not the behaviour: that the
    // package's native ESM — relative imports carrying the compiled `.js`
    // extension against `.ts` files on disk — resolves under ts-jest and bare
    // Node, with no bundler and no Grafana in sight. If that chain breaks,
    // every other test in this package fails to import and the reason is
    // buried; this one says it in a line.
    //
    // It used to assert a CORE_VERSION literal, which made the package a
    // second place to write the version down — beside packages/core's own
    // manifest, and beside the panel manifest the release workflow gates the
    // tag against. Two real calls prove the same thing and cannot go stale.
    expect(expandHostlist('c[1-3]').names).toEqual(['c1', 'c2', 'c3']);
    expect(parseState('idle*').text).toBe('idle, not responding');
  });
});
