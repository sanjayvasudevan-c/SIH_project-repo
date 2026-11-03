// Evidence Center aggregates. Each function returns { definition, provenance, data } from ONE set of queries, so a card and
// the chart under it cannot disagree. `definition` is shown to the reader verbatim: numerator, denominator, window, exclusions.
// Rules held here: absent is null (never 0); no back-fill; every window bound applies to every measure in the response.
import { Prisma, Status } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/db.js';
import { verifyChains } from '../../lib/audit.js';
import * as clock from '../../lib/clock.js';
import { addDays, isoDate, parseDateOnly } from '../../lib/dates.js';
import { loadHolidays, workingDaysBetween } from '../../lib/workdays.js';
import { COMPLIANCE, daysToDueOf } from '../../engine/cycle.js';
import { newestRules, rulesForApp } from '../../rules/service.js';
import type { Provenance } from './artifacts.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional();
const ordered = { message: 'from must not be after to', path: ['from'] };
const notBackwards = (v: { from?: string; to?: string }) => !v.from || !v.to || v.from <= v.to; // an inverted window is a mistake, not an empty answer
export const windowQuery = z.object({ from: day, to: day }).refine(notBackwards, ordered);
export const auditQuery = z
  .object({
    from: day,
    to: day,
    actor: z.string().regex(/^[A-Z_]{1,32}$/).optional(),
    action: z.string().regex(/^[A-Z_]{1,48}$/).optional(),
    entity: z.enum(['APPLICATION', 'RULE_PACK', 'SYSTEM']).optional(),
  })
  .refine(notBackwards, ordered);
export type Q = z.infer<typeof windowQuery>;

/** Both bounds are whole UTC days; `to` is inclusive, so the SQL bound is the start of the next day. */
export function bounds(q: Q) {
  const from = q.from ? parseDateOnly(q.from) : null;
  const toIncl = q.to ? parseDateOnly(q.to) : null;
  const toExcl = toIncl ? addDays(toIncl, 1) : null;
  return {
    from,
    toExcl,
    window: { from: q.from ?? null, to: q.to ?? null },
    /** `AND col >= from AND col < to+1` (empty when unbounded). Strings cast to timestamp avoid any time-zone shift. */
    sql: (col: Prisma.Sql): Prisma.Sql =>
      Prisma.sql`${from ? Prisma.sql`AND ${col} >= ${isoDate(from)}::timestamp` : Prisma.empty} ${toExcl ? Prisma.sql`AND ${col} < ${isoDate(toExcl)}::timestamp` : Prisma.empty}`,
  };
}

export const SCOPE =
  'Every number is counted from the live rows in this system\'s database. In this demo those rows include records made by the seed script and by simulated-clock runs, so the figures describe this deployment, not AICTE\'s real caseload.';
const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const share = (n: number, d: number): number | null => (d > 0 ? n / d : null);
export type Counted = { k: string; n: number };

const STAGES = [
  { stage: 'SUBMITTED', label: 'Submitted' },
  { stage: 'SCRUTINY', label: 'Scrutiny' },
  { stage: 'EVC', label: 'Expert visit committee' },
  { stage: 'SAC_SHC', label: 'SAC/SHC' },
  { stage: 'DECISION', label: 'Awaiting decision' },
  { stage: 'DECIDED', label: 'Decided' },
] as const;

