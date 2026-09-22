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
  { name: 'node-grid-by-rack', uid: 'slurm-prod', panel: 10 },
  { name: 'node-grid-states', uid: 'slurm-node-colour', panel: 2 },
  { name: 'node-grid-gpu', uid: 'slurm-node-colour', panel: 5 },
  { name: 'node-grid-heights', uid: 'slurm-node-grouping', panel: 1 },
  { name: 'node-grid-blades', uid: 'slurm-node-grouping', panel: 9 },
  // A matched pair: panels 6 and 7 of the colour dashboard are the same
  // floor over the same data, and the only option that differs between them
  // is the shape channel. Taking one from each of two dashboards, as this
  // did, compared two different racks and proved nothing.
  { name: 'node-grid-noshapes', uid: 'slurm-node-colour', panel: 6 },
  { name: 'node-grid-shapes', uid: 'slurm-node-colour', panel: 7 },
  { name: 'node-grid-unplaced', uid: 'slurm-node-grouping', panel: 8 },
  { name: 'node-grid-filtered', uid: 'slurm-node-grouping', panel: 11 },
  { name: 'node-grid-join', uid: 'slurm-node-grouping', panel: 6 },
  { name: 'node-grid-tooltip', uid: 'slurm-prod', panel: 10, hover: true },
  { name: 'node-grid-dashboard', uid: 'slurm-prod' },
];

// The dashboard shot carries two time series over a fifteen-minute window.
// The guard below asks for twenty rather than fifteen: five minutes of margin,
// so a series that is merely full does not read as one that just started.
// On a stack that has just come up they draw two minutes of data against an
// empty field, which looks like the panel failing rather than the stack being
// young. Prometheus knows how long it has been scraping, so ask it.
const prom = process.env.PROM_URL ?? 'http://prometheus:9090';
try {
  // min_over_time, not min: min(timestamp(...)) is the age of the newest
  // scrape, which is always seconds, and reported an empty history on a
  // stack that had been up two hours.
  const q = encodeURIComponent('time() - min_over_time(timestamp(slurm_node_status)[6h:1m])');
  const r = await (await fetch(`${prom}/api/v1/query?query=${q}`)).json();
  const seconds = Number(r?.data?.result?.[0]?.value?.[1] ?? 0);
  if (seconds < 20 * 60) {
    console.warn(
      `\n  ! Prometheus holds ${Math.round(seconds / 60)} min of history.` +
        '\n  ! The dashboard shot needs 20 to fill its time series. Leave `make up`' +
        '\n  ! running and take it again.\n'
    );
  }
} catch {
  console.warn('  ! could not ask Prometheus how long it has been scraping');
}

/**
 * The width the dev dashboards are laid out for: a 27-inch 2K, which is what
 * a cluster gets watched on.
 */
const DASHBOARD_WIDTH = 2560;

/**
 * How wide the panel is on its own dashboard, in those pixels.
 *
 * `?viewPanel` hands a panel the whole viewport, which is not the width it
 * was laid out for. "Nodes by rack" is twelve columns of twenty-four and its
 * nine cabinets fill them; rendered at 2560 the same cabinets sat centred in
 * twice the room they need, and the catalogue's flagship image came out
 * mostly empty panel with the floor plan adrift in it.
 *
 * Height matters as much as width, and for a subtler reason: the wrapping
 * container stretches its rows to whatever height it is given, so a panel
 * rendered in a 1400px viewport spreads three rows of swatches over four
 * hundred pixels each. Taken at the panel's own height they sit where the
 * dashboard puts them.
 *
 * Read from the dashboard rather than written down here, so neither can
 * drift when a panel is resized. Falls back to the full viewport, which is
 * what the dashboard shot uses anyway.
 */
