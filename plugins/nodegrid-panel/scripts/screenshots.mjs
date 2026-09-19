/**
 * Regenerate the screenshots the catalogue and the two READMEs show.
 *
 * Run through `make screenshots`, against the dev stack. It lives here
 * rather than in dev/ because it imports @playwright/test, which is this
 * package's devDependency — Node resolves that from the script's own
 * directory, not from where it is invoked.
 *
 * Two audiences, one source. The catalogue shows a handful of these small,
 * beside a logo, to a reader deciding in a second whether this panel is the
 * one they want; `plugin.json` names that subset. The READMEs show all of
 * them, each beside the paragraph that explains it. Either way each image
 * shows one thing, and is cropped to where its content actually ends rather
 * than to the panel box.
 *
 * Reproducible rather than hand-made on purpose. A screenshot taken once by
 * hand drifts away from the panel the first time the panel changes, and
 * nobody can tell by looking.
 */
import { chromium } from '@playwright/test';

const url = process.env.GRAFANA_URL ?? 'http://grafana:3000';
const OUT = new URL('../src/img', import.meta.url).pathname;

/**
 * `panel` crops to one panel's drawn content; `dashboard` frames a whole
 * dashboard, which is the only way to show what the panel looks like beside
 * the stat tiles and tables it is meant to sit with. `hover` points at a
 * node and waits for its tooltip, because the join this panel exists for
 * only becomes visible there.
 */
const SHOTS = [
  { name: 'node-grid-by-rack', uid: 'slurm-node-grid', panel: 1 },
  { name: 'node-grid-states', uid: 'slurm-node-scenarios', panel: 1 },
  { name: 'node-grid-gpu', uid: 'slurm-node-utilisation', panel: 4 },
  { name: 'node-grid-heights', uid: 'slurm-node-grouping', panel: 1 },
  { name: 'node-grid-blades', uid: 'slurm-node-grouping', panel: 9 },
  { name: 'node-grid-shapes', uid: 'slurm-node-scenarios', panel: 2 },
  { name: 'node-grid-noshapes', uid: 'slurm-node-scenarios', panel: 3 },
  { name: 'node-grid-unplaced', uid: 'slurm-node-grouping', panel: 8 },
  { name: 'node-grid-filtered', uid: 'slurm-node-grouping', panel: 11 },
  { name: 'node-grid-join', uid: 'slurm-node-grouping', panel: 6 },
  { name: 'node-grid-tooltip', uid: 'slurm-node-grid', panel: 1, hover: true },
  { name: 'node-grid-dashboard', uid: 'slurm-prod' },
];

const browser = await chromium.launch();

for (const shot of SHOTS) {
  const page = await browser.newPage({
    viewportSize: { width: 1500, height: 900 },
    deviceScaleFactor: 2,
  });

  // The same reload the e2e suite needs, for the same reason: a panel whose
  // first query beat the scrape renders empty, and these dashboards refresh
  // too slowly to rescue a script that is not waiting for them.
  const view = shot.panel === undefined ? '' : `&viewPanel=${shot.panel}`;
  let cells = 0;
  for (let attempt = 0; attempt < 12; attempt++) {
    await page.goto(`${url}/d/${shot.uid}/x?kiosk${view}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2200);
    cells = await page.locator('[data-testid^="node-cell-"]').count();
    if (cells > 5) {
      break;
    }
  }
  if (cells <= 5) {
    throw new Error(`${shot.name}: ${shot.uid} drew ${cells} cells - is the stack up?`);
  }

  if (shot.panel === undefined) {
    // A dashboard is framed by the viewport, not cropped to its content: the
    // point of the image is the arrangement, and cropping to the panels would
    // throw away the whitespace that makes an arrangement readable. So grow
    // the viewport to the height the dashboard actually needs — a fixed one
    // guesses, and a guess that is short cuts the last row in half.
    const needed = await page.evaluate(() => {
      const panels = [...document.querySelectorAll('[data-viz-panel-key]')];
      const bottom = Math.max(...panels.map((el) => el.getBoundingClientRect().bottom));
      return Math.ceil(bottom + window.scrollY + 16);
    });
    await page.setViewportSize({ width: 1500, height: needed });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${shot.name}.png` });
    console.log(`${shot.name}.png  dashboard 1500x${needed} css  ${cells} cells`);
    await page.close();
    continue;
  }

  if (shot.hover) {
    // A cell near the middle rather than the first one: Grafana anchors the
    // tooltip beside the cursor, so hovering an edge cell pushes half the
    // tooltip outside the panel and the crop then cuts its labels off.
    await page.locator('[data-testid^="node-cell-"]').nth(Math.floor(cells / 2)).hover();
    await page.getByRole('tooltip').waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForTimeout(300);
  }

  // Crop to where the drawn content ends on both axes. Group headings can
  // reach further right than the cells beneath them, so they count too; so
  // does the panel title, which is the one piece of text a reader needs and
  // the easiest to shave off, since it sits above the grid rather than in
  // it. A tooltip reaches past everything, so it counts hardest.
  const clip = await page.evaluate((hover) => {
    const grid = document.querySelector('[data-testid="slurm-node-grid"]');
    const panel = grid.closest('[data-viz-panel-key], section, article') ?? grid.parentElement;
    const box = panel.getBoundingClientRect();
    let right = 0;
    let bottom = 0;
    for (const el of grid.querySelectorAll('[data-testid^="node-cell-"], [data-testid^="node-group-"]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) {
        continue;
      }
      right = Math.max(right, r.right);
      bottom = Math.max(bottom, r.bottom);
    }
    const heading = panel.querySelector('h1, h2, h3, h4, h5, h6');
    if (heading) {
      // The heading element stretches the whole panel; only its text matters,
      // and a Range is what measures text rather than the box holding it.
      const range = document.createRange();
      range.selectNodeContents(heading);
      // Plus room for the description icon Grafana puts after the title. It
      // is a sibling of the text rather than part of it, so a crop measured
      // on the text alone shaves it in half on any panel whose title is the
      // widest thing in it.
      right = Math.max(right, range.getBoundingClientRect().right + 24);
    }
    // A tooltip is drawn in a portal, so it can reach outside the panel on
    // any side. It has to widen the crop rather than be clipped by it: a
    // tooltip with its labels shaved off is worse than no tooltip shot.
    let left = box.x;
    let top = box.y;
    if (hover) {
      const tip = document.querySelector('[role="tooltip"]');
      if (tip) {
        const r = tip.getBoundingClientRect();
        right = Math.max(right, r.right);
        bottom = Math.max(bottom, r.bottom);
        left = Math.max(0, Math.min(left, r.left));
        top = Math.max(0, Math.min(top, r.top));
      }
    }
    const pad = 16;
    return {
      x: left,
      y: top,
      width: Math.min(window.innerWidth - left, right - left + pad),
      height: Math.min(window.innerHeight - top, bottom - top + pad),
    };
  }, shot.hover === true);

  await page.screenshot({ path: `${OUT}/${shot.name}.png`, clip });
  console.log(`${shot.name}.png  ${Math.round(clip.width)}x${Math.round(clip.height)} css  ${cells} cells`);
  await page.close();
}

await browser.close();
