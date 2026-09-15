import { expect, test } from '@grafana/plugin-e2e';

test.describe('the node grid renders against a real Grafana', () => {
  test('draws one cell per node from the provisioned dashboard', async ({
    gotoDashboardPage,
    readProvisionedDashboard,
    page,
  }) => {
    const dashboard = await readProvisionedDashboard({ fileName: 'slurm-node-grid.json' });
    await gotoDashboardPage(dashboard);

    await expect(page.getByTestId('slurm-node-grid')).toBeVisible({ timeout: 15_000 });
    const cells = page.locator('[data-testid^="node-cell-"]');
    // The synthetic exporter publishes 240 nodes across 6 racks. A bound of
    // 10 would pass even if a frame-shape defect silently dropped 200 of
    // them; 200 catches a partial ingest failure, not only a total one, and
    // stays a lower bound so it survives someone changing SYNTH_NODES.
    await expect.poll(() => cells.count(), { timeout: 15_000 }).toBeGreaterThan(200);
  });

  test('paints different states different colours', async ({ gotoDashboardPage, readProvisionedDashboard, page }) => {
    // This is the useFieldConfig() regression test. Without that call in
    // module.ts, Grafana never applies the panel's value mappings and every
    // cell comes out the same colour — a defect no unit test can see because
    // the engine has no notion of a field config or a rendered colour.
    const dashboard = await readProvisionedDashboard({ fileName: 'slurm-node-grid.json' });
    await gotoDashboardPage(dashboard);

    const mapped = page.locator('[data-testid^="node-cell-"][data-mapped="true"]');
    // 173 of the 240 synthetic nodes match a shipped mapping today. 100 stays
    // a lower bound (survives a SYNTH_NODES change) while still failing on a
    // partial render (e.g. one rack's worth, ~29 cells) that a bound of 10
    // would let through unnoticed.
    await expect.poll(() => mapped.count(), { timeout: 15_000 }).toBeGreaterThan(100);

    const colours = await mapped.evaluateAll((nodes) =>
      Array.from(new Set(nodes.map((n) => getComputedStyle(n).backgroundColor)))
    );
    expect(colours.length).toBeGreaterThan(2);
  });

  test('spells a state out in words in the tooltip', async ({ gotoDashboardPage, readProvisionedDashboard, page }) => {
    const dashboard = await readProvisionedDashboard({ fileName: 'slurm-node-grid.json' });
    await gotoDashboardPage(dashboard);

    const cells = page.locator('[data-testid^="node-cell-"]');
    await expect.poll(() => cells.count(), { timeout: 15_000 }).toBeGreaterThan(0);

    await cells.first().hover();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toBeVisible({ timeout: 15_000 });
    await expect(tooltip.getByText('State', { exact: true })).toBeVisible();
  });

  test('names a state the shipped rules have never seen', async ({
    gotoDashboardPage,
    readProvisionedDashboard,
    page,
  }) => {
    // Against the synthetic exporter this used to fire on perfctrs, blocked
    // and inval — all real Slurm states the rules did not cover, and all
    // covered now. Pointing it back at the exporter would make it a test of
    // which states happen to be unmapped this week. The scenarios dashboard
    // carries one state that is not a Slurm state at all and never will be,
    // standing in for whatever a future Slurm introduces.
    const dashboard = await readProvisionedDashboard({ fileName: 'slurm-node-scenarios.json' });
    await gotoDashboardPage(dashboard);

    const strip = page.getByTestId('panel-warnings').first();
    await expect(strip).toBeVisible({ timeout: 20_000 });
    await expect(strip).toContainText('1 state matched no value mapping');
    await expect(strip).toContainText('a_state_slurm_adds_tomorrow');

    // Naming the state says what is wrong. The panel also has to say what to
    // do about it, with a rule that is correct as printed: delimited, so
    // Grafana does not wrap it into an exact match, and spanning the whole
    // value, so the replacement does not glue itself onto the remainder.
    await expect(strip).toContainText('condition Regex');
    await expect(strip).toContainText('/^a_state_slurm_adds_tomorrow.*$/');

    // And it is drawn as having nothing to say rather than coloured — the
    // whole point of naming it. With thresholds configured, the alternative is
    // that Grafana paints it with the threshold base colour and an unknown
    // state reads as a healthy one.
    const hollow = page.locator('[data-testid^="node-cell-"][data-filled="false"]');
    await expect.poll(() => hollow.count(), { timeout: 20_000 }).toBe(1);
  });
});

