import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import { runEngineCycle } from '../src/engine/cycle.js';
import { bearer, firstUser, resetDb, setToday, shiftDays, userByEmail } from './helpers.js';
import { addWorkingDays } from '../src/lib/workdays.js';
import { act, submitApp, toDecision } from './fixtures.js';

const app = createApp();
type Row = Record<string, unknown> & { stage?: string; reached?: number; count?: number };

describe('/api/evidence aggregates', () => {
  let admin: Awaited<ReturnType<typeof firstUser>>;
  beforeEach(async () => {
    await resetDb();
    admin = await firstUser('ADMIN');
  });
  const get = (path: string) => request(app).get(path).set(...bearer(admin));

  /** A real application taken through scrutiny, EVC and the authority's decision, `later` days after filing. */
  async function driveToDecided(collegeEmail: string, later = 0): Promise<string> {
    const id = await toDecision(app, await userByEmail(collegeEmail), 'NEW_INSTITUTION'); // route: scrutiny, EVC, decision
    if (later) shiftDays(later);
    const authority = await prisma.user.findFirstOrThrow({ where: { role: 'AUTHORITY', region: { applications: { some: { id } } } } });
    const r = await act(app, authority, id, 'DECIDE', { reason: 'Approved.', payload: { outcome: 'APPROVED' } });
    expect(r.status).toBe(200);
    return id;
  }
  async function fileOnly(collegeEmail: string): Promise<string> {
    const s = await submitApp(app, await userByEmail(collegeEmail));
    expect(s.status).toBe(201);
    return s.body.application.id;
  }

  it('counts the funnel from stage transitions, not current status', async () => {
    await driveToDecided('college.abc@demo.in');
    await fileOnly('college.002@demo.in'); // stays at scrutiny
    // Independent count: the decided case is APPROVED now, so a status-based funnel would put it nowhere but the end.
    expect(await prisma.application.count({ where: { status: 'IN_STAGE' } })).toBe(1);
    const r = await get('/api/evidence/workflow');
    expect(r.status).toBe(200);
    const reached = (s: string) => (r.body.data.funnel as Row[]).find((x) => x.stage === s)!.reached;
    expect(reached('SUBMITTED')).toBe(2);
    expect(reached('SCRUTINY')).toBe(2); // the decided case passed through scrutiny
    expect(reached('EVC')).toBe(1);
    expect(reached('DECISION')).toBe(1);
    expect(reached('DECIDED')).toBe(1);
    expect(r.body.data.funnel.find((x: Row) => x.stage === 'DECIDED').share).toBeCloseTo(0.5);
    expect(r.body.definition.funnel).toMatch(/denominator/i);
  });

  it('reports processing time over decided cases only, with the censored counts', async () => {
    await driveToDecided('college.abc@demo.in', 0); // 0 working days
    setToday();
    await driveToDecided('college.002@demo.in', 4); // Mon 2 Nov -> Fri 6 Nov: 4 working days
    setToday();
    await fileOnly('college.003@demo.in'); // in flight: must not enter the sample
    const r = await get('/api/evidence/workflow');
    const p = r.body.data.processingTime;
    expect(p.decidedCount).toBe(2);
    expect(p.inFlightCount).toBe(1);
    expect(p.medianWorkingDays).toBe(2); // median of {0, 4}
    expect(p).toHaveProperty('medianWorkingDays');
    expect(p).not.toHaveProperty('mean');
    expect(r.body.definition.processingTime).toMatch(/decided|censor/i);
    expect(r.body.definition.processingTime).toMatch(/median/i);
  });

  it('returns null rather than 0 for a measure with no data in the window', async () => {
    await driveToDecided('college.abc@demo.in');
    const r = await get('/api/evidence/workflow?from=1990-01-01&to=1990-01-02');
    expect(r.body.data.processingTime.medianWorkingDays).toBeNull();
    expect(r.body.data.processingTime.decidedCount).toBe(0);
    expect(r.body.data.funnel.every((s: Row) => s.share === null)).toBe(true); // 0 / 0 is absent, not 0%
  });

  it('computes utilisation spread only over officers with capacity, and names the denominator', async () => {
    const id = await fileOnly('college.abc@demo.in');
    const withCapacity = await prisma.officerProfile.count({ where: { capacityPoints: { gt: 0 } } });
    // Independent expectation: population standard deviation from the raw rows.
    const profiles = await prisma.officerProfile.findMany({ where: { capacityPoints: { gt: 0 } } });
    const open = await prisma.assignment.findMany({ where: { releasedAt: null } });
    const util = profiles.map((p) => open.filter((a) => a.officerId === p.userId).reduce((n, a) => n + Number(a.weight), 0) / Number(p.capacityPoints));
    const mean = util.reduce((a, b) => a + b, 0) / util.length;
    const sd = Math.sqrt(util.reduce((a, b) => a + (b - mean) ** 2, 0) / util.length);

    const r = await get('/api/evidence/assignment');
    const a = r.body.data;
    expect(a.spread.officerCount).toBe(withCapacity);
    expect(a.spread.stdDev).toBeCloseTo(sd, 6);
    expect(a.officers.length).toBe(withCapacity);
    expect(r.body.definition.spread).toMatch(/standard deviation/i);
    expect(typeof a.rulePackVersions[0].label).toBe('string');
    expect(JSON.stringify(r.body)).not.toMatch(/\bfair/i);

    // Ruling E7: coverage is stated, and a manual assignment (no trace) lowers it.
    expect(a.coverage).toEqual({ tracedCount: open.length, assignmentTotal: open.length, blockedCount: 0 });
    await prisma.assignmentTrace.deleteMany({ where: { applicationId: id } });
    const after = (await get('/api/evidence/assignment')).body.data.coverage;
    expect(after.assignmentTotal).toBe(open.length);
    expect(after.tracedCount).toBe(0);
    expect(r.body.definition.coverage).toMatch(/manual/i);
  });

  it('the alerts total equals the AlertLog rows in the window, and suppressed comes from EngineRun', async () => {
    await fileOnly('college.abc@demo.in');
    // At risk must match the engine's own alert: move to the working day on which 80% of the stage SLA is used.
    const item = await prisma.deadlineItem.findFirstOrThrow({ where: { status: 'OPEN', type: 'STAGE_SLA' } });
    setToday(addWorkingDays(item.createdAt, Math.ceil(item.totalDays! * 0.8)));
    const early = await runEngineCycle({ source: 'test' });
    expect(early.atRisk).toBe(1);
    const mid = (await get('/api/evidence/compliance')).body.data.deadlines;
    expect(mid.atRisk).toBe(early.atRisk);
    expect(mid.overdue).toBe(0);
    shiftDays(30); // its stage deadline is now overdue
    await runEngineCycle({ source: 'test' });
    await runEngineCycle({ source: 'test' }); // second pass: duplicates prevented
    const r = await get('/api/evidence/compliance');
    const c = r.body.data;
    expect(c.alerts.total).toBe(await prisma.alertLog.count());
    expect(c.alerts.total).toBeGreaterThan(0);
    expect(c.alerts.byKind.reduce((n: number, k: Row) => n + (k.count as number), 0)).toBe(c.alerts.total);
    expect(c.alerts.byLate.late + c.alerts.byLate.onTime).toBe(c.alerts.total);
    const sup = await prisma.engineRun.aggregate({ _sum: { alertsSuppressed: true } });
    expect(c.alerts.suppressed).toBe(sup._sum.alertsSuppressed);
    expect(c.alerts.suppressed).toBeGreaterThan(0);
    expect(c.escalations.reduce((n: number, e: Row) => n + (e.count as number), 0)).toBe(await prisma.alertLog.count({ where: { kind: 'ESCALATION' } }));
    // Deadline states: the open item is overdue by the engine's own rule, and the partition sums to the open total.
    expect(c.deadlines.overdue).toBe(1);
    expect(c.deadlines.overdue + c.deadlines.atRisk + c.deadlines.dueSoon + c.deadlines.onTrack).toBe(c.deadlines.openTotal);
    expect(r.body.definition.deadlines.overdue).toMatch(/working/i);
  });

  it('the funnel and the status distribution agree on the application total', async () => {
    await driveToDecided('college.abc@demo.in');
    await fileOnly('college.002@demo.in');
    const r = await get('/api/evidence/workflow');
    const d = r.body.data;
    const statusTotal = d.statusDistribution.reduce((n: number, s: Row) => n + (s.count as number), 0);
    expect(statusTotal).toBe(d.submittedTotal);
    expect(statusTotal).toBe(await prisma.application.count());
    expect(d.funnel.find((s: Row) => s.stage === 'SUBMITTED').reached).toBe(d.submittedTotal);
    expect(d.processingTime.decidedCount + d.processingTime.inFlightCount).toBe(d.submittedTotal);
  });

  it('audit analytics returns counts only, never case state', async () => {
    await driveToDecided('college.abc@demo.in');
    const r = await get('/api/evidence/audit-analytics');
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toMatch(/fromState|toState|rowHash/);
    const total = await prisma.auditLog.count();
    expect(r.body.data.total).toBe(total);
    const sum = (rows: Row[]) => rows.reduce((n, x) => n + (x.count as number), 0);
    expect(sum(r.body.data.byAction)).toBe(total);
    expect(sum(r.body.data.byActorRole)).toBe(total);
    expect(sum(r.body.data.byEntity)).toBe(total);
    expect(r.body.data.byAction.find((x: Row) => x.action === 'DECIDE').count).toBe(await prisma.auditLog.count({ where: { action: 'DECIDE' } }));
    expect(r.body.data.integrity.ok).toBe(true);
    const only = await get('/api/evidence/audit-analytics?action=SUBMIT');
    expect(only.body.data.total).toBe(await prisma.auditLog.count({ where: { action: 'SUBMIT' } }));
  });

  it('a date filter narrows every measure in the response, not some of them', async () => {
    await driveToDecided('college.abc@demo.in');
    shiftDays(30);
    await runEngineCycle({ source: 'test' });
    const wide = await get('/api/evidence/workflow');
    const narrow = await get('/api/evidence/workflow?from=2099-01-01&to=2099-01-02');
    expect(narrow.body.data.submittedTotal).toBe(0);
    expect(narrow.body.data.volumeOverTime).toEqual([]);
    expect(narrow.body.data.statusDistribution.every((s: Row) => s.count === 0)).toBe(true);
    expect(narrow.body.data.funnel.every((s: Row) => s.reached === 0)).toBe(true);
    expect(narrow.body.data.processingTime.decidedCount).toBe(0);
    expect(narrow.body.data.processingTime.inFlightCount).toBe(0);
    expect(wide.body.data.submittedTotal).toBeGreaterThan(0);
    // The same window empties the other tabs too.
    const q = '?from=2099-01-01&to=2099-01-02';
    const c = (await get(`/api/evidence/compliance${q}`)).body.data;
    expect(c.alerts.total).toBe(0);
    expect(c.deadlines.openTotal).toBe(0);
    expect(c.alerts.suppressed).toBeNull(); // no engine run in the window: absent, not 0
    const as = (await get(`/api/evidence/assignment${q}`)).body.data;
    expect(as.coverage.assignmentTotal).toBe(0);
    expect(as.officers.every((o: Row) => o.openPoints === 0)).toBe(true);
    expect((await get(`/api/evidence/audit-analytics${q}`)).body.data.total).toBe(0);
  });
});