async function panelBox(uid, id, hover) {
  if (id === undefined) {
    return { width: DASHBOARD_WIDTH, height: 1400 };
  }
  // Thrown, not defaulted. The fallback here used to be the full viewport,
  // which is silently the exact defect the rest of this function exists to
  // prevent: a renumbered panel or an unreachable API produced a normal
  // success line and an image framed at 2560, with the floor plan adrift in
  // a panel twice the width it is laid out for. These images ship to the
  // Grafana catalogue, and the cells-drawn check below already chooses to
  // fail rather than write a wrong file; this one now agrees with it.
  let pos;
  try {
    const r = await (await fetch(`${url}/api/dashboards/uid/${uid}`)).json();
    pos = r?.dashboard?.panels?.find((x) => x.id === id)?.gridPos;
  } catch (e) {
    throw new Error(`could not read dashboard ${uid} to size panel ${id}: ${e.message}`);
  }
  if (pos === undefined) {
    throw new Error(`dashboard ${uid} has no panel ${id} — was it renumbered?`);
  }
  if (!(pos.w > 0 && pos.h > 0)) {
    throw new Error(`panel ${id} of ${uid} has no usable gridPos: ${JSON.stringify(pos)}`);
  }
  return {
    width: Math.round((DASHBOARD_WIDTH * pos.w) / 24),
    // Grafana's grid row is 30px with an 8px gutter, so h rows measure
    // 38h - 8. Plus the kiosk chrome above the panel, and more again for a
    // hover shot, whose tooltip is drawn outside the panel and would be
    // clipped by a viewport cut to it exactly.
    height: 38 * pos.h - 8 + 64 + (hover ? 320 : 0),
  };
}

const browser = await chromium.launch();

for (const shot of SHOTS) {
  // `viewport`, not `viewportSize`: newPage takes the former and silently
  // ignores the latter, which left every shot below taken at Chromium's
  // 1280px default while this said 1500. A panel crop hides that - the crop
  // follows the content - so it went unnoticed until a dashboard shot was
  // measured against the width it claimed.
  // The size comes from panelBox above, not from a constant: a panel shot is
  // taken at the width and height its dashboard gives it, and only the
  // dashboard-wide shot uses the full 2560. That width is what the dev
  // dashboards are laid out for — a 27-inch 2K, which is what a cluster gets
  // watched on.
  const page = await browser.newPage({
    viewport: await panelBox(shot.uid, shot.panel, shot.hover === true),
    deviceScaleFactor: 1,
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
      return Math.ceil(bottom + window.scrollY + 90);
    });
    await page.setViewportSize({ width: DASHBOARD_WIDTH, height: needed });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${shot.name}.png` });
    console.log(`${shot.name}.png  dashboard 2560x${needed} css  ${cells} cells`);
    await page.close();
    continue;
  }

  if (shot.hover) {
    // A cell near the middle rather than the first one: Grafana anchors the
    // tooltip beside the cursor, so hovering an edge cell pushes half the
    // tooltip outside the panel and the crop then cuts its labels off.
    await page
      .locator('[data-testid^="node-cell-"]')
      .nth(Math.floor(cells / 2))
      .hover();
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
    // Tracked as well as `right`, because a panel whose cabinets are centred
    // has content that starts well inside its own left edge.
    let contentLeft = Infinity;
    for (const el of grid.querySelectorAll('[data-testid^="node-cell-"], [data-testid^="node-group-"]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) {
        continue;
      }
      right = Math.max(right, r.right);
      bottom = Math.max(bottom, r.bottom);
      contentLeft = Math.min(contentLeft, r.left);
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
    // Give the content as much room on its right as it has on its left.
    // Cropping to the panel's edge on one side and to the content's on the
    // other turns a centred row of cabinets into one shoved against the right
    // margin: measured on "Nodes by rack", 534px clear on both sides in the
    // browser, and an image that showed 744px of empty panel on the left and
    // none on the right. The catalogue's flagship picture was of a layout
    // defect the panel does not have.
    //
    // A left-packed panel is unaffected: its content starts at the panel's
    // own padding, so the mirrored margin is that same padding and the crop
    // stays tight. The width is clamped to the viewport below either way.
    if (Number.isFinite(contentLeft)) {
      right = Math.max(right, right + (contentLeft - left));
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
