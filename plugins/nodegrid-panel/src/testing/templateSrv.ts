import type { TemplateSrv } from '@grafana/runtime';

/**
 * A minimal stand-in for Grafana's real TemplateSrv, which the plugin never
 * bundles itself — the Grafana application provides it at runtime.
 *
 * Resolves both `${name}` and `$name`, from the scopedVars a panel passes and
 * from `vars`, which stands in for the dashboard's own variables. A panel
 * interpolates with scopedVars; an options editor has none and relies on the
 * dashboard variables alone, and both paths have to be testable.
 */
export function fakeTemplateSrv(vars: Record<string, string> = {}): TemplateSrv {
  const resolve = (name: string, scoped: string | undefined): string | undefined => scoped ?? vars[name];
  return {
    getVariables: () => [],
    containsTemplate: (target) => /\$\{?\w+\}?/.test(target ?? ''),
    updateTimeRange: () => {},
    replace: (target, scopedVars) => {
      if (target === undefined) {
        return '';
      }
      return target.replace(/\$\{(\w+)\}|\$(\w+)/g, (match, braced: string | undefined, bare: string | undefined) => {
        const name = braced ?? bare ?? '';
        const scoped = scopedVars?.[name];
        return resolve(name, scoped === undefined ? undefined : String(scoped.value)) ?? match;
      });
    },
  };
}
