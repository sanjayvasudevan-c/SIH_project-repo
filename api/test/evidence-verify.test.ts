import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import pg from 'pg';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import * as clock from '../src/lib/clock.js';
import { addDays } from '../src/lib/dates.js';
import { runEngineCycle } from '../src/engine/cycle.js';
import { describeDatabase, formatTable, runVerification, type VerifyIO } from '../src/evidence-verify.js';
import { bearer, firstUser, resetDb, shiftDays, userByEmail } from './helpers.js';
import { decideWithConditions, submitApp, toDecision } from './fixtures.js';

const app = createApp();
let db: pg.Client | null = null;

/** The verifier's two inputs, wired as the CLI wires them: HTTP as the administrator and a READ-ONLY SQL session. */
async function io(): Promise<VerifyIO> {
  const admin = await firstUser('ADMIN');
  db = new pg.Client({ connectionString: process.env.DATABASE_URL, options: '-c default_transaction_read_only=on' });
  await db.connect();
  const c = db;
  return {
    get: async (p) => {
      const r = await request(app).get(p).set(...bearer(admin));
      return { status: r.status, body: r.body };
    },
    sql: async (text, params = []) => (await c.query(text, params)).rows,
  };
}

/** A database with history on every measure: an assigned case, a decided case with an undertaking (reminders, overdue, escalations), a BLOCKED decision. */
async function populate(): Promise<void> {
  const college = await userByEmail('college.abc@demo.in');
  await submitApp(app, college);
  const id = await toDecision(app, college);
  await decideWithConditions(app, id, [{ condition: 'Submit fire NOC', dueInDays: 10 }]);
  for (let i = 0; i < 25; i++) {
    shiftDays(1);
    await runEngineCycle({ source: 'test' });
  }
  const today = clock.today();
  for (const u of await prisma.user.findMany({ where: { role: { in: ['OFFICER', 'BUREAU'] } } })) {
    await prisma.officerAvailability.create({ data: { userId: u.id, kind: 'LEAVE', startsOn: today, endsOn: addDays(today, 5), reason: 'Leave', createdById: u.id } });
  }
  await submitApp(app, college, { type: 'NAME_CHANGE' }); // nobody is available: a BLOCKED trace
}

afterEach(async () => {
  await db?.end().catch(() => undefined);
  db = null;
});

