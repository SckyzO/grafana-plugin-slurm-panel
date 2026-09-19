import { resolve } from 'node:path';
import type { PluginOptions } from '@grafana/plugin-e2e';
import { defineConfig } from '@playwright/test';
import baseConfig from './.config/playwright.config';

/**
 * See https://playwright.dev/docs/test-configuration.
 *
 * This monorepo runs its dev stack from `dev/docker-compose.yml`, so
 * `readProvisionedDashboard` / `readProvisionedDataSource` must resolve
 * against `dev/provisioning`. The scaffold's own stack, and the provisioning
 * directory beside this file that only it ever mounted, are gone.
 *
 * There are deliberately no Chromium launch flags here. An earlier revision
 * passed --no-sandbox, --disable-gpu, --disable-dev-shm-usage and
 * --disable-software-rasterizer, because Chromium's defaults crashed the
 * renderer when the browser ran on a WSL2 host. The browser now runs inside
 * the toolchain container, where that is no longer true: the suite was re-run
 * with every flag removed and passed 7/7, so they are gone rather than
 * carried along. Their absence leaves Chromium's own sandbox switched on,
 * which is the point of removing them rather than merely tidying them.
 *
 * GRAFANA_URL is set by the `tools` compose service to Grafana's address on
 * the compose network, which is always port 3000 regardless of what the stack
 * publishes on the host. The localhost fallback is for a run driven by hand,
 * and reads the same GRAFANA_PORT the compose file publishes.
 */
export default defineConfig<PluginOptions>(baseConfig, {
  /**
   * The scaffold retries twice on CI. We do not, and the compose file now
   * passes CI through, so this has to say so rather than rely on the
   * variable being absent.
   *
   * A retry turns a race into a pass and reports the pass. Every e2e defect
   * this project has found was a race — a panel plugin not yet registered, a
   * first query beating the first scrape, a panel below the fold that the
   * scenes renderer never mounted — and each was found because the run went
   * red once and stayed red. `make up` gates on the conditions that used to
   * make those flaky; what gets through is signal, and signal is not for
   * retrying. `forbidOnly`, the other thing CI switches on, is exactly why
   * the variable is passed at all.
   */
  retries: 0,
  use: {
    baseURL: process.env.GRAFANA_URL ?? `http://localhost:${process.env.GRAFANA_PORT ?? 3000}`,
    provisioningRootDir: resolve(__dirname, '../../dev/provisioning'),
  },
});
