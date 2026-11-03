import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import * as clock from '../src/lib/clock.js';
import { runEngineCycle } from '../src/engine/cycle.js';
import { headCommit } from '../src/routes/evidence/artifacts.js';
import { tamperOneRow } from '../scripts/demo-tamper.js';
import { bearer, firstUser, resetDb, userByEmail } from './helpers.js';
import { openAssignment, submitApp } from './fixtures.js';

const app = createApp();
let dir: string;

/** Fixture: the stored test-result artifact, exactly as a CI step would commit it. */
async function writeArtifact(a: { commit: string; passed: number; failed: number; status?: 'PASS' | 'FAIL' }) {
  const status = a.status ?? (a.failed === 0 ? 'PASS' : 'FAIL');
  await fs.writeFile(path.join(dir, 'test-results.json'), JSON.stringify({ ...a, status, runAt: '2026-11-03T10:00:00Z' }));
}

describe('/api/evidence', () => {
  let admin: Awaited<ReturnType<typeof firstUser>>;
  let officer: Awaited<ReturnType<typeof firstUser>>;

  beforeEach(async () => {
    await resetDb();
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'evidence-'));
    process.env.EVIDENCE_DIR = dir;
    process.env.FORMCHECK_METRICS = path.join(dir, 'no-formcheck.json');
    admin = await firstUser('ADMIN');
    officer = await firstUser('OFFICER');
  });
  afterEach(async () => {
    delete process.env.EVIDENCE_DIR;
    delete process.env.FORMCHECK_METRICS;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('serves the summary as NOT_VERIFIED when no test-result artifact exists [Review Focus 3]', async () => {
    const r = await request(app).get('/api/evidence/summary').set(...bearer(admin));
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('NOT_VERIFIED');
    expect(r.body.status).not.toBe('PASS');
    expect(r.body.checks).toEqual({ passed: null, failed: null, notVerified: null });
  });

  it('serves the summary as STALE when the artifact records a different commit [Review Focus 3]', async () => {
    await writeArtifact({ commit: 'deadbee', passed: 183, failed: 0 });
    const r = await request(app).get('/api/evidence/summary').set(...bearer(admin));
    expect(r.body.status).toBe('STALE');
    expect(r.body.artifactCommit).toBe('deadbee');
    expect(r.body.commit).not.toBe('deadbee');
    expect(r.body.checks.passed).toBeNull();
  });

  it('reports what a current artifact records, PASS or FAIL, and nothing else', async () => {
    const head = (await headCommit())!;
    await writeArtifact({ commit: head.slice(0, 7), passed: 183, failed: 0 });
    expect((await request(app).get('/api/evidence/summary').set(...bearer(admin))).body).toMatchObject({ status: 'PASS', checks: { passed: 183, failed: 0 } });
    await writeArtifact({ commit: head, passed: 180, failed: 3 });
    expect((await request(app).get('/api/evidence/summary').set(...bearer(admin))).body.status).toBe('FAIL');
  });

  it('never turns a malformed or self-contradictory artifact into PASS, and never a 500', async () => {
    const head = (await headCommit())!;
    for (const body of ['{not json', '{}', JSON.stringify({ commit: head, passed: 5, failed: 0 }), JSON.stringify({ commit: head, status: 'PASS', passed: 5, failed: 2 })]) {
      await fs.writeFile(path.join(dir, 'test-results.json'), body);
      const r = await request(app).get('/api/evidence/summary').set(...bearer(admin));
      expect(r.status).toBe(200);
      expect(r.body.status).toBe('NOT_VERIFIED');
    }
  });

  it('reads a vacuous PASS (nothing passed) as NOT_VERIFIED, and PASS with unverified checks as not clean', async () => {
    const head = (await headCommit())!;
    await fs.writeFile(path.join(dir, 'test-results.json'), JSON.stringify({ commit: head, status: 'PASS', passed: 0, failed: 0 }));
    expect((await request(app).get('/api/evidence/summary').set(...bearer(admin))).body.status).toBe('NOT_VERIFIED');
    await fs.writeFile(path.join(dir, 'test-results.json'), JSON.stringify({ commit: head, status: 'PASS', passed: 180, failed: 0, notVerified: 4 }));
    const r = await request(app).get('/api/evidence/summary').set(...bearer(admin));
    expect(r.body.status).toBe('NOT_VERIFIED');
    expect(r.body.checks).toEqual({ passed: 180, failed: 0, notVerified: 4 });
    expect(r.body.detail).toMatch(/not a clean pass/);
  });

  it('reads a commit longer than HEAD or not hex as NOT_VERIFIED, and a different sha as STALE', async () => {
    const head = (await headCommit())!;
    await writeArtifact({ commit: head + 'abc', passed: 183, failed: 0 });
    const longer = await request(app).get('/api/evidence/summary').set(...bearer(admin));
    expect(longer.body.status).toBe('NOT_VERIFIED'); // over 40 hex chars is not a sha: rejected, never current
    expect(longer.body.status).not.toBe('PASS');
    await writeArtifact({ commit: head.slice(0, 7).replace(/.$/, head[6] === '0' ? '1' : '0'), passed: 183, failed: 0 });
    const other = await request(app).get('/api/evidence/summary').set(...bearer(admin));
    expect(other.body.status).toBe('STALE');
    expect(other.body.lastRunAt).toBeNull();
    expect(other.body.provenance.status).toBeNull();
    await writeArtifact({ commit: head.slice(0, 6) + 'zzzz', passed: 183, failed: 0 });
    expect((await request(app).get('/api/evidence/summary').set(...bearer(admin))).body.status).toBe('NOT_VERIFIED');
  });

  it('refuses every endpoint to a non-ADMIN role and leaks nothing [Review Focus 2]', async () => {
    for (const path of ['/summary', '/engine-runs', '/audit-integrity', '/artifacts', '/assignment-trace/anything']) {
      const r = await request(app).get(`/api/evidence${path}`).set(...bearer(officer));
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('ACCESS_DENIED');
      expect(JSON.stringify(r.body)).not.toMatch(/applicationNo|rowHash|officerId/);
    }
  });

  it('pages engine runs newest first and filters by status', async () => {
    await runEngineCycle({ source: 'test' });
    await runEngineCycle({ source: 'test' });
    const r = await request(app).get('/api/evidence/engine-runs?status=OK&pageSize=10').set(...bearer(admin));
    expect(r.body.rows.length).toBeGreaterThan(0);
    expect(r.body.rows.every((x: { status: string }) => x.status === 'OK')).toBe(true);
    expect(r.body.total).toBeGreaterThanOrEqual(r.body.rows.length);
    const ids = r.body.rows.map((x: { id: string }) => BigInt(x.id));
    expect(ids[0] > ids[1]).toBe(true);
    expect(r.body.rows[0].provenance).toBe('TEST_RUN'); // passed through, not overwritten
  });

  it('reports audit integrity from a live check, and reports a break after tampering', async () => {
    const ok = await request(app).get('/api/evidence/audit-integrity').set(...bearer(admin));
    expect(ok.body.ok).toBe(true);
    expect(ok.body.provenance).toBe('LIVE_DEMO');
    await tamperOneRow();
    const bad = await request(app).get('/api/evidence/audit-integrity').set(...bearer(admin));
    expect(bad.body.ok).toBe(false);
    expect(bad.body.firstBroken).toBeTruthy();
  });

  it('states trace coverage: a manual reassignment has an assignment but no trace', async () => {
    const id = (await submitApp(app, await userByEmail('college.abc@demo.in'))).body.application.id;
    const first = (await openAssignment(id))!;
    const before = await request(app).get(`/api/evidence/assignment-trace/${id}`).set(...bearer(admin));
    expect(before.body.coverage).toEqual({ tracedCount: 1, assignmentTotal: 1, blockedCount: 0 });
    expect(before.body.rows.length).toBeGreaterThan(0);
    const { reassignManual } = await import('../src/assignment/engine.js');
    await reassignManual(await userByEmail('kumar@demo.in'), first.id, (await userByEmail('meena@demo.in')).id, 'Balancing load');
    const after = await request(app).get(`/api/evidence/assignment-trace/${id}`).set(...bearer(admin));
    expect(after.body.coverage).toEqual({ tracedCount: 1, assignmentTotal: 2, blockedCount: 0 });
    expect(await prisma.assignment.count({ where: { applicationId: id } })).toBe(2);
  });

  it('lists stored artifacts with provenance, marking an unreadable one NOT_VERIFIED', async () => {
    await fs.mkdir(path.join(dir, 'benchmark-results'));
    await fs.writeFile(path.join(dir, 'benchmark-results', 'a1b2c3d.json'), JSON.stringify({ commit: 'a1b2c3d', provenance: 'MEASURED', data: {} }));
    await fs.writeFile(path.join(dir, 'benchmark-results', 'broken.json'), '{oops');
    await fs.writeFile(path.join(dir, 'benchmark-results', 'plain.json'), JSON.stringify({ commit: 'a1b2c3d' }));
    const r = await request(app).get('/api/evidence/artifacts').set(...bearer(admin));
    const by = new Map(r.body.artifacts.map((a: { name: string }) => [a.name, a]));
    expect(by.get('benchmark-results/a1b2c3d.json')).toMatchObject({ status: 'READ', provenance: 'MEASURED', commit: 'a1b2c3d' });
    expect(by.get('benchmark-results/broken.json')).toMatchObject({ status: 'NOT_VERIFIED', data: null });
    expect(by.get('benchmark-results/plain.json')).toMatchObject({ status: 'READ', provenance: null }); // not guessed
    expect(by.get('formcheck/metrics.json')).toMatchObject({ status: 'NOT_VERIFIED', provenance: null });
  });

  it('ships a plain-language definition and provenance for summary and engine-runs', async () => {
    await runEngineCycle({ source: 'test' });
    const sum = (await request(app).get('/api/evidence/summary').set(...bearer(admin))).body;
    const runs = (await request(app).get('/api/evidence/engine-runs').set(...bearer(admin))).body;
    for (const d of [...Object.values(sum.definition), ...Object.values(runs.definition)]) expect(String(d).length).toBeGreaterThan(40);
    expect(Object.keys(sum.definition)).toEqual(['status', 'scheduler', 'stuckRuns']);
    expect(Object.keys(runs.definition).sort()).toEqual(['abandoned', 'alertsCreated', 'alertsSuppressed', 'rows', 'totals', 'window']);
    for (const w of ['PASS', 'FAIL', 'STALE', 'NOT_VERIFIED']) expect(sum.definition.status).toContain(w);
    expect(sum.definition.status).toMatch(/never runs tests|does not run tests|never run/i);
    expect(sum.definition.scheduler).not.toMatch(/no heartbeat/i);
    expect(sum.definition.scheduler).toMatch(/most recent check-in of the instance marked as leader/i);
    expect(sum.definition.scheduler).toMatch(/does not by itself mean/i);
    expect(runs.definition.abandoned).toMatch(/15 minutes/);
    expect(runs.definition.window).toMatch(/date the engine treated as today/i);
    expect(sum.provenance.scheduler).toBe('MEASURED');
    expect(sum.scheduler.heartbeat).toBeNull(); // nothing has reported
    await prisma.schedulerHeartbeat.deleteMany();
    await prisma.schedulerHeartbeat.create({ data: { instanceId: 'sched-1', isLeader: true, lastRunAt: new Date(clock.now().getTime() - 30_000), lastResult: {} } });
    await prisma.schedulerHeartbeat.create({ data: { instanceId: 'standby', isLeader: false, lastRunAt: clock.now(), lastResult: {} } });
    const hb = (await request(app).get('/api/evidence/summary').set(...bearer(admin))).body.scheduler.heartbeat;
    expect(hb).toMatchObject({ instanceId: 'sched-1', isLeader: true });
    expect(hb.ageSeconds).toBeGreaterThanOrEqual(29); // aged on the same clock that wrote it
    expect(hb.ageSeconds).toBeLessThan(120);
    expect(runs.provenance).toEqual({ rows: 'MEASURED', totals: 'MEASURED' });
    expect(JSON.stringify([sum, runs])).not.toMatch(/\bfair|tamper-proof|exactly-once|exactly once|production-ready/i);
  });
});
