import { expect, test, type DashboardPage } from '@grafana/plugin-e2e';
import type { Locator, Page } from '@playwright/test';

/**
 * Open a panel of the grouping dashboard and wait until it has live data.
 *
 * `make up` already waits for Prometheus to return node data before handing
 * the stack over, so this should succeed on the first attempt. It reloads
 * anyway, because the failure it guards cannot be waited out: these dashboards
 * set no auto-refresh, so a panel whose first query runs against an
 * unscraped Prometheus renders empty and stays empty. Nothing re-queries, so a
 * longer assertion timeout buys nothing — only a reload does. That is what
 * made this suite flake roughly one run in ten.
 *
 * The anchor is a group that must exist once the data is there; it is the
 * cheapest proof that the panel drew something rather than nothing.
 */
async function gotoPanelWithData(page: Page, viewPanel: number, anchor: string): Promise<void> {
  const url = `/d/slurm-node-grouping/grouping?viewPanel=${viewPanel}`;
  const group = page.getByTestId(`node-group-${anchor}`);
  const deadline = Date.now() + 60_000;

  for (;;) {
    await page.goto(url);
    try {
      await group.waitFor({ state: 'visible', timeout: 10_000 });
      return;
    } catch {
      if (Date.now() > deadline) {
        // Out of patience: assert so the failure names the panel and the
        // group rather than reporting a bare timeout from the helper.
        await expect(group).toBeVisible({ timeout: 10_000 });
        return;
      }
    }
  }
}

/**
 * The node grid drawn by the panel with this title.
 *
 * Panels used to be reached with `grids.nth(i)` over every grid on the page,
 * which turned each assertion into a claim about where a panel sits rather
 * than about which panel it is. Resizing one panel reorders that list, and
 * the first time it happened it broke two tests that had nothing to do with
 * the change — so a cosmetic fix to a dashboard had to be reverted. A title
 * is what the dashboard JSON actually promises, and renaming a panel is a
 * deliberate act that should fail loudly here.
 *
 * Scrolling first is not decoration: from Grafana 13 the scenes renderer
 * mounts a panel only once its container enters the viewport, so a panel
 * below the fold has no grid in the DOM at all.
 */