// ---------------------------------------------------------------------------------------------------------------- workflow
export async function workflow(q: Q) {
  const b = bounds(q);
  await loadHolidays(prisma); // working-day arithmetic uses the current holiday calendar
  // The cohort: applications SUBMITTED in the window. Every measure below is about this one set.
  const cohort = Prisma.sql`FROM "Application" a WHERE TRUE ${b.sql(Prisma.sql`a."submittedAt"`)}`;
  const [statusRows, stageRows, routeRows, decisions, volume] = await Promise.all([
    prisma.$queryRaw<Counted[]>`SELECT a.status::text AS k, count(*)::int AS n ${cohort} GROUP BY 1`,
    // A case "reached" a stage if any audited action left it in that stage (SUBMIT puts it in the first stage, COMPLETE_STAGE /
    // FORWARD_SAC_SHC / REVERT move it). DECIDE is the decision itself. Distinct cases, so a return-and-resubmit counts once.
    prisma.$queryRaw<Counted[]>`
      SELECT x.k, count(DISTINCT x.id)::int AS n FROM (
        SELECT a.id, l."toState"->>'stage' AS k FROM "Application" a JOIN "AuditLog" l ON l."applicationId" = a.id
          WHERE jsonb_typeof(l."toState") = 'object' ${b.sql(Prisma.sql`a."submittedAt"`)}
        UNION ALL
        SELECT a.id, 'DECIDED' FROM "Application" a JOIN "AuditLog" l ON l."applicationId" = a.id AND l.action = 'DECIDE'
          WHERE TRUE ${b.sql(Prisma.sql`a."submittedAt"`)}
      ) x GROUP BY 1`,
    // Cases whose route includes the stage at all: a stage not on a case's route can never be reached by it.
    prisma.$queryRaw<Counted[]>`SELECT st AS k, count(*)::int AS n FROM "Application" a CROSS JOIN unnest(ARRAY['SCRUTINY','EVC','SAC_SHC','DECISION']) st
      WHERE a.route @> to_jsonb(st) ${b.sql(Prisma.sql`a."submittedAt"`)} GROUP BY 1`,
    prisma.$queryRaw<{ submittedAt: Date; decidedAt: Date }[]>`
      SELECT a."submittedAt", min(l."at") AS "decidedAt" FROM "Application" a JOIN "AuditLog" l ON l."applicationId" = a.id AND l.action = 'DECIDE'
      WHERE TRUE ${b.sql(Prisma.sql`a."submittedAt"`)} GROUP BY a.id`,
    // Per-day events of the cohort. Days with no event are absent from the result (not zero-filled).
    prisma.$queryRaw<{ d: string; k: string; n: number }[]>`
      SELECT d, k, count(*)::int AS n FROM (
        SELECT a."submittedAt"::date::text AS d, 'submitted' AS k ${cohort}
        UNION ALL SELECT l."at"::date::text, 'decided' FROM "Application" a JOIN "AuditLog" l ON l."applicationId" = a.id AND l.action = 'DECIDE'
          WHERE TRUE ${b.sql(Prisma.sql`a."submittedAt"`)}
        UNION ALL SELECT i."dueDate"::date::text, 'overdue' FROM "AlertLog" g JOIN "DeadlineItem" i ON i.id = g."itemId" JOIN "Application" a ON a.id = i."applicationId"
          WHERE g.kind = 'OVERDUE' ${b.sql(Prisma.sql`a."submittedAt"`)}
      ) e GROUP BY d, k`,
  ]);
  const n = (rows: Counted[], k: string) => rows.find((r) => r.k === k)?.n ?? 0;
  const submittedTotal = statusRows.reduce((s, r) => s + r.n, 0);
  const funnel = STAGES.map(({ stage, label }) => {
    const reached = stage === 'SUBMITTED' ? submittedTotal : n(stageRows, stage);
    const onRoute = stage === 'SUBMITTED' || stage === 'DECIDED' ? submittedTotal : n(routeRows, stage);
    return { stage, label, reached, onRoute, share: share(reached, submittedTotal) };
  });
  const days = decisions.map((d) => workingDaysBetween(d.submittedAt, d.decidedAt));
  const series = new Map<string, { day: string; submitted: number; decided: number; overdue: number }>();
  for (const v of volume) {
    const row = series.get(v.d) ?? { day: v.d, submitted: 0, decided: 0, overdue: 0 };
    (row as Record<string, number | string>)[v.k] = v.n;
    series.set(v.d, row);
  }
  const provenance: Record<string, Provenance> = { funnel: 'MEASURED', funnelShare: 'DERIVED', statusDistribution: 'MEASURED', processingTime: 'DERIVED', volumeOverTime: 'MEASURED' };
  const definition = {
    scope: SCOPE,
    cohort: 'Every figure on this tab is about one group: the applications submitted between the From and To dates (inclusive; all dates if none given). Nothing outside that group is counted anywhere in this response.',
    funnel:
      'Number of distinct applications that have reached each stage, counted from the audit trail of stage moves (an application now decided still counts at every stage it passed through), not from its current status. "Decided" counts applications with a recorded decision. Share = applications reached / applications submitted in the window (the denominator, shown as submittedTotal); it is blank when nothing was submitted. A stage that is not on an application\'s route (onRoute shows how many are) cannot be reached by it, so shares below 100% are not drop-out.',
    statusDistribution: 'Number of applications in each current status. Denominator: applications submitted in the window; the counts add up to it.',
    processingTime:
      'Median working days from submission to decision (weekends and holidays excluded), over DECIDED applications only. Applications still in progress are not finished, so their processing time is not yet known (a censored sample): they are excluded from the median and reported separately as inFlightCount. decidedCount + inFlightCount = applications submitted in the window. No mean is given because averaging only the finished cases would understate the time cases take. Blank when no application in the window has been decided.',
    volumeOverTime:
      'Per calendar day, for applications submitted in the window: how many were submitted that day, how many were decided that day, and how many deadline items of those applications fell overdue that day (the engine\'s overdue alerts, by the item\'s due date). Starts at the first recorded event; days with no event are left out rather than shown as zero, and nothing is back-filled or interpolated. Overdue counts only items the deadline engine has raised an alert for. The overdue points are placed on the item\'s due date, which can fall outside the From/To dates (those dates select the applications, not the plotted days), so do not label the day axis with the From/To range.',
  };
  return {
    definition,
    provenance,
    data: {
      window: b.window,
      submittedTotal,
      funnel,
      statusDistribution: Object.values(Status).map((s) => ({ status: s, count: n(statusRows, s), share: share(n(statusRows, s), submittedTotal) })),
      processingTime: { decidedCount: days.length, inFlightCount: submittedTotal - days.length, medianWorkingDays: median(days), unit: 'working days' },
      volumeOverTime: [...series.values()].sort((x, y) => x.day.localeCompare(y.day)),
    },
  };
}

