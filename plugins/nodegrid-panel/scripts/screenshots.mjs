/**
 * Regenerate the screenshots `plugin.json` offers to the plugin catalogue.
 *
 * Run through `make screenshots`, against the dev stack. It lives here
 * rather than in dev/ because it imports @playwright/test, which is this
 * package's devDependency — Node resolves that from the script's own
 * directory, not from where it is invoked. The catalogue shows
 * these small, beside a logo, to a reader deciding in a second whether this
 * panel is the one they want — so each is cropped to where its content
 * actually ends rather than to the panel box, and each shows one thing:
 * the shape of a cluster, the colours a state gets for free, and what the
 * panel does with a node it has no measurement for.
 *
 * Reproducible rather than hand-made on purpose. A screenshot taken once by
 * hand drifts away from the panel the first time the panel changes, and
 * nobody can tell by looking.
 */
import { chromium } from '@playwright/test';

const url = process.env.GRAFANA_URL ?? 'http://grafana:3000';
const OUT = new URL('../src/img', import.meta.url).pathname;

/** Each entry is exactly one `info.screenshots` entry in plugin.json. */
const SHOTS = [
  ['node-grid-by-rack', 'slurm-node-grid', 1],
  ['node-grid-states', 'slurm-node-scenarios', 1],
  ['node-grid-gpu', 'slurm-node-utilisation', 4],
];

const browser = await chromium.launch();

for (const [name, uid, panelId] of SHOTS) {
  const page = await browser.newPage({ viewportSize: { width: 1500, height: 900 }, deviceScaleFactor: 2 });

  // The same reload the e2e suite needs, for the same reason: a panel whose
  // first query beat the scrape renders empty, and these dashboards refresh
  // too slowly to rescue a script that is not waiting for them.
  let cells = 0;
  for (let attempt = 0; attempt < 12; attempt++) {
    await page.goto(`${url}/d/${uid}/x?viewPanel=${panelId}&kiosk`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2200);
    cells = await page.locator('[data-testid^="node-cell-"]').count();
    if (cells > 5) {
      break;
    }
  }
  if (cells <= 5) {
    throw new Error(`${name}: panel ${panelId} of ${uid} drew ${cells} cells - is the stack up?`);
  }

  // Crop to where the drawn content ends on both axes. Group headings can
  // reach further right than the cells beneath them, so they count too.
  const clip = await page.evaluate(() => {
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
    const pad = 16;
    return {
      x: box.x,
      y: box.y,
      width: Math.min(box.width, right - box.x + pad),
      height: Math.min(box.height, bottom - box.y + pad),
    };
  });

  await page.screenshot({ path: `${OUT}/${name}.png`, clip });
  console.log(`${name}.png  ${Math.round(clip.width)}x${Math.round(clip.height)} css  ${cells} cells`);
  await page.close();
}

await browser.close();