async function gridIn(dashboardPage: DashboardPage, title: string): Promise<Locator> {
  const panel = dashboardPage.getPanelByTitle(title);
  await panel.scrollIntoView();
  return panel.locator.getByTestId('slurm-node-grid');
}

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
    // The synthetic exporter publishes 540 nodes across 9 racks, each cabinet
    // twenty slots times its blade density. A bound of 10 would pass even if
    // a frame-shape defect silently dropped most of them; 500 catches a
    // partial ingest failure, not only a total one, and stays a lower bound
    // so it survives someone changing SYNTH_NODES.
    await expect.poll(() => cells.count(), { timeout: 15_000 }).toBeGreaterThan(500);
  });

  test('paints different states different colours', async ({ gotoDashboardPage, readProvisionedDashboard, page }) => {
    // This is the useFieldConfig() regression test. Without that call in
    // module.ts, Grafana never applies the panel's value mappings and every
    // cell comes out the same colour — a defect no unit test can see because
    // the engine has no notion of a field config or a rendered colour.
    const dashboard = await readProvisionedDashboard({ fileName: 'slurm-node-grid.json' });
    await gotoDashboardPage(dashboard);

    const mapped = page.locator('[data-testid^="node-cell-"][data-mapped="true"]');
    // All 540 synthetic nodes match a shipped mapping today: the twenty-one
    // rules cover every sinfo state in both spellings, suffixes included. 400
    // stays a lower bound (survives a SYNTH_NODES change) while still failing
    // on a partial render — the largest rack is eighty cells, which a bound of
    // 10 would let through unnoticed.
    await expect.poll(() => mapped.count(), { timeout: 15_000 }).toBeGreaterThan(400);

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
  test('colours a dashboard that configures no value mappings at all', async ({ page }) => {
    // slurm-node-scenarios.json carries no fieldConfig.defaults.mappings: not
    // an empty array, the key is absent. Anything coloured here came from the
    // plugin's own standardOptions default, which is the whole claim. Written
    // against a build without that default first, where it failed with 0
    // mapped cells out of 31.
    //
    // One panel at a time through ?viewPanel, and asserted per panel rather
    // than as one total over the dashboard. A total is a measure of what
    // Grafana happened to mount: it read 203, then 43 when a panel two rows
    // up grew taller, and scrolling the panels into view fixed it on five of
    // the six images in the CI matrix and not on 13.0.9. Per panel there is
    // nothing left to mount - and "the defaults reach more than one panel" is
    // what this test means anyway, which a sum never quite said.
    const panels: Array<[number, string]> = [
      [1, 'Every state, live'],
      [2, 'A rack on the floor'],
      [3, 'The same rack, read without the shape channel'],
      [4, 'A drain storm, with the reasons attached'],
      [5, 'A production cluster on an ordinary day'],
    ];

    const coloursSeen = new Set<string>();
    for (const [id, title] of panels) {
      await page.goto(`/d/slurm-node-scenarios/scenarios?viewPanel=${id}`);
      const cells = page.locator('[data-testid^="node-cell-"]');
      // One compound selector, not `.locator(cell).locator(mapped)` — the
      // second form searches for a mapped element *inside* each cell and
      // matches nothing, which reports zero on a grid that is fully coloured.
      const mapped = page.locator('[data-testid^="node-cell-"][data-mapped="true"]');
      await expect
        .poll(() => cells.count(), { timeout: 20_000, message: `${title} drew nothing` })
        .toBeGreaterThan(0);

      const [drawn, coloured] = [await cells.count(), await mapped.count()];
      // Every cell but the deliberately unknown state on panel 1, which is
      // there precisely to be unmapped.
      expect(coloured, `${title}: ${coloured} of ${drawn} cells matched a rule`)
        .toBeGreaterThanOrEqual(drawn - 1);

      for (const c of await mapped.evaluateAll((n) =>
        Array.from(new Set(n.map((x) => getComputedStyle(x).backgroundColor)))
      )) {
        coloursSeen.add(c);
      }
    }

    // Mapped is not the same as coloured: a uniformly grey grid would still
    // report every cell as mapped. The twenty-one rules resolve to nine
    // colours, and these five panels between them reach most of them.
    expect(coloursSeen.size).toBeGreaterThan(4);
  });
});

