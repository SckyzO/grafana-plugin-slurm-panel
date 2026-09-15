import { expandHostlist, collapseHostlist, EXPANSION_CAP } from '../src/group/hostlist.js';

describe('expandHostlist', () => {
  it('expands a simple range', () => {
    expect(expandHostlist('c[1-5]').names).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
  });

  it('expands a mixed body of ranges and singletons', () => {
    expect(expandHostlist('c[1-3,7,10-11]').names).toEqual(['c1', 'c2', 'c3', 'c7', 'c10', 'c11']);
  });

  it('keeps the written width, because node[001-003] is not node1', () => {
    expect(expandHostlist('node[001-003]').names).toEqual(['node001', 'node002', 'node003']);
  });

  it('joins several expressions on the commas that are outside brackets', () => {
    expect(expandHostlist('c[1-2],g[1-2]').names).toEqual(['c1', 'c2', 'g1', 'g2']);
  });

  it('accepts a bare name with no brackets at all', () => {
    expect(expandHostlist('login1').names).toEqual(['login1']);
  });

  it('keeps a suffix after the bracket', () => {
    expect(expandHostlist('r[1-2]n1').names).toEqual(['r1n1', 'r2n1']);
  });

  it('reports a backwards range rather than returning nothing silently', () => {
    const { names, error } = expandHostlist('c[5-1]');
    expect(names).toEqual([]);
    expect(error).toContain('backwards');
  });

  it('reports an unbalanced bracket', () => {
    expect(expandHostlist('c[1-5').error).toBeDefined();
  });

  it('reports an expression that names no node, rather than succeeding empty', () => {
    // A trailing comma filters to zero items before any item is validated, so
    // this used to return {names: []} with no error at all — a silently empty
    // group rather than a rejected line.
    const { names, error } = expandHostlist(',');
    expect(names).toEqual([]);
    expect(error).toBeDefined();
  });

  it('refuses to expand past the cap instead of hanging the render', () => {
    const { names, error } = expandHostlist(`c[1-${EXPANSION_CAP + 1}]`);
    expect(names).toEqual([]);
    expect(error).toContain(String(EXPANSION_CAP));
  });
});

describe('collapseHostlist', () => {
  it('collapses a contiguous run', () => {
    expect(collapseHostlist(['c1', 'c2', 'c3'])).toEqual(['c[1-3]']);
  });

  it('breaks a run at every gap', () => {
    expect(collapseHostlist(['c1', 'c2', 'c5'])).toEqual(['c[1-2,5]']);
  });

  it('leaves a lone name alone rather than bracketing it', () => {
    expect(collapseHostlist(['c7'])).toEqual(['c7']);
  });

  it('never merges two widths into one range', () => {
    // c01 and c1 expand back differently, so collapsing them together would
    // produce a string that does not mean what it came from.
    expect(collapseHostlist(['c1', 'c01'])).toEqual(['c01', 'c1']);
  });

  it('round-trips: expanding what it produced gives back what it was given', () => {
    const names = ['c1', 'c2', 'c3', 'c9', 'g1', 'g2'];
    const round = collapseHostlist(names).flatMap((item) => expandHostlist(item).names);
    expect(round.sort()).toEqual([...names].sort());
  });
});