test.describe('the panel supplies its own state colours', () => {
  test('colours a dashboard that configures no value mappings at all', async ({
    gotoDashboardPage,
    readProvisionedDashboard,
    page,
  }) => {
    // slurm-node-scenarios.json carries no fieldConfig.defaults.mappings: not
    // an empty array, the key is absent. Anything coloured here came from the
    // plugin's own standardOptions default, which is the whole claim. Written
    // against a build without that default first, where it failed with 0
    // mapped cells out of 31.
    const dashboard = await readProvisionedDashboard({ fileName: 'slurm-node-scenarios.json' });
    await gotoDashboardPage(dashboard);

    await expect(page.getByTestId('slurm-node-grid').first()).toBeVisible({ timeout: 15_000 });

    // One compound selector, not `.locator(cell).locator(mapped)` — the second
    // form searches for a mapped element *inside* each cell and matches
    // nothing, which reports zero on a grid that is fully coloured.
    const mapped = page.locator('[data-testid^="node-cell-"][data-mapped="true"]');
    // The four panels carry 231 cells between them and 220 match a shipped
    // rule. A bound of 1 would pass on a single lucky cell; 150 fails if the
    // defaults reach only one panel, and stays clear of 220 so that adding an
    // unmapped state to the reference panel does not break it.
    await expect.poll(() => mapped.count(), { timeout: 15_000 }).toBeGreaterThan(150);

    // Mapped is not the same as coloured: a uniformly grey grid would still
    // report every cell as mapped. The eleven rules resolve to nine colours.
    const colours = await mapped.evaluateAll((nodes) =>
      Array.from(new Set(nodes.map((n) => getComputedStyle(n).backgroundColor)))
    );
    expect(colours.length).toBeGreaterThan(4);
  });
});

