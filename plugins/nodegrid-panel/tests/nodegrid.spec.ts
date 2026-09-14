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
    await expect.poll(() => cells.count(), { timeout: 15_000 }).toBeGreaterThan(10);
  });

  test('paints different states different colours', async ({ gotoDashboardPage, readProvisionedDashboard, page }) => {
    // This is the useFieldConfig() regression test. Without that call in
    // module.ts, Grafana never applies the panel's value mappings and every
    // cell comes out the same colour — a defect no unit test can see because
    // the engine has no notion of a field config or a rendered colour.
    const dashboard = await readProvisionedDashboard({ fileName: 'slurm-node-grid.json' });
    await gotoDashboardPage(dashboard);

    const mapped = page.locator('[data-testid^="node-cell-"][data-mapped="true"]');
    await expect.poll(() => mapped.count(), { timeout: 15_000 }).toBeGreaterThan(10);

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

test.describe('the options editor', () => {
  test('exposes the standard sections, which proves useFieldConfig is wired', async ({
    panelEditPage,
    readProvisionedDataSource,
    page,
  }) => {
    const ds = await readProvisionedDataSource({ fileName: 'prometheus.yml' });
    await panelEditPage.datasource.set(ds.name);
    await panelEditPage.setVisualization('Slurmnodegrid');

    await expect(page.getByRole('button', { name: /Value mappings/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /Standard options/i })).toBeVisible({ timeout: 15_000 });
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