test.describe('the continuous colour modes', () => {
  test('resolves occupancy through thresholds and leaves a node with no data empty', async ({
    gotoDashboardPage,
    readProvisionedDashboard,
  }) => {
    const dashboard = await readProvisionedDashboard({ fileName: 'slurm-node-utilisation.json' });
    const dashboardPage = await gotoDashboardPage(dashboard);

    // Every synthetic node reports cpu_alloc and cpu_total, so every cell has
    // a value and none may be drawn empty — if the facet queries stopped being
    // read this would be 540, not 0.
    const cpu = (await gridIn(dashboardPage, 'CPU occupancy')).locator('[data-testid^="node-cell-"]');
    await expect.poll(() => cpu.count(), { timeout: 20_000 }).toBeGreaterThan(200);
    expect(await cpu.locator(':scope[data-filled="false"]').count()).toBe(0);

    // More than one threshold band is reached, which is what says the fill is
    // coming from Thresholds rather than from a single fallback colour.
    const bands = await cpu.evaluateAll((nodes) =>
      Array.from(new Set(nodes.map((n) => getComputedStyle(n).backgroundColor)))
    );
    expect(bands.length).toBeGreaterThan(1);

    // Most synthetic nodes have no GPU at all. Those must be drawn as empty
    // rather than filled: an undefined background on a <button> falls back to
    // the browser's ButtonFace grey, which reads as a real measurement and
    // once covered two thirds of this panel.
    const gpu = (await gridIn(dashboardPage, 'GPU occupancy')).locator('[data-testid^="node-cell-"]');
    await expect.poll(() => gpu.locator(':scope[data-filled="false"]').count(), { timeout: 20_000 })
      .toBeGreaterThan(50);
    const empty = gpu.locator(':scope[data-filled="false"]').first();
    expect(await empty.evaluate((n) => getComputedStyle(n).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  });

  test('groups the same nodes four different ways', async ({ page }) => {
    // These four panels read the same 32-row CSV, so a differing cell count
    // means a grouping key dropped nodes rather than regrouping them.
    //
    // One panel per load, through gotoPanelWithData, rather than four read
    // off a single page. This dashboard sets no auto-refresh: a panel that
    // draws empty once stays empty, and no assertion timeout rescues it —
    // only a reload does, which is the whole reason that helper exists.
    // Reading all four off one load was the last place in this file still
    // betting on the first render, and it is what failed on one image of the
    // CI matrix, twice, while the other five passed.
    //
    // The anchors are the group keys those four groupings actually produce,
    // read off the running stack rather than guessed: a label grouping keyed
    // by rack, a capture keeping the letter prefix, a chunk naming itself,
    // and the ungrouped bucket the "None" key puts everything in.
    const panels: Array<[number, string, string]> = [
      [1, 'By a label, in rack layout', 'r001'],
      [2, 'By a capture, splitting compute from GPU', 'c'],
      [3, 'By a chunk of the ordinal', 'chunk 1'],
      [4, 'Not grouped at all', 'ungrouped'],
    ];

    for (const [id, title, anchor] of panels) {
      await gotoPanelWithData(page, id, anchor);
      // The message matters: without it a failure reports "expected 32,
      // received 0" and says nothing about which of the four panels it was.
      await expect
        .poll(() => page.locator('[data-testid^="node-cell-"]').count(), {
          timeout: 20_000,
          message: `${title} (panel ${id}) drew the wrong number of cells`,
        })
        .toBe(32);
    }

    // The capture panel splits c* from g* on the node name, which is the only
    // structure a real slurm_exporter offers: it publishes no rack label.
    await gotoPanelWithData(page, 2, 'c');
    await expect(page.getByText('c', { exact: true })).toBeVisible();
    await expect(page.getByText('g', { exact: true })).toBeVisible();

    // Chunking is the one key that asserts structure the data never stated,
    // and the panel has to say so on every group it invents.
    await gotoPanelWithData(page, 3, 'chunk 1');
    await expect(page.getByText('chunk 1', { exact: true })).toBeVisible();
    await expect(page.getByText('assumed', { exact: true }).first()).toBeVisible();
  });
});

test.describe('the options editor', () => {
  test('exposes the standard sections, which proves useFieldConfig is wired', async ({
    gotoPanelEditPage,
    readProvisionedDashboard,
  }) => {
    // Deliberately a provisioned panel rather than a new one built through
    // `panelEditPage.setVisualization()`. That helper picks its code path from
    // the Grafana version and gets 12.4.x wrong: it takes the >= 12.4.0 branch,
    // opens the picker, then clicks an "All visualizations" tab that only
    // exists from 13.x, so it retries for its full 15s and gives up. 12.3 takes
    // the older branch and passes, 13.x has the tab and passes, and every
    // 12.4.x in the CI matrix failed here — on a helper that had not yet
    // reached any assertion about this panel.
    //
    // The panel type is what is under test, not the route taken to reach the
    // editor. A provisioned panel of that type opens the same options pane on
    // every version in the matrix, and the panel being installed at all is
    // already proven by the fifteen other tests that render it.
    const dashboard = await readProvisionedDashboard({ fileName: 'slurm-node-grid.json' });
    const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });

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

    await expect(page.getByTestId('node-group-cpu1')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('node-group-ungrouped')).toHaveCount(0);
  });
});

