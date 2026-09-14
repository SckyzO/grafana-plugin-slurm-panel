import { resolve } from 'node:path';
import type { PluginOptions } from '@grafana/plugin-e2e';
import { defineConfig } from '@playwright/test';
import baseConfig from './.config/playwright.config';

/**
 * See https://playwright.dev/docs/test-configuration.
 *
 * This monorepo runs its dev stack from `dev/docker-compose.yml`, not the
 * scaffold's own `docker-compose.yaml`: Grafana is published on 3001, and
 * `readProvisionedDashboard` / `readProvisionedDataSource` must resolve
 * against `dev/provisioning`, not the scaffold's own unused
 * `plugins/nodegrid-panel/provisioning/`.
 */
export default defineConfig<PluginOptions>(baseConfig, {
  use: {
    baseURL: process.env.GRAFANA_URL ?? 'http://localhost:3001',
    provisioningRootDir: resolve(__dirname, '../../dev/provisioning'),
  },
});
