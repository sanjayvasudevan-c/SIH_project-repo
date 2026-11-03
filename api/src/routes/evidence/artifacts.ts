// Stored evidence on disk. Everything here READS a recorded artifact; nothing computes a verdict.
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

export const evidenceDir = (): string => process.env.EVIDENCE_DIR ?? path.join(repoRoot, 'docs', 'evidence');
const formcheckMetricsPath = (): string => process.env.FORMCHECK_METRICS ?? path.join(repoRoot, 'formcheck', 'metrics.json');

export type Provenance = 'MEASURED' | 'DERIVED' | 'SYNTHETIC' | 'TARGET';

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return undefined; // absent or malformed: both mean "nothing to read"
  }
}

export function headCommit(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }, (err, out) => resolve(err ? null : out.trim() || null));
  });
}

/** The recorded test run. `status` is what the run said; it is never inferred from the counts. */
const testResult = z.object({
  commit: z.string().min(7),
  status: z.enum(['PASS', 'FAIL']),
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
  notVerified: z.number().int().min(0).optional(),
  runAt: z.string().optional(),
});
export type TestResult = z.infer<typeof testResult>;

/** The test-result artifact, or null when absent, malformed, or self-contradictory (PASS with failures). */
export async function readTestResult(): Promise<TestResult | null> {
  const parsed = testResult.safeParse(await readJson(path.join(evidenceDir(), 'test-results.json')));
  if (!parsed.success) return null;
  if (parsed.data.status === 'PASS' && parsed.data.failed > 0) return null;
  return parsed.data;
}

export const sameCommit = (a: string, b: string): boolean => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x.startsWith(y) || y.startsWith(x);
};

export interface ArtifactEntry {
  name: string;
  status: 'READ' | 'NOT_VERIFIED';
  provenance: Provenance;
  commit: string | null;
  data: unknown;
}

function entry(name: string, provenance: Provenance, json: unknown): ArtifactEntry {
  if (json === undefined || json === null || typeof json !== 'object') return { name, status: 'NOT_VERIFIED', provenance, commit: null, data: null };
  const c = (json as { commit?: unknown }).commit;
  return { name, status: 'READ', provenance, commit: typeof c === 'string' ? c : null, data: json };
}

export async function readArtifacts(): Promise<ArtifactEntry[]> {
  const dir = path.join(evidenceDir(), 'benchmark-results');
  const files = (await fs.readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.json')).sort();
  const out: ArtifactEntry[] = [];
  for (const f of files) out.push(entry(`benchmark-results/${f}`, 'MEASURED', await readJson(path.join(dir, f))));
  out.push(entry('formcheck/metrics.json', 'SYNTHETIC', await readJson(formcheckMetricsPath())));
  return out;
}
