/** A field of a Grafana DataFrame, described structurally so core imports no Grafana. */
export interface MinimalField {
  name: string;
  type?: string;
  labels?: Record<string, string>;
  values: unknown[];
}

export interface MinimalFrame {
  refId?: string;
  fields: MinimalField[];
}

export interface LabelNames {
  node: string;
  state: string;
  partition: string;
  gresType: string;
  reason: string;
}

/**
 * Each data role the panel can read, bound to the `refId` of the query that
 * supplies it. `state` is the only required one; the rest are facets a reader
 * binds when they want a colour mode or a tooltip line that needs them.
 *
 * Named for what it holds — queries — rather than for the places they plug
 * into, because "slot" already means a position in a cabinet everywhere the
 * rack layout is concerned.
 */
export interface QueryBindings {
  state: string;
  cpuAlloc?: string;
  cpuTotal?: string;
  memAlloc?: string;
  memTotal?: string;
  gresUsed?: string;
  gresTotal?: string;
  drainReason?: string;
  drainSince?: string;
}

export interface GresEntry {
  type: string;
  used?: number;
  total?: number;
}

export interface NodeFacets {
  cpuAlloc?: number;
  cpuTotal?: number;
  memAlloc?: number;
  memTotal?: number;
  gres: GresEntry[];
  drainReason?: string;
  drainSince?: number;
}

export interface SlurmNode {
  name: string;
  state: string;
  partitions: string[];
  /**
   * Labels whose value agrees across every series for this node, for use as
   * a grouping key. A label that differs between series is dropped rather
   * than resolved arbitrarily, because a value that varies per node cannot
   * be a stable grouping key — `partition` is the common case, and it is
   * modelled properly by `partitions` above instead.
   */
  labels: Record<string, string>;
  facets: NodeFacets;
}

export type IngestWarningKind = 'no-identity' | 'ambiguous-scalar';

export interface IngestWarning {
  kind: IngestWarningKind;
  refId?: string;
  detail: string;
}

export interface IngestResult {
  nodes: SlurmNode[];
  warnings: IngestWarning[];
}

export interface IngestInput {
  frames: MinimalFrame[];
  queries: QueryBindings;
  labels: LabelNames;
}

/** A single observation pulled out of either frame shape. */
export interface Sample {
  labels: Record<string, string>;
  value: unknown;
}
