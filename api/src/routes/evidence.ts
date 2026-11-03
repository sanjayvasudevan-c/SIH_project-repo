import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/db.js';
import { h, parse } from '../lib/http.js';
import { verifyChains } from '../lib/audit.js';
import { HttpError } from '../lib/errors.js';
import { requireRole } from '../policy/roles.js';
import { headCommit, readArtifacts, readTestResult, sameCommit } from './evidence/artifacts.js';

const none = z.object({});
const runsQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  status: z.enum(['RUNNING', 'OK', 'FAILED']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
const traceParams = z.object({ applicationId: z.string().min(1).max(64) });

export function evidenceRouter(): Router {
  const r = Router();
  const adminOnly = requireRole('ADMIN');
  // A refusal carries the same code as the ACCESS_DENIED audit row, and no data.
  r.use((req, res, next) =>
    adminOnly(req, res, (e?: unknown) => {
      if (e instanceof HttpError && e.status === 403) e.code = 'ACCESS_DENIED';
      next(e);
    }),
  );

  // Reads a stored verdict. PASS/FAIL only when a current artifact recorded it; absent -> NOT_VERIFIED; other commit -> STALE.
  r.get(
    '/summary',
    h(async (req, res) => {
      parse(none, req.query);
      const [head, art, last] = await Promise.all([headCommit(), readTestResult(), prisma.engineRun.findFirst({ orderBy: { id: 'desc' } })]);
      const status = !art ? 'NOT_VERIFIED' : head && sameCommit(art.commit, head) ? art.status : 'STALE';
      res.json({
        status,
        commit: head,
        artifactCommit: art?.commit ?? null,
        checks: art && status !== 'STALE' ? { passed: art.passed, failed: art.failed, notVerified: art.notVerified ?? null } : { passed: null, failed: null, notVerified: null },
        lastRunAt: art?.runAt ?? null,
        scheduler: { lastRunAt: last?.startedAt.toISOString() ?? null, lastStatus: last?.status ?? null, lastDurationMs: last?.durationMs ?? null },
        provenance: art ? 'MEASURED' : null,
      });
    }),
  );

  r.get(
    '/engine-runs',
    h(async (req, res) => {
      const q = parse(runsQuery, req.query);
      const where: Prisma.EngineRunWhereInput = {};
      if (q.status) where.status = q.status;
      if (q.from || q.to) where.startedAt = { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) };
      const [total, rows] = await Promise.all([
        prisma.engineRun.count({ where }),
        prisma.engineRun.findMany({ where, orderBy: { id: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      ]);
      res.json({
        total,
        page: q.page,
        pageSize: q.pageSize,
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
        coverage: { tracedCount: assignments.filter((a) => traced.has(a.id)).length, assignmentTotal: assignments.length },
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

  return r;
}