test.describe('the utilisation dashboard groups the same nine racks on every panel', () => {
  test('shows all nine named racks and drops nothing into ungrouped, on every panel', async ({
    gotoDashboardPage,
    readProvisionedDashboard,
  }) => {
    // Regression coverage for these four panels' grouping: this branch
    // switched State, CPU, Memory and GPU occupancy from a capture pattern
    // ('^(r\\d+)') to the relabelled `rack` label. The colour test above only
    // checks fill behaviour on panels 2 and 4 and would keep passing even if
    // the grouping key were wrong — every panel would just render one
    // "ungrouped" block instead of nine named racks, with nothing failing.
    const dashboard = await readProvisionedDashboard({ fileName: 'slurm-node-utilisation.json' });
    const dashboardPage = await gotoDashboardPage(dashboard);

    const racks = ['cpu1', 'cpu2', 'cpu3', 'cpu4', 'bigmem1', 'bigmem2', 'visu1', 'gpu1', 'gpu2'];
    for (const title of ['State', 'CPU occupancy', 'Memory occupancy', 'GPU occupancy']) {
      const grid = await gridIn(dashboardPage, title);
      for (const key of racks) {
        await expect(grid.getByTestId(`node-group-${key}`)).toBeVisible({ timeout: 15_000 });
      }
      await expect(grid.getByTestId('node-group-ungrouped')).toHaveCount(0);
    }
  });
});

test.describe('the three ways to get a topology, proven against the same live data', () => {
  const racks = ['cpu1', 'cpu2', 'gpu1'];

  test('rung 1 groups by a relabelled Prometheus label', async ({ page }) => {
    await gotoPanelWithData(page, 5, 'cpu1');
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
    // asserting cpu1/cpu2/gpu1 here would pass whether or not the join ever
    // ran. "zone" and aisleA/aisleB/aisleC exist nowhere else in the stack -
    // the only way a group by that name can appear is if the join supplied
    // it.
    await gotoPanelWithData(page, 6, 'aisleA');
    for (const key of ['aisleA', 'aisleB', 'aisleC']) {
      await expect(page.getByTestId(`node-group-${key}`)).toBeVisible();
    }
    await expect(page.getByTestId('node-group-ungrouped')).toHaveCount(0);
  });

  test('rung 3 groups by a range table held in a dashboard variable', async ({ page }) => {
    await gotoPanelWithData(page, 7, 'cpu1');
    for (const key of racks) {
      await expect(page.getByTestId(`node-group-${key}`)).toBeVisible();
    }
    // Interpolation is the part that fails silently: an uninterpolated
    // "$racks" parses as one bad line and places no node at all.
    await expect(page.getByTestId('node-group-ungrouped')).toHaveCount(0);
  });
});

test.describe('showing part of the cluster', () => {
  test('a filtered query narrows the floor without a warning, because nothing is hidden', async ({
    page,
  }) => {
    // The panel has no "only these groups" option on purpose: it would hide
    // nodes the query returned, which is the one thing this panel refuses to
    // do. Narrowing belongs in the query, where the nodes are never asked
    // for — and the difference has to be visible, so this pins the strip
    // staying empty rather than only the groups being right.
    await gotoPanelWithData(page, 11, 'cpu1');

    for (const key of ['cpu1', 'cpu2', 'cpu3', 'cpu4']) {
      await expect(page.getByTestId(`node-group-${key}`)).toBeVisible();
    }
    for (const key of ['bigmem1', 'gpu1', 'visu1', 'ungrouped']) {
      await expect(page.getByTestId(`node-group-${key}`)).toHaveCount(0);
    }

    // No orphan line, and no coverage suggestion either: `rack` is already
    // the grouping, so nothing could place more nodes than it does.
    await expect(page.getByTestId('panel-warnings')).toHaveCount(0);
  });
});