test.describe('the continuous colour modes', () => {
  test('resolves occupancy through thresholds and leaves a node with no data empty', async ({
    gotoDashboardPage,
    readProvisionedDashboard,
    page,
  }) => {
    const dashboard = await readProvisionedDashboard({ fileName: 'slurm-node-utilisation.json' });
    await gotoDashboardPage(dashboard);

    const grids = page.locator('[data-testid="slurm-node-grid"]');
    await expect.poll(() => grids.count(), { timeout: 20_000 }).toBe(4);

    // Panel 2 is CPU occupancy. Every synthetic node reports cpu_alloc and
    // cpu_total, so every cell has a value and none may be drawn empty — if
    // the facet slots stopped being read this would be 240, not 0.
    const cpu = grids.nth(1).locator('[data-testid^="node-cell-"]');
    await expect.poll(() => cpu.count(), { timeout: 20_000 }).toBeGreaterThan(200);
    expect(await cpu.locator(':scope[data-filled="false"]').count()).toBe(0);

    // More than one threshold band is reached, which is what says the fill is
    // coming from Thresholds rather than from a single fallback colour.
    const bands = await cpu.evaluateAll((nodes) =>
      Array.from(new Set(nodes.map((n) => getComputedStyle(n).backgroundColor)))
    );
    expect(bands.length).toBeGreaterThan(1);

    // Panel 4 is GPU occupancy, where most synthetic nodes have no GPU at all.
    // Those must be drawn as empty rather than filled: an undefined background
    // on a <button> falls back to the browser's ButtonFace grey, which reads
    // as a real measurement and once covered two thirds of this panel.
    const gpu = grids.nth(3).locator('[data-testid^="node-cell-"]');
    await expect.poll(() => gpu.locator(':scope[data-filled="false"]').count(), { timeout: 20_000 })
      .toBeGreaterThan(50);
    const empty = gpu.locator(':scope[data-filled="false"]').first();
    expect(await empty.evaluate((n) => getComputedStyle(n).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  });

  test('groups the same nodes four different ways', async ({
    gotoDashboardPage,
    readProvisionedDashboard,
    page,
  }) => {
    const dashboard = await readProvisionedDashboard({ fileName: 'slurm-node-grouping.json' });
    await gotoDashboardPage(dashboard);

    const grids = page.locator('[data-testid="slurm-node-grid"]');
    // A floor, not an identity. This dashboard carries more panels than this
    // test is about, and how many of them Grafana has rendered depends on how
    // many fit above the fold — which panel heights change. Pinning the total
    // made this test an assertion about lazy rendering rather than about
    // grouping, and it broke the day the panels were resized.
    await expect.poll(() => grids.count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(4);

    // The first four panels read the same 32-row CSV, so a differing cell
    // count means a grouping key dropped nodes rather than regrouping them.
    for (let i = 0; i < 4; i++) {
      await expect
        .poll(() => grids.nth(i).locator('[data-testid^="node-cell-"]').count(), { timeout: 20_000 })
        .toBe(32);
    }

    // The capture panel splits c* from g* on the node name, which is the only
    // structure a real slurm_exporter offers: it publishes no rack label.
    await expect(grids.nth(1).getByText('c', { exact: true })).toBeVisible();
    await expect(grids.nth(1).getByText('g', { exact: true })).toBeVisible();

    // Chunking is the one key that asserts structure the data never stated,
    // and the panel has to say so on every group it invents.
    await expect(grids.nth(2).getByText('chunk 1', { exact: true })).toBeVisible();
    await expect(grids.nth(2).getByText('assumed', { exact: true }).first()).toBeVisible();
  });
});

test.describe('the options editor', () => {
  test('exposes the standard sections, which proves useFieldConfig is wired', async ({
    panelEditPage,
    readProvisionedDataSource,
  }) => {
    const ds = await readProvisionedDataSource({ fileName: 'prometheus.yml' });
    await panelEditPage.datasource.set(ds.name);
    await panelEditPage.setVisualization('Slurmnodegrid');

    // A bare `getByRole('button', { name: /Value mappings/i })` is ambiguous:
    // once the group is expanded it also matches the "Add value mappings"
    // button inside it. The group's own page model scopes to the section,
    // toggle and content together, matching what a missing useFieldConfig()
    // call would remove entirely.
    await expect(panelEditPage.getValueMappingOptions().element).toBeVisible({ timeout: 15_000 });
    await expect(panelEditPage.getStandardOptions().element).toBeVisible({ timeout: 15_000 });
  });

  test('previews the grouping key against the nodes present', async ({
    gotoPanelEditPage,
    readProvisionedDashboard,
    page,
  }) => {
    const dashboard = await readProvisionedDashboard({ fileName: 'slurm-node-grid.json' });
    // "Nodes by rack" (id 1 in slurm-node-grid.json) is the dashboard's only panel.
    await gotoPanelEditPage({ dashboard, id: '1' });

    await expect(page.getByTestId('grouping-preview')).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('the primary overview dashboard groups by the rack it now has', () => {
  test('renders a named rack group and leaves nothing ungrouped', async ({
    gotoDashboardPage,
    readProvisionedDashboard,
    page,
  }) => {
    // Regression coverage for a stale capture pattern ('^(r\\d+)') that once
    // matched rack-encoded synthetic node names and matches nothing now that
    // names are flat (c1..c160, g1..g80): every node on this dashboard's one
    // panel rendered as ungrouped until the grouping was switched to the
    // relabelled `rack` label.
    const dashboard = await readProvisionedDashboard({ fileName: 'slurm-node-grid.json' });
    await gotoDashboardPage(dashboard);

    await expect(page.getByTestId('node-group-rack1')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('node-group-ungrouped')).toHaveCount(0);
  });
});

test.describe('the utilisation dashboard groups the same six racks on every panel', () => {
  test('shows all six named racks and drops nothing into ungrouped, on every panel', async ({
    gotoDashboardPage,
    readProvisionedDashboard,
    page,
  }) => {
    // Regression coverage for these four panels' grouping: this branch
    // switched State, CPU, Memory and GPU occupancy from a capture pattern
    // ('^(r\\d+)') to the relabelled `rack` label. The colour test above only
    // checks fill behaviour on panels 2 and 4 and would keep passing even if
    // the grouping key were wrong — every panel would just render one
    // "ungrouped" block instead of six named racks, with nothing failing.
    const dashboard = await readProvisionedDashboard({ fileName: 'slurm-node-utilisation.json' });
    await gotoDashboardPage(dashboard);

    const grids = page.locator('[data-testid="slurm-node-grid"]');
    await expect.poll(() => grids.count(), { timeout: 20_000 }).toBe(4);

    const racks = ['rack1', 'rack2', 'rack3', 'rack4', 'gpu1', 'gpu2'];
    for (let i = 0; i < 4; i++) {
      const grid = grids.nth(i);
      for (const key of racks) {
        await expect(grid.getByTestId(`node-group-${key}`)).toBeVisible({ timeout: 15_000 });
      }
      await expect(grid.getByTestId('node-group-ungrouped')).toHaveCount(0);
    }
  });
});

test.describe('the three ways to get a topology, proven against the same live data', () => {
  const racks = ['rack1', 'rack2', 'gpu1'];

  test('rung 1 groups by a relabelled Prometheus label', async ({ page }) => {
    await page.goto('/d/slurm-node-grouping/grouping?viewPanel=5');
    for (const key of racks) {
      await expect(page.getByTestId(`node-group-${key}`)).toBeVisible();
    }
  });

  test('rung 2 groups by a column joined onto the frame', async ({ page }) => {
    // The Grafana-native answer for anyone whose Prometheus carries no
    // location dimension at all. The panel datasource is -- Mixed --, query A
    // asks Prometheus for Format: Table so it returns one row per node
    // instead of one frame per series, and Join by field (byField node, mode
    // outer) merges query B's CSV zone column onto it.
    //
    // The inventory's dimension is named "zone", not "rack": relabelling
    // already puts a rack label carrying the same three values on query A, so
    // asserting rack1/rack2/gpu1 here would pass whether or not the join ever
    // ran. "zone" and aisleA/aisleB/aisleC exist nowhere else in the stack -
    // the only way a group by that name can appear is if the join supplied
    // it.
    await page.goto('/d/slurm-node-grouping/grouping?viewPanel=6');
    for (const key of ['aisleA', 'aisleB', 'aisleC']) {
      await expect(page.getByTestId(`node-group-${key}`)).toBeVisible();
    }
    await expect(page.getByTestId('node-group-ungrouped')).toHaveCount(0);
  });

  test('rung 3 groups by a range table held in a dashboard variable', async ({ page }) => {
    await page.goto('/d/slurm-node-grouping/grouping?viewPanel=7');
    for (const key of racks) {
      await expect(page.getByTestId(`node-group-${key}`)).toBeVisible();
    }
    // Interpolation is the part that fails silently: an uninterpolated
    // "$racks" parses as one bad line and places no node at all.
    await expect(page.getByTestId('node-group-ungrouped')).toHaveCount(0);
  });
});

test.describe('the coverage signal, proven by a source that deliberately covers less', () => {
  test('an incomplete range table draws the orphans as unplaced and names a wider label', async ({ page }) => {
    await page.goto('/d/slurm-node-grouping/grouping?viewPanel=8');

    // The table names only rack1: c[1-40] against the full 240-node cluster,
    // so 40 nodes are placed and the other 200 fall outside every range.
    const placed = page.getByTestId('node-group-rack1');
    await expect(placed).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => placed.locator('[data-testid^="node-cell-"]').count(), { timeout: 15_000 }).toBe(40);

    const orphaned = page.getByTestId('node-group-ungrouped');
    await expect(orphaned).toBeVisible();
    await expect(orphaned).toHaveAttribute('data-unplaced', 'true');
    await expect.poll(() => orphaned.locator('[data-testid^="node-cell-"]').count(), { timeout: 15_000 }).toBe(200);

    // Both signals on one panel: the orphan line names what the range table
    // missed, and the coverage line names the label that would have covered
    // all 240 - the measurement that stays silent on every other panel here,
    // because their sources already cover every node.
    const strip = page.getByTestId('panel-warnings').first();
    await expect(strip).toBeVisible({ timeout: 15_000 });
    await expect(strip).toContainText('200 nodes matched no range');
    await expect(strip).toContainText('Label "rack" would group all 240');
  });
});