describe('evidence:verify (independent SQL ground truth)', () => {
  beforeAll(() => {
    expect(process.env.DATABASE_URL).toMatch(/aicte_test/); // never the dev database
  });

  it('1. on a populated database every API number agrees with the independent SQL, in all four windows', async () => {
    await resetDb();
    await populate();
    const report = await runVerification(await io());
    if (!report.ok) console.log(formatTable(report.failures));
    expect(report.failures).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.windows.map((w) => w.label)).toEqual(['all', 'last30d', '1day', 'empty']);
    // The data really exercises the measures (an all-zero database would agree trivially).
    const val = (window: string, measure: RegExp) => report.checks.find((c) => c.window === window && measure.test(c.measure));
    expect(Number(val('all', /^alerts total/)?.sql)).toBeGreaterThan(10);
    expect(Number(val('all', /funnel reached: DECIDED/)?.sql)).toBeGreaterThan(0);
    expect(Number(val('all', /trace coverage: blockedCount/)?.sql)).toBeGreaterThan(0);
    expect(Number(val('all', /trace coverage: tracedCount/)?.sql)).toBeGreaterThan(0);
    expect(Number(val('all', /reminderTiming/)?.sql.split('/')[0])).toBeGreaterThan(0);
    // Windows must change the numbers, and they must change them in every related measure.
    const narrow = report.checks.filter((c) => c.window === '1day' && /^alerts total|alertsCreated by runs|audit events total/.test(c.measure));
    expect(narrow.length).toBe(4);
    expect(Number(val('1day', /^alerts total/)?.sql)).toBeLessThan(Number(val('all', /^alerts total/)?.sql));
    expect(Number(val('1day', /engine runs: runCount/)?.sql)).toBeLessThan(Number(val('all', /engine runs: runCount/)?.sql));
    expect(Number(val('1day', /audit events total/)?.sql)).toBeLessThan(Number(val('all', /audit events total/)?.sql));
    // Empty window: a genuine zero where the engine has run, null where nothing was measured.
    expect(val('empty', /^alerts total/)?.api).toBe('0');
    expect(val('empty', /engine runs: alertsCreated/)?.api).toBe('null');
    expect(val('empty', /processing: median/)?.api).toBe('null');
    expect(val('empty', /alerts suppressed/)?.api).toBe('null');
    // ML: precision stored 0.975 equals TP/(TP+FP) recomputed from the confusion matrix.
    const ml = val('all', /ML hybrid precision: stored \(served\)/);
    expect(ml?.api).toBe('0.975');
    expect(ml?.sql).toBe('0.975');
    expect(val('all', /ML confusion matrix/)?.api).toBe('TP=863 FN=137 FP=22 TN=978');
  });

  it('2. an empty database (no engine run ever) agrees and reports null, not zero, for alerts', async () => {
    await resetDb();
    const report = await runVerification(await io());
    expect(report.failures).toEqual([]);
    expect(report.checks.find((c) => c.window === 'all' && /^alerts total/.test(c.measure))?.api).toBe('null');
  });

  it('3. fails when an AlertLog row appears after the API side was computed', async () => {
    await resetDb();
    await populate();
    const report = await runVerification(await io(), {
      afterApi: async (w) => {
        if (w === 'all') await prisma.alertLog.create({ data: { itemId: 9_999_999n, kind: 'OVERDUE', offsetOrLevel: 0, triggerDate: clock.today(), late: false, createdAt: clock.now() } });
      },
    });
    expect(report.ok).toBe(false);
    const bad = report.failures.map((f) => f.measure);
    expect(bad.some((m) => /^alerts total/.test(m))).toBe(true);
    expect(report.failures.every((f) => f.window === 'all' || f.window === 'last30d' || f.window === '1day')).toBe(true); // the empty window is untouched
  });

  it('4. fails when an AssignmentTrace row is deleted after the API side was computed', async () => {
    await resetDb();
    await populate();
    const report = await runVerification(await io(), {
      afterApi: async (w) => {
        if (w === 'all') await prisma.$executeRaw`DELETE FROM "AssignmentTrace" WHERE id = (SELECT max(id) FROM "AssignmentTrace" WHERE "assignmentId" IS NOT NULL)`;
      },
    });
    expect(report.ok).toBe(false);
    expect(report.failures.map((f) => f.measure).some((m) => /trace coverage: tracedCount|recentDecisions|decision outcomes/.test(m))).toBe(true);
  });

  it('5. fails when one reported API number is perturbed (injected), and only that measure disagrees', async () => {
    await resetDb();
    await populate();
    const report = await runVerification(await io(), {
      mutateApi: (w, endpoint, body) => {
        if (w === 'all' && endpoint === '/assignment') body.data.spread.stdDev += 0.01;
      },
    });
    expect(report.ok).toBe(false);
    expect(report.failures.map((f) => `${f.window}:${f.measure}`)).toEqual([expect.stringMatching(/^all:utilisation stdDev/)]);
  });

  it('6. a perturbed ML precision is caught by the confusion-matrix recomputation', async () => {
    await resetDb();
    const report = await runVerification(await io(), {
      mutateApi: (_w, endpoint, body) => {
        if (endpoint === '/artifacts') for (const a of body.artifacts) if (a.name === 'formcheck/metrics.json') a.data.modes['Hybrid (rules or model)'].precision = 0.89;
      },
    });
    expect(report.ok).toBe(false);
    expect(report.failures.some((f) => /ML hybrid precision/.test(f.measure))).toBe(true);
  });

  it('7. the SQL session is read-only, and describeDatabase names host:port/database without the password', async () => {
    await resetDb();
    const v = await io();
    await expect(v.sql(`INSERT INTO "Holiday" ("date", "name") VALUES ('2030-01-01', 'x')`)).rejects.toThrow(/read-only/i);
    const info = await describeDatabase(process.env.DATABASE_URL, v.sql);
    expect(info.database).toBe('aicte_test');
    expect(info.host).toBeTruthy();
    expect(info.port).toMatch(/^\d+$/);
    expect(JSON.stringify(info)).not.toContain('app_pw');
    expect(Object.keys(info.counts)).toContain('AlertLog');
  });
});