test.describe('the coverage signal, proven by a source that deliberately covers less', () => {
  test('an incomplete range table draws the orphans as unplaced and names a wider label', async ({ page }) => {
    await gotoPanelWithData(page, 8, 'cpu1');

    // The table names only cpu1: c[1-80] against the full 540-node cluster,
    // so 80 nodes are placed and the other 460 fall outside every range.
    const placed = page.getByTestId('node-group-cpu1');
    await expect(placed).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => placed.locator('[data-testid^="node-cell-"]').count(), { timeout: 15_000 }).toBe(80);

    const orphaned = page.getByTestId('node-group-ungrouped');
    await expect(orphaned).toBeVisible();
    await expect(orphaned).toHaveAttribute('data-unplaced', 'true');
    await expect.poll(() => orphaned.locator('[data-testid^="node-cell-"]').count(), { timeout: 15_000 }).toBe(460);

    // Both signals on one panel: the orphan line names what the range table
    // missed, and the coverage line names the label that would have covered
    // all 540 - the measurement that stays silent on every other panel here,
    // because their sources already cover every node.
    const strip = page.getByTestId('panel-warnings').first();
    await expect(strip).toBeVisible({ timeout: 15_000 });
    await expect(strip).toContainText('460 nodes matched no range');
    await expect(strip).toContainText('Label "rack" would group all 540');
  });
});

