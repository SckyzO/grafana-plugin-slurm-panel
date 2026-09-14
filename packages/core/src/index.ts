export const CORE_VERSION = '0.1.0';

export * from './model/types.js';
export { ingest } from './ingest/frames.js';
export { toSamples } from './ingest/labels.js';
export { parseState, BASE_STATES } from './state/parse.js';
export type { ParsedState, StateModifier } from './state/parse.js';
export { makeKeyFn, describeKeySource, ordinalOf, UNGROUPED } from './group/keys.js';
export type { KeySource, KeyResult } from './group/keys.js';
export { buildGroups } from './group/build.js';
export type { NodeGroup, GroupedModel, BuildOptions } from './group/build.js';