// ------------------------------------------------------------------------------------------------------------- assignment
/** Which causes can arithmetically account for a utilisation above the officer's normal cap. Only those are named. */
export function aboveCapText(name: string, util: number, cap: number, continuity: number, urgent: number): string {
  const at = `${name} is at ${util.toFixed(2)} of capacity against a normal cap of ${cap.toFixed(2)}.`;
  const causes: string[] = [];
  if (util <= continuity + 1e-9) causes.push(`the continuity allowance (portfolio or returning officer, ceiling ${continuity})`);
  if (util <= urgent + 1e-9) causes.push(`the urgent-task allowance (ceiling ${urgent})`);
  causes.push('capacity reduced after the work was assigned');
  const ruled = [util > continuity + 1e-9 ? `the continuity ceiling ${continuity}` : '', util > urgent + 1e-9 ? `the urgent-task ceiling ${urgent}` : ''].filter(Boolean);
  const lead = ruled.length ? ` ${util.toFixed(2)} is above ${ruled.join(' and ')}, so ${ruled.length === 2 ? 'neither allowance explains it' : 'that allowance cannot explain it'}.` : '';
  return `${at}${lead} This figure is consistent with: ${causes.join('; ')}. The decision table does not record which applied.`;
}
export async function assignment(q: Q) {
  const b = bounds(q);
  // Assignments made in the window (by assignedAt); traces by decidedAt. Open = not released.
  const [officers, cover, blocked, outcomes, cand, excl, versions, policy] = await Promise.all([
    // Current open book (never windowed) and, separately, the part of it assigned in the window. Only role OFFICER: committee and
    // bureau profiles do not hold assigned work the same way and would show as idle officers.
    prisma.$queryRaw<{ officerId: string; name: string; role: string; capacityPoints: number; maxUtil: number; openPoints: number; openTasks: number; openPointsAssignedInWindow: number }[]>`
      SELECT p."userId" AS "officerId", u.name, u.role::text AS role, p."capacityPoints"::float8 AS "capacityPoints", p."maxUtil"::float8 AS "maxUtil",
             COALESCE(SUM(a.weight), 0)::float8 AS "openPoints", count(a.id)::int AS "openTasks",
             COALESCE(SUM(a.weight) FILTER (WHERE TRUE ${b.sql(Prisma.sql`a."assignedAt"`)}), 0)::float8 AS "openPointsAssignedInWindow"
      FROM "OfficerProfile" p JOIN "User" u ON u.id = p."userId" AND u.role = 'OFFICER'
      LEFT JOIN "Assignment" a ON a."officerId" = p."userId" AND a."releasedAt" IS NULL
      GROUP BY p."userId", u.name, u.role, p."capacityPoints", p."maxUtil" ORDER BY u.name`,
    prisma.$queryRaw<{ total: number; traced: number }[]>`
      SELECT count(*)::int AS total, (count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "AssignmentTrace" t WHERE t."assignmentId" = a.id)))::int AS traced
      FROM "Assignment" a WHERE TRUE ${b.sql(Prisma.sql`a."assignedAt"`)}`,
    prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "AssignmentTrace" t WHERE t."assignmentId" IS NULL ${b.sql(Prisma.sql`t."decidedAt"`)}`,
    prisma.$queryRaw<Counted[]>`SELECT t.outcome AS k, count(*)::int AS n FROM "AssignmentTrace" t WHERE TRUE ${b.sql(Prisma.sql`t."decidedAt"`)} GROUP BY 1`,
    prisma.$queryRaw<{ considered: number; eligible: number }[]>`
      SELECT count(c)::int AS considered, (count(*) FILTER (WHERE (c->>'eligible')::boolean))::int AS eligible
      FROM "AssignmentTrace" t CROSS JOIN LATERAL jsonb_array_elements(t.candidates) c WHERE TRUE ${b.sql(Prisma.sql`t."decidedAt"`)}`,
    prisma.$queryRaw<Counted[]>`
      SELECT c->>'excludedBy' AS k, count(*)::int AS n FROM "AssignmentTrace" t CROSS JOIN LATERAL jsonb_array_elements(t.candidates) c
      WHERE c->>'excludedBy' IS NOT NULL ${b.sql(Prisma.sql`t."decidedAt"`)} GROUP BY 1`,
    prisma.$queryRaw<{ label: string; assignments: number }[]>`
      SELECT cy.code || ' v' || v.version AS label, count(*)::int AS assignments FROM "Assignment" a
      JOIN "RulePackVersion" v ON v.id = a."rulePackVersionId" JOIN "ApprovalCycle" cy ON cy.id = v."cycleId"
      WHERE TRUE ${b.sql(Prisma.sql`a."assignedAt"`)} GROUP BY 1 ORDER BY 1`,
    newestRules(),
  ]);
  // capacityPoints > 0 is enforced by the database (officer_capacity_positive), so every listed officer has a utilisation.
  const rows = officers.map((o) => ({ ...o, utilisation: o.openPoints / o.capacityPoints }));
  const u = rows.map((r) => r.utilisation);
  const mean = u.length ? u.reduce((s, x) => s + x, 0) / u.length : null;
  const stdDev = u.length >= 2 && mean !== null ? Math.sqrt(u.reduce((s, x) => s + (x - mean) ** 2, 0) / u.length) : null;
  const capFor = policy.content.assignment;
  // Above-cap officers are read from current state: the trace records the projected load but not the cap, and capacity can change later.
  const ov = rows.filter((r) => r.utilisation > r.maxUtil + 1e-9);
  return {
    definition: {
      scope: SCOPE,
      window: 'The From/To dates narrow coverage (assignments made in the window), candidate and outcome counts (decisions recorded in the window), the rule-pack list and openPointsAssignedInWindow. They deliberately do NOT change officer utilisation, the spread or the above-cap list: those always describe the current open book, because utilisation against a capacity means nothing for one period\'s intake.',
      officers:
        'Only users with the OFFICER role are listed (committee and bureau profiles are excluded). Per officer: capacityPoints (configured capacity), openPoints (sum of the weight of all their open, unreleased assignments, now) and utilisation = openPoints / capacityPoints, DERIVED from those two measured values. openPointsAssignedInWindow is the part of openPoints from assignments made in the From/To window.',
      spread:
        `Standard deviation (population form) of current utilisation across users with the OFFICER role and capacityPoints > 0 (committee and bureau profiles are excluded). The denominator is officerCount, the number of officers counted. Not affected by the date window. Blank when fewer than 2 officers qualify. It describes how load is spread, not whether it is right: the assignment policy in rule pack ${policy.label} defines what a correct distribution is, and equal counts are not the goal.`,
      coverage:
        'tracedCount / assignmentTotal: assignments made in the window that have a recorded decision table (trace), over all assignments made in the window. Traces are written when the engine assigns automatically; a manual assignment or manual reassignment writes none, so coverage is partial and a case without a trace is not an error. blockedCount is decisions where no officer could be assigned (no assignment exists for them).',
      candidates: 'Over decisions recorded in the window: candidatesConsidered = officers evaluated across all decisions; eligible = those eligible; excluded counts the stated reason. A decision evaluates several officers, so these are candidate rows, not cases.',
      continuityOverrides: `Officers whose current utilisation is above their own normal cap (maxUtil). This is expected, not an error, when it comes from the continuity allowance (portfolio or returning officer, up to ${capFor.continuityUtilCap}), the urgent-task allowance (up to ${capFor.urgentMaxUtil}) or capacity reduced after the work was assigned. The decision table does not record which applied, so all three are named. Not affected by the date window.`,
    },
    provenance: { officers: 'MEASURED', utilisation: 'DERIVED', spread: 'DERIVED', coverage: 'MEASURED', candidates: 'MEASURED', continuityOverrides: 'DERIVED' } as Record<string, Provenance>,
    data: {
      window: b.window,
      officers: rows,
      spread: { officerCount: u.length, meanUtilisation: mean, stdDev },
      coverage: { tracedCount: cover[0]?.traced ?? 0, assignmentTotal: cover[0]?.total ?? 0, blockedCount: blocked[0]?.n ?? 0 },
      outcomes: outcomes.map((o) => ({ outcome: o.k, count: o.n })),
      candidates: { candidatesConsidered: cand[0]?.considered ?? 0, eligible: cand[0]?.eligible ?? 0, excluded: excl.map((e) => ({ reason: e.k, count: e.n })) },
      continuityOverrides: {
        count: ov.length,
        continuityUtilCap: capFor.continuityUtilCap,
        urgentMaxUtil: capFor.urgentMaxUtil,
        rows: ov.map((o) => ({
          officerId: o.officerId,
          officer: o.name,
          utilisation: o.utilisation,
          normalCap: o.maxUtil,
          text: aboveCapText(o.name, o.utilisation, o.maxUtil, capFor.continuityUtilCap, capFor.urgentMaxUtil),
        })),
      },
      rulePackVersions: versions,
      policy: { label: policy.label },
    },
  };
}

// ------------------------------------------------------------------------------------------------------------- compliance
export async function compliance(q: Q) {
  const b = bounds(q);
  const today = clock.today();
  const dueWhere = { ...(b.from ? { gte: b.from } : {}), ...(b.toExcl ? { lt: b.toExcl } : {}) };
  const [items, statusCounts, byKind, byLate, byLevel, runs] = await Promise.all([
    prisma.deadlineItem.findMany({
      where: { status: 'OPEN', dueDate: dueWhere },
      select: { type: true, dueDate: true, unit: true, totalDays: true, application: { select: { cycleId: true, rulePackVersionId: true } } },
    }),
    prisma.deadlineItem.groupBy({ by: ['status'], where: { dueDate: dueWhere }, _count: { _all: true } }),
    prisma.$queryRaw<Counted[]>`SELECT g.kind AS k, count(*)::int AS n FROM "AlertLog" g WHERE TRUE ${b.sql(Prisma.sql`g."createdAt"`)} GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ late: boolean; n: number }[]>`SELECT g.late, count(*)::int AS n FROM "AlertLog" g WHERE TRUE ${b.sql(Prisma.sql`g."createdAt"`)} GROUP BY 1`,
    prisma.$queryRaw<{ level: number; n: number }[]>`SELECT g."offsetOrLevel" AS level, count(*)::int AS n FROM "AlertLog" g WHERE g.kind = 'ESCALATION' ${b.sql(Prisma.sql`g."createdAt"`)} GROUP BY 1`,
    prisma.engineRun.aggregate({
      where: { startedAt: { ...(b.from ? { gte: b.from } : {}), ...(b.toExcl ? { lt: b.toExcl } : {}) } },
      _sum: { alertsSuppressed: true },
      _count: { _all: true },
    }),
  ]);
  // The engine's own tests, per open item (api/src/engine/cycle.ts processItem): d = days to due, in the item's unit.
  const c = { overdue: 0, atRisk: 0, dueSoon: 0, onTrack: 0 };
  for (const it of items) {
    const r = await rulesForApp(it.application);
    const d = daysToDueOf(it, today);
    if (d < 0) c.overdue++;
    else if (!COMPLIANCE.includes(it.type) && it.totalDays && (it.totalDays - d) / it.totalDays >= r.reminders.atRiskPct / 100) c.atRisk++;
    else if (COMPLIANCE.includes(it.type) && d <= Math.max(...r.reminders.complianceOffsets)) c.dueSoon++;
    else c.onTrack++;
  }
  const status = (s: string) => statusCounts.find((x) => x.status === s)?._count._all ?? 0;
  const late = (v: boolean) => byLate.find((x) => x.late === v)?.n ?? 0;
  const total = byKind.reduce((s, k) => s + k.n, 0);
  const rules = await newestRules();
  return {
    definition: {
      scope: SCOPE,
      window: 'Deadline items are selected by their due date in the window; alerts by the date the engine raised them; engine runs by their start time. The same From/To applies to all of them (inclusive; all dates if none given).',
      deadlines: {
        asOf: `Evaluated on the system's current date (${isoDate(today)}), the same date the deadline engine uses. Denominator for every state: openTotal, the open (not paused, met, missed or closed) deadline items due in the window; the four states add up to it.`,
        overdue: 'Open item whose due date has passed: days remaining < 0, counted in working days for stage deadlines (weekends and holidays skipped) and calendar days for undertakings and document expiries. This is the engine\'s own test for raising an overdue alert.',
        atRisk: `Open stage-type item (stage, EVC scheduling, EVC report, evidence verification) not yet overdue where the share of its allowed working days already used is at least ${rules.reminders.atRiskPct}% (the at-risk threshold in rule pack ${rules.label}). Used = (allowed days - days remaining) / allowed days. Same test as the engine's at-risk alert.`,
        dueSoon: `Open undertaking or document-expiry item, not overdue, that is within ${Math.max(...rules.reminders.complianceOffsets)} calendar days of its due date (the earliest reminder point in rule pack ${rules.label}).`,
        onTrack: 'Open items that are none of the above.',
        met: 'Items closed as met on time. Shown for items due in the window; not part of openTotal. missed, paused and closed are likewise counted but outside the open total.',
      },
      escalations: `Escalation alerts raised in the window, by level. Level 1, 2 and 3 are raised when an item is ${rules.escalation.thresholds.join(" / ")} days overdue (working days for stage deadlines, calendar days for undertakings and document expiries). Each level is raised once per item.`,
      alerts:
        'total = alerts logged in the window (by kind, and by late = a reminder raised after its reminder date had already passed by more than one day, because the engine had not run in time). suppressed = duplicate alerts the engine declined to create, summed from engine run records in the window. The log\'s unique key (item, kind, level) is why a repeated cycle creates no second alert; this build has no external delivery channel. Suppressed is blank when no engine run started in the window; with engineRunCount 0, the alert and escalation totals mean "none recorded", not "measured as zero".',
    },
    provenance: { deadlines: 'DERIVED', escalations: 'MEASURED', alerts: 'MEASURED', suppressed: 'MEASURED' } as Record<string, Provenance>,
    data: {
      window: b.window,
      asOf: isoDate(today),
      deadlines: { openTotal: items.length, ...c, met: status('MET'), missed: status('MISSED'), paused: status('PAUSED'), closed: status('CLOSED') },
      escalations: [1, 2, 3].map((level) => ({ level, count: byLevel.find((x) => x.level === level)?.n ?? 0 })),
      alerts: {
        total,
        byKind: byKind.map((k) => ({ kind: k.k, count: k.n })),
        byLate: { late: late(true), onTime: late(false) },
        suppressed: runs._count._all > 0 ? (runs._sum.alertsSuppressed ?? 0) : null,
        engineRunCount: runs._count._all,
      },
    },
  };
}

