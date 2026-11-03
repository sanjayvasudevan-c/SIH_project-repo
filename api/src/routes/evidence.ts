import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/db.js';
import { h, parse } from '../lib/http.js';
import { verifyChains } from '../lib/audit.js';
import * as clock from '../lib/clock.js';
import { requireRole } from '../policy/roles.js';
import { alerts } from './evidence/alerts.js';
import { parseDateOnly } from '../lib/dates.js';
import { auditAnalytics, auditQuery, assignment, compliance, windowQuery, workflow } from './evidence/aggregates.js';
import { headCommit, readArtifacts, readTestResult, commitIsCurrent } from './evidence/artifacts.js';

const none = z.object({});
const runsQuery0 = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
  status: z.enum(['RUNNING', 'OK', 'FAILED']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
const runsQuery = runsQuery0.refine((v) => !v.from || !v.to || v.from <= v.to, { message: 'from must not be after to', path: ['from'] });
/** A run still RUNNING after this long was killed (hard kill, serverless freeze, out of memory) and can never finish by itself. */
export const ABANDONED_AFTER_MS = 15 * 60_000;
const traceParams = z.object({ applicationId: z.string().min(1).max(64) });

export function evidenceRouter(): Router {
  const r = Router();
  r.use(requireRole('ADMIN'));

  // Reads a stored verdict. PASS/FAIL only when a current artifact recorded it; absent -> NOT_VERIFIED; other commit -> STALE.
  r.get(
    '/summary',
    h(async (req, res) => {
      parse(none, req.query);
      const [head, art, last] = await Promise.all([headCommit(), readTestResult(), prisma.engineRun.findFirst({ orderBy: { id: 'desc' } })]);
      // A clean PASS needs a current artifact that recorded PASS with nothing left unverified.
      const current = !!art && !!head && commitIsCurrent(art.commit, head);
      const unverified = art && art.notVerified ? art.notVerified : 0;
      const status = !art ? 'NOT_VERIFIED' : !current ? 'STALE' : art.status === 'PASS' && unverified > 0 ? 'NOT_VERIFIED' : art.status;
      res.json({
        status,
        commit: head,
        headUnresolved: head === null,
        artifactCommit: art?.commit ?? null,
        detail: status === 'NOT_VERIFIED' && art && current ? `${unverified} checks recorded as not verified; not a clean pass` : null,
        checks: art && current ? { passed: art.passed, failed: art.failed, notVerified: art.notVerified ?? null } : { passed: null, failed: null, notVerified: null },
        lastRunAt: art && current ? art.runAt ?? null : null,
        scheduler: { lastRunAt: last?.startedAt.toISOString() ?? null, lastStatus: last?.status ?? null, lastDurationMs: last?.durationMs ?? null },
        provenance: art && current ? 'MEASURED' : null,
      });
    }),
  );

  r.get(
    '/engine-runs',
    h(async (req, res) => {
      const q = parse(runsQuery, req.query);
      const where: Prisma.EngineRunWhereInput = {};
      if (q.status) where.status = q.status;
      // The window is the date the engine treated as "today" (simulatedToday, a DATE): the same clock as alerts, deadlines and
      // applications. Inclusive on both ends, so a run made today is inside from=to=today. startedAt stays a displayed column.
      if (q.from || q.to) where.simulatedToday = { ...(q.from ? { gte: parseDateOnly(q.from) } : {}), ...(q.to ? { lte: parseDateOnly(q.to) } : {}) };
      // Totals use the SAME filters as the rows, in one query, so they never depend on which page was asked for.
      const ts = (d: Date) => Prisma.sql`${d.toISOString()}::timestamp`; // ISO UTC text cast to timestamp: no session time-zone shift
      const cond = Prisma.sql`WHERE TRUE ${q.status ? Prisma.sql`AND status::text = ${q.status}` : Prisma.empty} ${q.from ? Prisma.sql`AND "simulatedToday" >= ${q.from}::date` : Prisma.empty} ${q.to ? Prisma.sql`AND "simulatedToday" <= ${q.to}::date` : Prisma.empty}`;
      const staleBefore = ts(new Date(clock.realNow().getTime() - ABANDONED_AFTER_MS));
      const [total, rows, sums] = await Promise.all([
        prisma.engineRun.count({ where }),
        prisma.engineRun.findMany({ where, orderBy: { id: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
        prisma.$queryRaw<{ runCount: number; failedCount: number; abandonedCount: number; alertsCreated: number | null; alertsSuppressed: number | null }[]>`
          SELECT count(*)::int AS "runCount",
                 (count(*) FILTER (WHERE status = 'FAILED'))::int AS "failedCount",
                 -- Abandonment is a real-time fact, so it is counted over ALL runs, whatever the date window or status filter says.
                 (SELECT count(*) FROM "EngineRun" WHERE status = 'RUNNING' AND "startedAt" < ${staleBefore})::int AS "abandonedCount",
                 SUM("alertsCreated")::int AS "alertsCreated", SUM("alertsSuppressed")::int AS "alertsSuppressed"
          FROM "EngineRun" ${cond}`,
      ]);
      res.json({
        total,
        page: q.page,
        pageSize: q.pageSize,
        totals: sums[0]!, // SUM over zero rows is NULL: "no runs" is not reported as 0 alerts
        rows: rows.map((e) => ({
          ...e,
          id: e.id.toString(),
          startedAt: e.startedAt.toISOString(),
          finishedAt: e.finishedAt?.toISOString() ?? null,
          simulatedToday: e.simulatedToday.toISOString().slice(0, 10),
        })),
      });
    }),
  );

  // Traces exist only for automatic assignment; manual (re)assignment writes none, so coverage is part of the answer.
  r.get(
    '/assignment-trace/:applicationId',
    h(async (req, res) => {
      const { applicationId } = parse(traceParams, req.params);
      const [traces, assignments] = await Promise.all([
        prisma.assignmentTrace.findMany({ where: { applicationId }, orderBy: { id: 'asc' } }),
        prisma.assignment.findMany({ where: { applicationId }, select: { id: true } }),
      ]);
      const traced = new Set(traces.map((t) => t.assignmentId).filter((x): x is string => !!x));
      res.json({
        rows: traces.map((t) => ({ ...t, id: t.id.toString(), decidedAt: t.decidedAt.toISOString() })),
        // tracedCount: assignments with at least one trace, over assignmentTotal. rows can outnumber it: BLOCKED traces
        // have no assignment (blockedCount) and one assignment may have several. An unknown application is 200 with 0/0.
        coverage: {
          tracedCount: assignments.filter((a) => traced.has(a.id)).length,
          assignmentTotal: assignments.length,
          blockedCount: traces.filter((t) => !t.assignmentId).length,
        },
      });
    }),
  );

  r.get(
    '/audit-integrity',
    h(async (req, res) => {
      parse(none, req.query);
      res.json({ ...(await verifyChains()), provenance: 'LIVE_DEMO' });
    }),
  );

  r.get(
    '/artifacts',
    h(async (req, res) => {
      parse(none, req.query);
      res.json({ artifacts: await readArtifacts() });
    }),
  );

  // Aggregates: each returns { definition, provenance, data } from one set of queries (see evidence/aggregates.ts).
  r.get('/workflow', h(async (req, res) => res.json(await workflow(parse(windowQuery, req.query)))));
  r.get('/assignment', h(async (req, res) => res.json(await assignment(parse(windowQuery, req.query)))));
  r.get('/compliance', h(async (req, res) => res.json(await compliance(parse(windowQuery, req.query)))));
  r.get('/alerts', h(async (req, res) => res.json(await alerts(parse(windowQuery, req.query)))));
  r.get('/audit-analytics', h(async (req, res) => res.json(await auditAnalytics(parse(auditQuery, req.query)))));

  return r;
}
