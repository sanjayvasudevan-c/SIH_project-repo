// Writes a committed snapshot of the Evidence API aggregates for the GitHub evidence package.
//   npm run evidence:snapshot        (from the repository root; reads DATABASE_URL and JWT_SECRET from ../.env)
//
// Boots createApp() on an in-process loopback server exactly as `npm run evidence:verify` does: a token is minted locally with the
// repo's signToken for an existing active ADMIN user (no login request, so NO audit row is written), and the ground-truth SQL session is
// read-only. Before anything is written the existing verification (src/evidence-verify.ts, imported, not re-implemented) runs; if any
// check disagrees nothing is written. The API responses are written UNMODIFIED (definition + provenance + data) to
// docs/evidence/visualizations/data/<name>.json, next to a manifest that says where they came from. Credentials are never printed or stored.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import { signToken } from '../src/auth/token.js';
import { describeDatabase, runVerification } from '../src/evidence-verify.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = path.join(repoRoot, 'docs/evidence/visualizations/data');
const git = (...args: string[]): string => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
const write = (name: string, body: unknown): void => writeFileSync(path.join(outDir, name), JSON.stringify(body, null, 2) + '\n');

type Get = (p: string) => Promise<{ status: number; body: any }>;
type Sql = (text: string, params?: unknown[]) => Promise<any[]>;

/**
 * The single place that obtains the aggregate JSON. Everything else in this script (verification, writing, manifest) is independent of
 * HOW the aggregates are produced, so swapping the in-process HTTP call for a direct library call only changes this function.
 * Returns the responses unmodified ({definition, provenance, data}), keyed by file name without ".json".
 */
async function fetchAggregates(get: Get, sql: Sql): Promise<{ fetched: Record<string, unknown>; traces: Record<string, unknown>; assignedApp: string | null; blockedApp: string | null }> {
  // The responses, unmodified. All dates (no window), engine runs with a page large enough for every run.
  const fetched: Record<string, unknown> = {};
  for (const [name, p] of [
    ['workflow', '/api/evidence/workflow'],
    ['assignment', '/api/evidence/assignment'],
    ['compliance', '/api/evidence/compliance'],
    ['alerts', '/api/evidence/alerts'],
    ['audit-analytics', '/api/evidence/audit-analytics'],
    ['engine-runs', '/api/evidence/engine-runs?pageSize=200'],
    ['summary', '/api/evidence/summary'],
  ] as const) {
    const r = await get(p);
    if (r.status !== 200) throw new Error(`GET ${p} returned ${r.status}`);
    fetched[name] = r.body;
  }
  const runs = fetched['engine-runs'] as { total: number; rows: unknown[] };
  if (runs.total !== runs.rows.length) throw new Error(`engine-runs: ${runs.total} runs but ${runs.rows.length} returned; raise the page size (max 200) or page the snapshot`);

  // 3. Two example applications for the worked example: the ASSIGNED decision with the most candidates, and the BLOCKED decision if present.
  const pick = async (outcome: string, order: string): Promise<string | null> =>
    ((await sql(`SELECT "applicationId" AS id FROM "AssignmentTrace" WHERE outcome = $1 ORDER BY ${order} LIMIT 1`, [outcome]))[0]?.id as string | undefined) ?? null;
  const assignedApp = await pick('ASSIGNED', 'jsonb_array_length(candidates) DESC, id ASC');
  const blockedApp = await pick('BLOCKED', 'id ASC');
  const traces: Record<string, unknown> = {};
  for (const [file, id] of [['assignment-trace-assigned', assignedApp], ['assignment-trace-blocked', blockedApp]] as const) {
    if (!id) continue; // absent is absent: the generator draws "Not available", never a made-up example
    const r = await get(`/api/evidence/assignment-trace/${id}`);
    if (r.status !== 200) throw new Error(`GET assignment-trace/${id} returned ${r.status}`);
    traces[file] = r.body;
  }
  return { fetched, traces, assignedApp, blockedApp };
}

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url || !process.env.JWT_SECRET) {
    console.error('DATABASE_URL and JWT_SECRET must be set (they are read from ../.env).');
    return 2;
  }
  const db = new pg.Client({ connectionString: url, options: '-c default_transaction_read_only=on' });
  await db.connect();
  const sql = async (text: string, params: unknown[] = []) => (await db.query(text, params)).rows;
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', () => r()));
  try {
    const admin = (await sql(`SELECT id FROM "User" WHERE role = 'ADMIN' AND active ORDER BY email LIMIT 1`))[0];
    if (!admin) {
      console.error('No active ADMIN user in this database.');
      return 2;
    }
    const token = signToken({ sub: String(admin.id), role: 'ADMIN' });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const get = async (p: string) => {
      const res = await fetch(base + p, { headers: { authorization: `Bearer ${token}` } });
      return { status: res.status, body: await res.json().catch(() => null) };
    };

    // 1. Verification first. A disagreement means the API and the independent SQL differ: do not publish figures from that.
    const info = await describeDatabase(url, sql);
    const report = await runVerification({ get, sql });
    const agree = report.checks.length - report.failures.length;
    console.log(`verification: ${report.checks.length} checks, ${agree} agree, ${report.failures.length} disagree`);
    if (!report.ok) {
      for (const f of report.failures) console.error(`  [${f.window}] ${f.measure} (${f.endpoint}): API ${f.api} vs SQL ${f.sql}`);
      console.error('REFUSING to write a snapshot: the API disagrees with the independent SQL.');
      return 1;
    }

    // 2-3. The aggregate responses, unmodified (the ONLY part that knows how they are obtained; see fetchAggregates).
    const { fetched, traces, assignedApp, blockedApp } = await fetchAggregates(get, sql);

    // 4. Write.
    mkdirSync(outDir, { recursive: true });
    for (const [name, body] of Object.entries({ ...fetched, ...traces })) write(`${name}.json`, body);
    const full = git('rev-parse', 'HEAD');
    const manifest = {
      generatedAt: new Date().toISOString(),
      commit: { short: git('rev-parse', '--short', 'HEAD'), full, note: 'the commit checked out when the snapshot was taken (the code that produced these figures)' },
      workingTreeClean: git('status', '--porcelain', '--', 'api', 'shared').length === 0,
      database: { cluster: info.cluster, host: info.host, port: info.port, name: info.database },
      rowCounts: info.counts,
      files: [...Object.keys(fetched), ...Object.keys(traces)].map((n) => `${n}.json`).sort(),
      traceApplications: { assigned: assignedApp ? 'assignment-trace-assigned.json' : null, blocked: blockedApp ? 'assignment-trace-blocked.json' : null },
      command: 'npm run demo:reset && npm run evidence:snapshot && npm run evidence:visualize && npm run evidence:verify',
      provenance: 'synthetic demo dataset (seed + simulated clock)',
      verification: {
        command: 'npm run evidence:verify (the same logic, imported from api/src/evidence-verify.ts)',
        checks: report.checks.length,
        agree,
        disagree: report.failures.length,
        summary: `${report.checks.length} checks, ${agree} agree`,
        windows: report.windows.map((w) => w.label),
      },
    };
    write('manifest.json', manifest);
    console.log(`wrote ${Object.keys(fetched).length + Object.keys(traces).length} response files and manifest.json to ${path.relative(repoRoot, outDir)}`);
    return 0;
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await db.end();
    await prisma.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(2);
  },
);
