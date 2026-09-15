#!/usr/bin/env node
/**
 * A range table -> a Prometheus scrape config that attaches `rack` at scrape
 * time.
 *
 * It owns no grammar. The expansion comes from the same parser the panel uses,
 * because the claim this repository makes about the range table - one format,
 * two destinations - does not survive two implementations of it drifting
 * apart.
 *
 * Usage: node dev/relabel/generate.mjs <table-file> <job-name> <target>
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CORE = pathToFileURL(
  path.resolve(import.meta.dirname, '..', '..', 'packages', 'core', 'dist', 'index.js')
).href;
const { parseRangeTable } = await import(CORE);

const [tableFile, job, target] = process.argv.slice(2);
if (tableFile === undefined || job === undefined || target === undefined) {
  console.error('usage: generate.mjs <table-file> <job-name> <target>');
  process.exit(2);
}

const table = parseRangeTable(readFileSync(tableFile, 'utf8'));
for (const problem of table.problems) {
  console.error(`${tableFile}: ${problem.detail}`);
}
if (table.problems.length > 0) {
  process.exit(1);
}

/**
 * A node name, made safe inside a Prometheus regex.
 *
 * Prometheus compiles `regex` as RE2 and anchors it, so the alternation has to
 * be expanded: `c[1-40]` there does not mean c1 through c40, it means "c
 * followed by one of 1, 2, 3, 4, 0". It is right by accident on `c[1-5]` and
 * silently wrong from `c[1-10]` onward, which is the reason this file exists
 * rather than a paragraph of documentation.
 */
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const rules = table.groups
  .filter((group) => group.members.length > 0)
  .map((group) =>
    [
      '      - source_labels: [node]',
      `        regex: ${group.members.map(escape).join('|')}`,
      '        target_label: rack',
      `        replacement: ${group.name}`,
    ].join('\n')
  );

process.stdout.write(
  [
    `# Generated from ${path.basename(tableFile)} by dev/relabel/generate.mjs. Do not edit.`,
    'scrape_configs:',
    `  - job_name: ${job}`,
    '    static_configs:',
    `      - targets: ['${target}']`,
    '    metric_relabel_configs:',
    ...rules,
    '',
  ].join('\n')
);
