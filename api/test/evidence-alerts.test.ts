import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import { addDays, isoDate } from '../src/lib/dates.js';
import * as clock from '../src/lib/clock.js';
import { runEngineCycle } from '../src/engine/cycle.js';
import { bearer, firstUser, resetDb, setToday, userByEmail } from './helpers.js';
import { submitApp } from './fixtures.js';

const app = createApp();

describe('/api/evidence/alerts and engine-run totals', () => {
  let admin: Awaited<ReturnType<typeof firstUser>>;
  beforeEach(async () => {
    await resetDb();
    admin = await firstUser('ADMIN');
  });
  const get = (path: string) => request(app).get(path).set(...bearer(admin));

  /** One filed application, then the engine run on two simulated days: reminders/overdue first, escalations later. */
  async function raiseAlerts(): Promise<{ d1: string; d2: string }> {
    await submitApp(app, await userByEmail('college.abc@demo.in'));
    const d1 = setToday(addDays(clock.today(), 30));
    await runEngineCycle({ source: 'test' });
    const d2 = setToday(addDays(d1, 20));
    await runEngineCycle({ source: 'test' });
    return { d1: isoDate(d1), d2: isoDate(d2) };
  }

  it('1. total equals the AlertLog row count; byKind adds up to it; reminderTiming covers reminders only', async () => {
    await raiseAlerts();
    // Reminders need a compliance item the fixture lacks: add one late and one on-time reminder row, as the engine writes them.
    const base = { kind: 'REMINDER', offsetOrLevel: 7, triggerDate: clock.today(), createdAt: clock.now() };
    await prisma.alertLog.createMany({ data: [{ ...base, itemId: 9_000_001n, late: true }, { ...base, itemId: 9_000_002n, late: false }] });
    const n = await prisma.alertLog.count();
    expect(n).toBeGreaterThan(0);
    const body = (await get('/api/evidence/alerts')).body;
    const { data } = body;
    expect(data.total).toBe(n);
    expect(data.engineEverRan).toBe(true);
    expect(data.byKind.reduce((s: number, k: { count: number }) => s + k.count, 0)).toBe(n);
    const rem = await prisma.alertLog.count({ where: { kind: 'REMINDER' } });
    const lateRem = await prisma.alertLog.count({ where: { kind: 'REMINDER', late: true } });
    expect(rem).toBeGreaterThan(0);
    expect(rem).toBeLessThan(n); // other kinds exist, and are not counted as on time
    expect(data.reminderTiming).toEqual({ reminders: rem, late: lateRem, onTime: rem - lateRem });
    expect(data.reminderTiming.onTime + data.reminderTiming.late).toBe(data.reminderTiming.reminders);
    expect(data).not.toHaveProperty('timing');
    expect(body.definition.reminderTiming).toMatch(/reminder alerts only/i);
  });

  it('2. perDay lists only days with alerts, matches an independent grouping and sums to total', async () => {
    const { d1, d2 } = await raiseAlerts();
    const { data } = (await get('/api/evidence/alerts')).body;
    const indep = await prisma.$queryRaw<{ d: string; n: number }[]>`SELECT "createdAt"::date::text AS d, count(*)::int AS n FROM "AlertLog" GROUP BY 1 ORDER BY 1`;
    expect(data.perDay).toEqual(indep.map((r) => ({ day: r.d, count: r.n })));
    expect(data.perDay.every((r: { count: number }) => r.count > 0)).toBe(true);
    expect(data.perDay.reduce((s: number, r: { count: number }) => s + r.count, 0)).toBe(data.total);
    expect(d2 > d1).toBe(true);
    expect(data.perDay.length).toBeLessThan(
      Math.round((Date.parse(data.perDay.at(-1).day) - Date.parse(data.perDay[0].day)) / 86_400_000) + 1,
    ); // the 20-day gap between the two runs is not filled with zeros
  });

  it('3. an empty window after a run is a genuine 0; with no run and no alerts ever it is null', async () => {
    await raiseAlerts();
    const empty = (await get('/api/evidence/alerts?from=2000-01-01&to=2000-01-02')).body.data;
    expect(empty.engineEverRan).toBe(true);
    expect(empty.total).toBe(0);
    expect(empty.perDay).toEqual([]);
    expect(empty.reminderTiming).toEqual({ reminders: 0, onTime: 0, late: 0 });
    await prisma.alertLog.deleteMany();
    await prisma.engineRun.deleteMany();
    const none = (await get('/api/evidence/alerts')).body.data;
    expect(none.engineEverRan).toBe(false);
    expect(none.total).toBeNull();
    expect(none.reminderTiming).toBeNull();
    expect(none.perDay).toEqual([]);
    expect(none.byKind).toEqual([]);
  });

  it('4. the window narrows byKind, reminderTiming, perDay and escalationsByLevel together', async () => {
    const { d2 } = await raiseAlerts();
    const all = (await get('/api/evidence/alerts')).body.data;
    const w = (await get(`/api/evidence/alerts?from=${d2}&to=${d2}`)).body;
    const expected = await prisma.alertLog.count({ where: { createdAt: { gte: new Date(`${d2}T00:00:00Z`), lt: addDays(new Date(`${d2}T00:00:00Z`), 1) } } });
    expect(expected).toBeGreaterThan(0);
    expect(expected).toBeLessThan(all.total);
    const sum = (xs: { count: number }[]) => xs.reduce((s, x) => s + x.count, 0);
    expect(w.data.total).toBe(expected);
    expect(sum(w.data.byKind)).toBe(expected);
    expect(w.data.reminderTiming.reminders).toBe(await prisma.alertLog.count({ where: { kind: 'REMINDER', createdAt: { gte: new Date(`${d2}T00:00:00Z`), lt: addDays(new Date(`${d2}T00:00:00Z`), 1) } } }));
    expect(sum(w.data.perDay)).toBe(expected);
    expect(w.data.perDay.map((p: { day: string }) => p.day)).toEqual([d2]);
    expect(sum(w.data.escalationsByLevel)).toBe(w.data.byKind.find((k: { kind: string }) => k.kind === 'ESCALATION')?.count ?? 0);
    expect(w.data.window).toEqual({ from: d2, to: d2 });
  });

  it('5. escalationsByLevel equals ESCALATION rows grouped by level and sums to the ESCALATION kind', async () => {
    await raiseAlerts();
    const { data } = (await get('/api/evidence/alerts')).body;
    const indep = await prisma.alertLog.groupBy({ by: ['offsetOrLevel'], where: { kind: 'ESCALATION' }, _count: { _all: true }, orderBy: { offsetOrLevel: 'asc' } });
    expect(indep.length).toBeGreaterThan(0);
    expect(data.escalationsByLevel).toEqual(indep.map((g) => ({ level: g.offsetOrLevel, count: g._count._all })));
    expect(data.escalationsByLevel.reduce((s: number, e: { count: number }) => s + e.count, 0)).toBe(data.byKind.find((k: { kind: string }) => k.kind === 'ESCALATION').count);
  });

  it('6. notifications are uninformative while none is read, informative after one is read through the API', async () => {
    await raiseAlerts();
    await prisma.notification.updateMany({ data: { read: false } });
    const before = (await get('/api/evidence/alerts')).body.data.notifications;
    expect(before.total).toBe(await prisma.notification.count());
    expect(before.total).toBeGreaterThan(0);
    expect(before.read).toBe(0);
    expect(before.unread).toBe(before.total);
    expect(before.informative).toBe(false);
    const n = await prisma.notification.findFirstOrThrow({ select: { id: true, userId: true } });
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: n.userId }, select: { email: true } });
    const res = await request(app).post('/api/notifications/read').set(...bearer(await userByEmail(owner.email))).send({ ids: [n.id] });
    expect(res.status).toBe(200);
    const after = (await get('/api/evidence/alerts')).body.data.notifications;
    expect(after.read).toBe(1);
    expect(after.unread).toBe(before.total - 1);
    expect(after.informative).toBe(true);
  });

  it('7. states what is not recorded and invents no status field; no "fair" anywhere', async () => {
    await raiseAlerts();
    const body = (await get('/api/evidence/alerts')).body;
    expect(body.data.notRecorded).toEqual(['acknowledgement', 'resolution time']);
    expect(body.definition.notRecorded).toMatch(/not recorded/i);
    const keys: string[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (keys.push(k), walk(x));
    };
    walk(body);
    for (const bad of ['acknowledged', 'resolved', 'status']) expect(keys).not.toContain(bad);
    expect(JSON.stringify(body)).not.toMatch(/\bfair/i);
    expect(JSON.stringify(body)).not.toMatch(/tamper-proof|exactly-once|exactly once|production-ready/i);
    expect(body.definition.perDay).toMatch(/not an operational trend/i);
    expect(body.definition.perDay).toMatch(/simulated/i);
  });

  it('8. engine-runs totals equal independent sums and the AlertLog row count', async () => {
    await raiseAlerts();
    const r = (await get('/api/evidence/engine-runs?pageSize=1')).body;
    const sums = await prisma.engineRun.aggregate({ _sum: { alertsCreated: true, alertsSuppressed: true }, _count: { _all: true } });
    expect(sums._sum.alertsCreated).toBe(await prisma.alertLog.count()); // every alert here was raised by a recorded run (107 = 107 in the seeded dev DB)
    expect(r.rows).toHaveLength(1); // totals do not come from the page
    expect(r.totals).toEqual({
      runCount: sums._count._all,
      failedCount: await prisma.engineRun.count({ where: { status: 'FAILED' } }),
      abandonedCount: 0,
      alertsCreated: sums._sum.alertsCreated,
      alertsSuppressed: sums._sum.alertsSuppressed,
    });
    expect(r.totals.runCount).toBe(r.total);
    const failedOnly = (await get('/api/evidence/engine-runs?status=FAILED')).body;
    expect(failedOnly.totals.runCount).toBe(failedOnly.total); // same filter as the rows
  });

  it('9. totals over an empty window: runCount 0 and null (not 0) sums', async () => {
    const r = (await get('/api/evidence/engine-runs?from=2000-01-01&to=2000-01-02')).body;
    expect(r.total).toBe(0);
    expect(r.totals).toEqual({ runCount: 0, failedCount: 0, abandonedCount: 0, alertsCreated: null, alertsSuppressed: null });
  });

  it('10. a RUNNING row from an hour ago is abandoned; one from a minute ago is not', async () => {
    const mk = (ageMs: number) =>
      prisma.engineRun.create({ data: { startedAt: new Date(Date.now() - ageMs), instanceId: 't', simulatedToday: clock.today(), provenance: 'TEST_RUN', status: 'RUNNING' } });
    await mk(3_600_000);
    await mk(60_000);
    const t = (await get('/api/evidence/engine-runs')).body.totals;
    expect(t.abandonedCount).toBe(1);
    expect(await prisma.engineRun.count({ where: { status: 'RUNNING' } })).toBe(2);
  });

  it('12. alerts and engine runs share one clock: alerts.total equals totals.alertsCreated in every window', async () => {
    const { d1, d2 } = await raiseAlerts();
    for (const q of ['', `?from=${d1}&to=${d2}`, `?from=${d2}&to=${d2}`, `?from=${d1}&to=${d1}`]) {
      const a = (await get(`/api/evidence/alerts${q}`)).body.data;
      const r = (await get(`/api/evidence/engine-runs${q}`)).body;
      expect(a.total).toBeGreaterThan(0);
      expect(r.totals.alertsCreated).toBe(a.total);
      expect(r.totals.runCount).toBe(r.total);
    }
  });

  it('13. a run made on the simulated date is inside from=to=that date; an empty window has genuine 0 alerts but null run sums', async () => {
    const run = await runEngineCycle({ source: 'test' });
    const day = run.today as string;
    const r = (await get(`/api/evidence/engine-runs?from=${day}&to=${day}`)).body;
    expect(r.total).toBe(1);
    expect(r.totals.runCount).toBe(1);
    expect((await get(`/api/evidence/compliance?from=${day}&to=${day}`)).body.data.alerts.engineRunCount).toBe(1); // compliance windows runs the same way
    const empty = '?from=2000-01-01&to=2000-01-02';
    const a = (await get(`/api/evidence/alerts${empty}`)).body.data;
    const e = (await get(`/api/evidence/engine-runs${empty}`)).body;
    expect(a.total).toBe(0); // the engine has run: a measured zero
    expect(e.totals.alertsCreated).toBeNull(); // no run recorded in this window: absent
    expect(e.totals.alertsSuppressed).toBeNull();
  });

  it('14. abandonedCount follows the date window and status filter; summary.scheduler.stuckRuns counts all dates', async () => {
    const mk = (simulatedToday: string, status: 'RUNNING' | 'OK', ageMs: number) =>
      prisma.engineRun.create({ data: { startedAt: new Date(Date.now() - ageMs), instanceId: 't', simulatedToday: new Date(`${simulatedToday}T00:00:00Z`), provenance: 'TEST_RUN', status } });
    await mk('2020-01-01', 'RUNNING', 3_600_000); // stuck, dated outside the 2026 window
    await mk('2026-06-01', 'RUNNING', 3_600_000); // stuck, inside
    await mk('2026-06-01', 'RUNNING', 60_000); // in flight, inside
    await mk('2026-06-01', 'OK', 3_600_000); // old but finished
    const inWin = (await get('/api/evidence/engine-runs?from=2026-01-01&to=2026-12-31')).body.totals;
    expect(inWin.runCount).toBe(3);
    expect(inWin.abandonedCount).toBe(1);
    expect((await get('/api/evidence/engine-runs?from=2019-01-01&to=2020-12-31')).body.totals.abandonedCount).toBe(1);
    expect((await get('/api/evidence/engine-runs?from=2026-01-01&to=2026-12-31&status=OK')).body.totals.abandonedCount).toBe(0); // status filter applies
    expect((await get('/api/evidence/engine-runs?status=RUNNING')).body.totals.abandonedCount).toBe(2);
    const sum = (await get('/api/evidence/summary')).body;
    expect(sum.scheduler.stuckRuns).toBe(2); // all dates, unfiltered
  });

  it('15. every windowed evidence endpoint rejects a non-existent calendar date with 400 and accepts a leap day', async () => {
    for (const ep of ['engine-runs', 'alerts', 'compliance', 'workflow', 'assignment', 'audit-analytics']) {
      for (const bad of ['from=2026-13-45', 'from=2026-02-30', 'to=2026-11-31', 'to=2027-02-29']) {
        const r = await get(`/api/evidence/${ep}?${bad}`);
        expect(r.status, `${ep} ${bad}`).toBe(400);
        expect(JSON.stringify(r.body)).toMatch(/real calendar date/i);
      }
      expect((await get(`/api/evidence/${ep}?from=2028-02-29&to=2028-02-29`)).status, `${ep} leap day`).toBe(200);
    }
  });

  it('16. the same empty window reads the same in alerts and compliance, with one wording for zero', async () => {
    await raiseAlerts();
    const q = '?from=2099-01-01&to=2099-01-02';
    const a = (await get(`/api/evidence/alerts${q}`)).body;
    const c = (await get(`/api/evidence/compliance${q}`)).body;
    expect(a.data.total).toBe(0);
    expect(c.data.alerts.total).toBe(0);
    const zero = 'A total of 0 means no alert was logged in this window.';
    expect(a.definition.total).toContain(zero);
    expect(c.definition.alerts).toContain(zero);
    expect(c.definition.alerts).not.toMatch(/measured as zero/i);
    expect(c.definition.alerts).toMatch(/dated in the window/i);
    expect(c.data.alerts.suppressed).toBeNull();
    expect(JSON.stringify(a.definition)).not.toMatch(/\btiming\b(?!:)|, timing,/);
  });
});
