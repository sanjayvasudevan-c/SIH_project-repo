// Reads benchmark-results/<hash>.json entries from /evidence/artifacts. Two committed shapes exist: the older run records
// fewer fields. A field a run does not record stays undefined and is shown as "not recorded in this run", never as 0.
import type { ArtifactEntry } from '../../../../api/types';

export interface Cycle {
  ms: number;
  newAlerts: number;
  alertsSuppressed?: number;
}
export interface ReadRow {
  screen: string;
  requests: number;
  concurrency: number;
  errors: number;
  p50ms: number;
  p95ms: number;
  p99ms: number;
  maxMs: number;
  perSecond: number;
}
export interface Run {
  commit: string;
  date: string;
  datasetSize: number;
  applications: number;
  seeded?: number;
  deadlineItems?: number;
  openDeadlineItems?: number;
  pgVersion?: string;
  machine: { cpus?: number; cpuModel?: string; memoryGb?: number; node?: string; totalMemoryBytes?: number; os?: string; postgres?: string };
  repeats?: number;
  resourceUseMeasured: boolean | undefined;
  provenance: string;
  first: Cycle;
  second: Cycle;
  reads: ReadRow[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const num = (v: unknown) => (isNum(v) ? v : undefined);
const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);

function cycle(v: unknown): Cycle | null {
  if (!isObj(v) || !isNum(v.ms) || !isNum(v.newAlerts)) return null;
  return { ms: v.ms, newAlerts: v.newAlerts, alertsSuppressed: num(v.alertsSuppressed) };
}

export const isBenchmarkName = (name: string) => /^benchmark-results\/.+\.json$/.test(name);

export function parseRun(entry: ArtifactEntry): Run | null {
  if (!isBenchmarkName(entry.name) || entry.status !== 'READ' || !isObj(entry.data)) return null;
  const d = entry.data;
  if (typeof d.commit !== 'string' || typeof d.date !== 'string' || Number.isNaN(new Date(d.date).getTime()) || !isNum(d.datasetSize)) return null;
  if (!isObj(d.machine) || !isObj(d.data) || !isObj(d.engine) || !isNum(d.data.applications)) return null;
  const first = cycle(d.engine.firstCycle);
  const second = cycle(d.engine.secondCycle);
  if (!first || !second || !Array.isArray(d.reads) || d.reads.length === 0) return null;
  const reads: ReadRow[] = [];
  for (const r of d.reads) {
    if (!isObj(r) || typeof r.screen !== 'string' || ![r.requests, r.concurrency, r.errors, r.p50ms, r.p95ms, r.p99ms, r.maxMs, r.perSecond].every(isNum)) return null;
    reads.push({ screen: r.screen, requests: r.requests as number, concurrency: r.concurrency as number, errors: r.errors as number, p50ms: r.p50ms as number, p95ms: r.p95ms as number, p99ms: r.p99ms as number, maxMs: r.maxMs as number, perSecond: r.perSecond as number });
  }
  const m = d.machine;
  return {
    commit: d.commit,
    date: d.date,
    datasetSize: d.datasetSize,
    applications: d.data.applications,
    seeded: num(d.data.seededApplications),
    deadlineItems: num(d.data.deadlineItems),
    openDeadlineItems: num(d.data.openDeadlineItems),
    pgVersion: str(d.pgVersion),
    machine: { cpus: num(m.cpus), cpuModel: str(m.cpuModel), memoryGb: num(m.memoryGb), node: str(m.node), totalMemoryBytes: num(m.totalMemoryBytes), os: str(m.os), postgres: str(m.postgres) },
    repeats: num(d.repeats),
    // resourceUse: null in a run that declares it was not measured; absent in a run that predates the field.
    resourceUseMeasured: 'resourceUse' in d ? d.resourceUse !== null : undefined,
    provenance: str(entry.provenance) ?? 'BENCHMARK',
    first,
    second,
    reads,
  };
}

/** All readable runs, oldest first, and how many benchmark files could not be read. */
export function readRuns(entries: ArtifactEntry[]): { runs: Run[]; unreadable: number } {
  const files = entries.filter((e) => isBenchmarkName(e.name));
  const runs = files.map(parseRun).filter((r): r is Run => r !== null).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return { runs, unreadable: files.length - runs.length };
}

const FIELDS = ['cpus', 'cpuModel', 'memoryGb', 'node', 'pgVersion'] as const;
const valueOf = (r: Run, f: (typeof FIELDS)[number]) => (f === 'pgVersion' ? r.pgVersion : r.machine[f]);
export const FIELD_WORDS: Record<string, string> = { cpus: 'CPU cores', cpuModel: 'CPU model', memoryGb: 'memory', node: 'Node version', pgVersion: 'PostgreSQL version' };

/**
 * Runs may be compared only when their machine blocks are identical on the fields both record: cores, CPU model, memory
 * and Node version, plus the top-level PostgreSQL version. The other machine fields (operating system, total memory in bytes,
 * PostgreSQL build) exist in only one of the committed runs, so they cannot be compared and are not held against either run.
 * A run that does not record one of the five at all is not comparable.
 */
export function comparableRuns(a: Run, b: Run): { ok: true; fields: string[] } | { ok: false; differing: string[] } {
  const differing = FIELDS.filter((f) => valueOf(a, f) === undefined || valueOf(b, f) === undefined || valueOf(a, f) !== valueOf(b, f));
  return differing.length > 0 ? { ok: false, differing: [...differing] } : { ok: true, fields: [...FIELDS] };
}