test.describe('a cabinet holds every sled it draws', () => {
  test("the widest sled's right edge never crosses the frame's content-box edge", async ({
    gotoDashboardPage,
    readProvisionedDashboard,
    page,
  }) => {
    // sledWidthFor once forgot the frame's own border: under
    // box-sizing: border-box the border comes out of the same content box as
    // the padding, and a sled sized without it overflowed the cabinet's right
    // edge by exactly the border pixels it left out. jsdom has no layout
    // engine so no unit test can see this, and a unit test that hardcoded the
    // border and padding to compute its own expectation would only prove the
    // formula agrees with itself. This reads both back from the frame's own
    // computed style instead, against a real Chromium layout.
    const dashboard = await readProvisionedDashboard({ fileName: 'slurm-node-grid.json' });
    await gotoDashboardPage(dashboard);

    const frame = page.getByTestId('node-group-cpu1').getByTestId('rack-frame');
    await expect(frame).toBeVisible({ timeout: 15_000 });
    const cells = frame.locator('[data-testid^="node-cell-"]');
    await expect.poll(() => cells.count(), { timeout: 15_000 }).toBeGreaterThan(0);

    const overflow = await frame.evaluate((el) => {
      const style = getComputedStyle(el);
      const contentRight =
        el.getBoundingClientRect().right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
      const rights = Array.from(el.querySelectorAll('[data-testid^="node-cell-"]')).map(
        (cell) => cell.getBoundingClientRect().right
      );
      return Math.max(...rights) - contentRight;
    });

    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('blades, against the same live data', () => {
  test('draws each cabinet as many sleds wide as its blade holds', async ({ page }) => {
    // getBoundingClientRect, not toBeVisible: the question is where these
    // cells actually are, and toBeVisible passes for anything mounted.
    await gotoPanelWithData(page, 9, 'cpu1');

    // Sleds across, not rows down. Row count used to carry this — forty nodes
    // made ten rows at four per blade and twenty at two — but the fixture now
    // sizes a rack to its blade density, so a compute rack of eighty and a gpu
    // rack of forty both come to twenty rows. Width is what blade density
    // actually decides, and it is what this test has always claimed to check.
    const sledsAcross = async (group: string) => {
      const lefts = await page
        .getByTestId(`node-group-${group}`)
        .locator('[data-testid^="node-cell-"]')
        .evaluateAll((cells) => cells.map((c) => Math.round(c.getBoundingClientRect().left)));
      return new Set(lefts).size;
    };

    // Four densities on one floor, which is the whole point of the override
    // table: a single wrong lookup would show up as one of these four.
    expect(await sledsAcross('cpu1')).toBe(4);
    expect(await sledsAcross('bigmem1')).toBe(3);
    expect(await sledsAcross('visu1')).toBe(1);
    expect(await sledsAcross('gpu1')).toBe(2);
  });
});

test.describe('cabinet height, against the same live data', () => {
  test('draws each cabinet at its declared height, standing on one floor', async ({ page }) => {
    // Panel 10, not panel 9. Panel 9 is the blade demo and its floor is
    // deliberately level now — every cabinet declared at twenty slots and
    // full. Panel 10 exists to hold the two declarations apart: twenty slots
    // against twenty-six, over cabinets that both draw twenty rows.
    await gotoPanelWithData(page, 10, 'cpu1');

    const frame = async (group: string) => {
      const box = await page.getByTestId(`node-group-${group}`).getByTestId('rack-frame').boundingBox();
      expect(box).not.toBeNull();
      return box!;
    };

    const rack = await frame('cpu1');
    const gpu = await frame('gpu1');

    // Twenty slots against twenty-six: the declaration decides the height,
    // not the contents — both cabinets draw exactly twenty rows.
    expect(gpu.height).toBeGreaterThan(rack.height);

    // And the shorter one is not hanging: both feet land on the same line.
    // This is the defect the whole change exists to fix, measured rather than
    // asserted from the formula that produced it.
    expect(Math.round(rack.y + rack.height)).toBe(Math.round(gpu.y + gpu.height));
  });

  test('spills what does not fit above the frame, clear of the group header', async ({ page }) => {
    await gotoPanelWithData(page, 40, 'cpu1');

    const group = page.getByTestId('node-group-cpu1');
    const frameBox = await group.getByTestId('rack-frame').boundingBox();
    const bandBox = await group.locator('[data-testid="rack-band"]').boundingBox();
    expect(frameBox).not.toBeNull();
    expect(bandBox).not.toBeNull();

    const tops = await group
      .locator('[data-testid^="node-cell-"]')
      .evaluateAll((cells) => cells.map((c) => c.getBoundingClientRect().top));
    expect(tops.length).toBe(80);
    const highest = Math.min(...tops);

    // Up, not down: the frame fills from its floor, so the rows that do not
    // fit leave through the top edge.
    expect(highest).toBeLessThan(frameBox!.y);

    // And the band reserved the room: the highest cell stays inside the band,
    // whose top edge is the boundary the group header sits above.
    expect(highest).toBeGreaterThanOrEqual(Math.floor(bandBox!.y));
  });

  test('names the cabinet that outgrew its declaration', async ({ page }) => {
    await gotoPanelWithData(page, 40, 'cpu1');
    await expect(page.getByText('cpu1 needs 20 slots but 12 were declared.')).toBeVisible();
  });

  test('gives the rows the whole content box, with nothing leaking past the padding', async ({ page }) => {
    // jsdom has no layout engine, so only this can see it: under border-box a
    // frame whose arithmetic under-counts its own border hands the rows a
    // content box smaller than they need, and they leave through the top.
    //
    // Panel 1 rather than panel 9: this needs a group with nothing spare
    // above its rows, and every cabinet on panel 9 is deliberately declared
    // taller than it needs, which leaves room above the stack that would
    // swamp a two-pixel shortfall and make the assertion pass whether the
    // border term is right or not. r001 is undeclared but ties for the
    // tallest group on panel 1, so its height is set by its own row count —
    // no slack, and the row a real regression has nowhere to hide behind.
    await gotoPanelWithData(page, 1, 'r001');

    const gap = await page.getByTestId('node-group-r001').evaluate((group) => {
      const frame = group.querySelector('[data-testid="rack-frame"]');
      const style = getComputedStyle(frame);
      const tops = [...frame.querySelectorAll('[data-testid^="node-cell-"]')].map(
        (cell) => cell.getBoundingClientRect().top
      );
      return {
        actual: Math.round(Math.min(...tops) - frame.getBoundingClientRect().top),
        expected: Math.round(parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop)),
      };
    });

    expect(gap.actual).toBe(gap.expected);
  });
});
