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

  test('names the states that matched no mapping', async ({ gotoDashboardPage, readProvisionedDashboard, page }) => {
    // The synthetic exporter emits states such as perfctrs, blocked and
    // inval, none of which the shipped mappings cover. They must be named in
    // the panel, not quietly painted grey.
    const dashboard = await readProvisionedDashboard({ fileName: 'slurm-node-grid.json' });
    await gotoDashboardPage(dashboard);

    const strip = page.getByTestId('panel-warnings');
    await expect(strip).toBeVisible({ timeout: 15_000 });
    await expect(strip).toContainText('matched no value mapping');
    // The list is capped at eight named states followed by "and N more" -
    // asserting the full list here would break the moment the cap does its
    // job, so only the cap marker itself is covered.
    await expect(strip).toContainText('and ');
    await expect(strip).toContainText('more');
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
    await expect.poll(() => grids.count(), { timeout: 20_000 }).toBe(4);

    // All four panels read the same 32-row CSV, so a differing cell count
    // means a grouping key dropped nodes rather than regrouping them.
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
