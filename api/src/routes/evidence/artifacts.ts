// Stored evidence on disk. Everything here READS a recorded artifact; nothing computes a verdict.
//
// test-results.json (in EVIDENCE_DIR), written only by `npm run evidence:record-tests` (scripts/record-test-results.mjs),
// run locally against the dev database. CI does not write it (ci.yml uploads JUnit XML and commit.txt only):
//   { commit: full 40-char sha (7..40 hex accepted), status: 'PASS' | 'FAIL', passed: int, failed: int,
//     notVerified?: int, runAt?: ISO date string }
// It reads as NOT_VERIFIED when absent, malformed, PASS with failed > 0, PASS with passed === 0 (nothing was
// verified), or PASS with notVerified > 0 (not a clean pass). A commit that is not a prefix of HEAD reads STALE.
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

export const evidenceDir = (): string => process.env.EVIDENCE_DIR ?? path.join(repoRoot, 'docs', 'evidence');
const formcheckMetricsPath = (): string => process.env.FORMCHECK_METRICS ?? path.join(repoRoot, 'formcheck', 'metrics.json');

export type Provenance = 'MEASURED' | 'DERIVED' | 'SYNTHETIC' | 'TARGET' | 'LIVE_DEMO' | 'BENCHMARK';
const PROVENANCES = ['MEASURED', 'DERIVED', 'SYNTHETIC', 'TARGET', 'LIVE_DEMO', 'BENCHMARK'];

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return undefined; // absent or malformed: both mean "nothing to read"
  }
}

export function headCommit(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, timeout: 3000 }, (err, out) => resolve(err ? null : out.trim() || null));
  });
}

/** The recorded test run. `status` is what the run said; it is never inferred from the counts. */
const testResult = z.object({
  commit: z.string().regex(/^[0-9a-f]{7,40}$/i),
  status: z.enum(['PASS', 'FAIL']),
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
  notVerified: z.number().int().min(0).optional(),
  runAt: z.string().refine((v) => !Number.isNaN(Date.parse(v))).optional(),
});
export type TestResult = z.infer<typeof testResult>;

/** The test-result artifact, or null when absent, malformed, or self-contradictory (PASS with failures). */
export async function readTestResult(): Promise<TestResult | null> {
  const parsed = testResult.safeParse(await readJson(path.join(evidenceDir(), 'test-results.json')));
  if (!parsed.success) return null;
  if (parsed.data.status === 'PASS' && (parsed.data.failed > 0 || parsed.data.passed === 0)) return null;
  return parsed.data;
}

/** The artifact's commit must be a prefix of HEAD; one direction only, so a longer string never matches. */
export const commitIsCurrent = (artifactCommit: string, head: string): boolean => head.toLowerCase().startsWith(artifactCommit.toLowerCase());

export interface ArtifactEntry {
  name: string;
  status: 'READ' | 'NOT_VERIFIED';
  provenance: Provenance | null;
  commit: string | null;
  data: unknown;
}

/** Provenance is the file's own declaration, else the caller's fallback, else unstated (null). */
function entry(name: string, json: unknown, fallback: Provenance | null = null): ArtifactEntry {
  if (json === undefined || json === null || typeof json !== 'object' || Array.isArray(json)) return { name, status: 'NOT_VERIFIED', provenance: fallback, commit: null, data: null };
  const o = json as { commit?: unknown; provenance?: unknown };
  const synthetic = (json as { datasets?: { synthetic?: unknown } }).datasets?.synthetic === true ? 'SYNTHETIC' : fallback; // the file says its data is synthetic
  const declared = typeof o.provenance === 'string' && PROVENANCES.includes(o.provenance) ? (o.provenance as Provenance) : synthetic;
  return { name, status: 'READ', provenance: declared, commit: typeof o.commit === 'string' ? o.commit : null, data: json };
}

export async function readArtifacts(): Promise<ArtifactEntry[]> {
  const dir = path.join(evidenceDir(), 'benchmark-results');
  const files = (await fs.readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.json')).sort();
  const out: ArtifactEntry[] = [];
  for (const f of files) out.push(entry(`benchmark-results/${f}`, await readJson(path.join(dir, f)), 'BENCHMARK')); // Ruling E17: the directory exists for benchmarks; files may declare otherwise
  out.push(entry('formcheck/metrics.json', await readJson(formcheckMetricsPath())));
  return out;
}