// ------------------------------------------------------------------------------------------------------------ audit analytics
export async function auditAnalytics(q: z.infer<typeof auditQuery>) {
  const b = bounds(q);
  const entityExpr = Prisma.sql`(CASE WHEN l."applicationId" IS NOT NULL THEN 'APPLICATION' WHEN l."chainKey" = 'rules' THEN 'RULE_PACK' ELSE 'SYSTEM' END)`;
  const where = Prisma.sql`WHERE TRUE ${b.sql(Prisma.sql`l."at"`)} ${q.actor ? Prisma.sql`AND l."actorRole" = ${q.actor}` : Prisma.empty} ${q.action ? Prisma.sql`AND l.action = ${q.action}` : Prisma.empty} ${q.entity ? Prisma.sql`AND ${entityExpr} = ${q.entity}` : Prisma.empty}`;
  const [byRole, byAction, byEntity, integrity] = await Promise.all([
    prisma.$queryRaw<Counted[]>`SELECT l."actorRole" AS k, count(*)::int AS n FROM "AuditLog" l ${where} GROUP BY 1 ORDER BY 2 DESC, 1`,
    prisma.$queryRaw<Counted[]>`SELECT l.action AS k, count(*)::int AS n FROM "AuditLog" l ${where} GROUP BY 1 ORDER BY 2 DESC, 1`,
    prisma.$queryRaw<Counted[]>`SELECT ${entityExpr} AS k, count(*)::int AS n FROM "AuditLog" l ${where} GROUP BY 1 ORDER BY 2 DESC, 1`,
    verifyChains(),
  ]);
  return {
    definition: {
      scope: SCOPE,
      events: 'Number of audit-log events matching the filters (From/To on the event time, inclusive; actor = the role that acted; action; entity). Each event is counted once in each of byActorRole, byAction and byEntity, so each breakdown adds up to total. Entity: APPLICATION = an event on a case, RULE_PACK = a rule-pack change, SYSTEM = anything else (sign-ins, clock changes, demo resets). Only counts are returned; no case content is exposed here.',
      integrity:
        'Recomputed now over the WHOLE audit log, not just the filtered events: each chain\'s hashes are re-derived and compared with the stored links, so an edited event or a broken link in a chain is reported. ok = no chain failed. It reports damage after the fact; it does not prevent anyone with database access from changing rows.',
    },
    provenance: { events: 'MEASURED', integrity: 'LIVE_DEMO' } as Record<string, Provenance>,
    data: {
      window: b.window,
      filters: { actor: q.actor ?? null, action: q.action ?? null, entity: q.entity ?? null },
      total: byAction.reduce((s, r) => s + r.n, 0),
      byActorRole: byRole.map((r) => ({ actorRole: r.k, count: r.n })),
      byAction: byAction.map((r) => ({ action: r.k, count: r.n })),
      byEntity: byEntity.map((r) => ({ entity: r.k, count: r.n })),
      integrity: { ok: integrity.ok, chainsChecked: integrity.chainsChecked, rowsChecked: integrity.rowsChecked, brokenChainCount: integrity.brokenChains.length, scope: 'WHOLE_LOG' },
    },
  };
}
