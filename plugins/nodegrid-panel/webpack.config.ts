/*
 * Extends the scaffolded config from .config/webpack/webpack.config.ts rather
 * than editing it directly, per
 * https://grafana.com/developers/plugin-tools/how-to-guides/extend-configurations#extend-the-webpack-config
 */
import ReplaceInFileWebpackPlugin from 'replace-in-file-webpack-plugin';
import type { Configuration } from 'webpack';
import { merge } from 'webpack-merge';
import { DIST_DIR } from './.config/bundler/constants.ts';
import { getPackageJson } from './.config/bundler/utils.ts';
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
    plugins: [
      // The catalogue shows, per version, the README and links inside that
      // version's archive. Pointed at `main` they change under a published
      // release whenever main moves, so the build pins them to this
      // version's tag. The source keeps `main`, which is what the README on
      // GitHub needs; the CI badge stays on main, being a live status.
      // tests/contract/readme-pins.test.cjs holds the build to it.
      new ReplaceInFileWebpackPlugin([
        {
          dir: DIST_DIR,
          test: [/(^|\/)plugin\.json$/, /(^|\/)README\.md$/],
          rules: [
            {
              search: /grafana-plugin-slurm-panel\/(blob\/)?main\//g,
              replace: `grafana-plugin-slurm-panel/$1v${getPackageJson().version}/`,
            },
          ],
        },
      ]),
    ],
  });
};

export default config;
