/*
 * Extends the scaffolded config from .config/webpack/webpack.config.ts rather
 * than editing it directly, per
 * https://grafana.com/developers/plugin-tools/how-to-guides/extend-configurations#extend-the-webpack-config
 */
import type { Configuration } from 'webpack';
import { merge } from 'webpack-merge';
import grafanaConfig, { Env } from './.config/webpack/webpack.config';

const config = async (env: Env): Promise<Configuration> => {
  const baseConfig = await grafanaConfig(env);

  return merge(baseConfig, {
    resolve: {
      // @slurm-views/core is authored as native TypeScript ESM: its relative
      // imports carry the compiled ".js" extension (e.g. "./model/types.js")
      // while the files on disk are ".ts". Node's ESM loader and tsc resolve
      // this natively; webpack does not, without this alias.
      extensionAlias: {
        '.js': ['.ts', '.tsx', '.js'],
      },
    },
  });
};

export default config;
