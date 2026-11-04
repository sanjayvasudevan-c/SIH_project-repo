// Independent verification of the Evidence Center aggregates.
//
// Every headline number the /api/evidence endpoints return is recomputed here with FRESH raw SQL written directly against the
// tables (nothing in src/routes/evidence/* is imported, so a bug in an aggregate query cannot be repeated by its own check) and the
// two are compared. It only ever READS: the caller hands in a read-only `sql` function and an HTTP `get`; this module never writes.
//
// Used by scripts/verify-evidence.ts (the CLI, `npm run evidence:verify`) and by test/evidence-verify.test.ts.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as clock from './lib/clock.js';

// The API bodies are untyped JSON on purpose: this module judges what the endpoints actually return, not what their types promise.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
type Row = Record<string, Json>;

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

export interface VerifyIO {
  /** GET an API path as the administrator. */
  get(path: string): Promise<{ status: number; body: Json }>;
  /** A read-only SELECT. Timestamps must be selected as text (the driver would otherwise shift them into the local time zone). */
  sql(text: string, params?: unknown[]): Promise<Row[]>;
  /** Directory the evidence artifacts are served from (the API's EVIDENCE_DIR). */
  evidenceDir?: string;
  /** formcheck/metrics.json as the API reads it (FORMCHECK_METRICS). */
  metricsPath?: string;
}

export interface VerifyHooks {
  /** Called after a window's API responses are in and before its SQL runs: a test uses it to change the data in between. */
  afterApi?(window: string): Promise<void> | void;
  /** Called with each API body (mutable) before it is compared: a test uses it to perturb one reported number. */
  mutateApi?(window: string, endpoint: string, body: Json): void;
  /** Called once with the window list so progress can be shown. */
  onWindow?(label: string): void;
}

export interface Check {
  window: string;
  measure: string;
  endpoint: string;
  api: string;
  sql: string;
  agrees: boolean;
}

export interface Win {
  label: string;
  from: string | null;
  to: string | null;
}

export interface VerifyReport {
  checks: Check[];
  failures: Check[];
  windows: Win[];
  ok: boolean;
}

// ------------------------------------------------------------------------------------------------------------------ helpers
const TABLES = ['User', 'OfficerProfile', 'Application', 'Assignment', 'AssignmentTrace', 'DeadlineItem', 'AlertLog', 'EngineRun', 'AuditLog', 'Notification'] as const;

const norm = (v: unknown): unknown => (v === undefined ? null : v);
const show = (v: unknown): string => (v === null || v === undefined ? 'null' : typeof v === 'number' ? String(Math.round(v * 1e9) / 1e9) : typeof v === 'string' ? v : JSON.stringify(v));
const same = (a: unknown, b: unknown): boolean => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
};
/** A map as a stable one-line string, `A=1 B=2`, keys sorted. */
const mapStr = (m: Record<string, number>): string =>
  Object.keys(m)
    .sort()
    .map((k) => `${k}=${m[k]}`)
    .join(' ') || '(none)';
const toMap = (rows: Row[], k = 'k', n = 'n'): Record<string, number> => Object.fromEntries(rows.map((r) => [String(r[k]), Number(r[n])]));
const sum = (xs: number[]): number => xs.reduce((s, x) => s + x, 0);
const apiMap = <T>(xs: T[] | undefined, key: (x: T) => string, val: (x: T) => number): Record<string, number> => Object.fromEntries((xs ?? []).map((x) => [key(x), val(x)]));
const dayMs = 86_400_000;
const shiftDay = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * dayMs).toISOString().slice(0, 10);

/** `col` (any date or timestamp column) falls inside the window bound as $1 (from) and $2 (to); either may be NULL = unbounded. Inclusive days. */
const inWin = (col: string): string => `(($1::date IS NULL OR ${col}::date >= $1::date) AND ($2::date IS NULL OR ${col}::date <= $2::date))`;

const ISO_TS = (col: string): string => `to_char(${col}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export async function describeDatabase(
  url: string | undefined,
  sql: VerifyIO['sql'],
): Promise<{ cluster: string; host: string; port: string; database: string; user: string; server: string; counts: Record<string, number> }> {
  let host = '?';
  let port = '?';
  let database = '?';
  let user = '?';
  try {
    const u = new URL(url ?? '');
    host = u.hostname;
    port = u.port || '5432';
    database = decodeURIComponent(u.pathname.replace(/^\//, ''));
    user = decodeURIComponent(u.username); // never the password
  } catch {
    /* a missing or odd URL is reported as unknown */
  }
  const id = (await sql(`SELECT current_database() AS db, inet_server_port() AS port, split_part(version(), ' on ', 1) AS ver`))[0] ?? {};
  let systemId: string | null = null;
  try {
    systemId = String((await sql(`SELECT system_identifier::text AS s FROM pg_control_system()`))[0]?.s ?? '') || null;
  } catch {
    /* the role may not be allowed to read the control file; the host:port/database already names the cluster */
  }
  const counts: Record<string, number> = {};
  for (const t of TABLES) counts[t] = Number((await sql(`SELECT count(*)::int AS n FROM "${t}"`))[0]?.n ?? 0);
  return {
    cluster: `${id.ver ?? 'PostgreSQL'}${systemId ? `, system id ${systemId}` : ''}`,
    host,
    port: id.port ? String(id.port) : port,
    database: id.db ?? database,
    user,
    server: id.ver ?? '',
    counts,
  };
}

// ------------------------------------------------------------------------------------------------------------------ verifier
export async function runVerification(io: VerifyIO, hooks: VerifyHooks = {}): Promise<VerifyReport> {
  const checks: Check[] = [];
  const evidenceDir = io.evidenceDir ?? process.env.EVIDENCE_DIR ?? path.join(repoRoot, 'docs', 'evidence');
  const metricsPath = io.metricsPath ?? process.env.FORMCHECK_METRICS ?? path.join(repoRoot, 'formcheck', 'metrics.json');

  const add = (window: string, measure: string, endpoint: string, api: unknown, sql: unknown): void => {
    checks.push({ window, measure, endpoint, api: show(api), sql: show(sql), agrees: same(api, sql) });
  };
  /** A thrown query is a failed check, not a crash: the run must still finish and exit non-zero. */
  const guard = async (window: string, name: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
    } catch (e) {
      add(window, `${name} (verifier error)`, '-', `error: ${(e as Error).message.slice(0, 120)}`, 'no error');
    }
  };
  const fetchApi = async (window: string, endpoint: string, p: string): Promise<Json | null> => {
    const r = await io.get(p);
    if (r.status !== 200) {
      add(window, `GET ${endpoint} status`, endpoint, r.status, 200);
      return null;
    }
    hooks.mutateApi?.(window, endpoint, r.body);
    return r.body;
  };

  // ---- windows, chosen from the data itself: all dates; the last 30 days of the data; its busiest single alert day; an empty window.
  const lastDay = ((await io.sql(`SELECT max(d)::text AS d FROM (
      SELECT max("submittedAt")::date AS d FROM "Application" UNION ALL SELECT max("createdAt")::date FROM "AlertLog"
      UNION ALL SELECT max("simulatedToday") FROM "EngineRun" UNION ALL SELECT max("at")::date FROM "AuditLog"
      UNION ALL SELECT max("decidedAt")::date FROM "AssignmentTrace" UNION ALL SELECT max("assignedAt")::date FROM "Assignment") x`))[0]?.d ?? null) as string | null;
  const busiest = ((await io.sql(`SELECT "createdAt"::date::text AS d FROM "AlertLog" GROUP BY 1 ORDER BY count(*) DESC, 1 DESC LIMIT 1`))[0]?.d ?? lastDay) as string | null;
  const windows: Win[] = [{ label: 'all', from: null, to: null }];
  if (lastDay) windows.push({ label: 'last30d', from: shiftDay(lastDay, -29), to: lastDay });
  if (busiest) windows.push({ label: '1day', from: busiest, to: busiest });
  windows.push({ label: 'empty', from: '1999-01-01', to: '1999-01-02' });

  for (const w of windows) {
    hooks.onWindow?.(w.label);
    const qs = [w.from ? `from=${w.from}` : '', w.to ? `to=${w.to}` : ''].filter(Boolean).join('&');
    const q = (p: string, extra = ''): string => `${p}?${[qs, extra].filter(Boolean).join('&')}`;
    const L = w.label;
    const P = [w.from, w.to];

    // API side first (all endpoints for the window), then the hook, then SQL: a change made in the hook is a perturbation the check must catch.
    const wf = await fetchApi(L, '/workflow', q('/api/evidence/workflow'));
    const asg = await fetchApi(L, '/assignment', q('/api/evidence/assignment'));
    const co = await fetchApi(L, '/compliance', q('/api/evidence/compliance'));
    const al = await fetchApi(L, '/alerts', q('/api/evidence/alerts'));
    const au = await fetchApi(L, '/audit-analytics', q('/api/evidence/audit-analytics'));
    const er = await fetchApi(L, '/engine-runs', q('/api/evidence/engine-runs', 'pageSize=200'));
    await hooks.afterApi?.(L);

    // ---------------------------------------------------------------------------------------------------------- workflow
    if (wf) {
      await guard(L, 'workflow', async () => {
        const d = wf.data;
        const total = Number((await io.sql(`SELECT count(*)::int AS n FROM "Application" a WHERE ${inWin('a."submittedAt"')}`, P))[0]!.n);
        add(L, 'applications submitted in window (submittedTotal)', '/workflow', d.submittedTotal, total);

        const stat = toMap(await io.sql(`SELECT e::text AS k, (SELECT count(*)::int FROM "Application" a WHERE a.status::text = e::text AND ${inWin('a."submittedAt"')}) AS n FROM unnest(enum_range(NULL::"Status")) e`, P));
        add(L, 'status distribution (all six statuses)', '/workflow', mapStr(apiMap(d.statusDistribution, (s: Json) => s.status, (s: Json) => s.count)), mapStr(stat));
        add(L, 'status distribution total vs submittedTotal', '/workflow', sum((d.statusDistribution as Json[]).map((s) => s.count)), total);

        const stageSql = toMap(
          await io.sql(
            `SELECT s.stage AS k, (SELECT count(*)::int FROM "Application" a WHERE ${inWin('a."submittedAt"')}
               AND EXISTS (SELECT 1 FROM "AuditLog" l WHERE l."applicationId" = a.id AND l."toState"->>'stage' = s.stage)) AS n
             FROM unnest(ARRAY['SCRUTINY','EVC','SAC_SHC','DECISION']) AS s(stage)`,
            P,
          ),
        );
        const decided = Number((await io.sql(`SELECT count(*)::int AS n FROM "Application" a WHERE ${inWin('a."submittedAt"')} AND EXISTS (SELECT 1 FROM "AuditLog" l WHERE l."applicationId" = a.id AND l.action = 'DECIDE')`, P))[0]!.n);
        const f = apiMap(d.funnel as Json[], (s) => s.stage, (s) => s.reached);
        add(L, 'funnel reached: SUBMITTED', '/workflow', f.SUBMITTED, total);
        add(L, 'funnel reached: SCRUTINY / EVC / SAC_SHC / DECISION', '/workflow', mapStr({ SCRUTINY: f.SCRUTINY!, EVC: f.EVC!, SAC_SHC: f.SAC_SHC!, DECISION: f.DECISION! }), mapStr(stageSql));
        add(L, 'funnel reached: DECIDED (recorded decision)', '/workflow', f.DECIDED, decided);
        const routeSql = toMap(
          await io.sql(
            `SELECT s.stage AS k, (SELECT count(*)::int FROM "Application" a WHERE ${inWin('a."submittedAt"')} AND a.route ? s.stage) AS n FROM unnest(ARRAY['SCRUTINY','EVC','SAC_SHC','DECISION']) AS s(stage)`,
            P,
          ),
        );
        const onRoute = apiMap(d.funnel as Json[], (s) => s.stage, (s) => s.onRoute);
        add(L, 'funnel onRoute: SCRUTINY / EVC / SAC_SHC / DECISION', '/workflow', mapStr({ SCRUTINY: onRoute.SCRUTINY!, EVC: onRoute.EVC!, SAC_SHC: onRoute.SAC_SHC!, DECISION: onRoute.DECISION! }), mapStr(routeSql));
        add(L, 'funnel share of SUBMITTED (null when nothing submitted)', '/workflow', d.funnel[0].share, total > 0 ? total / total : null);
        add(L, 'funnel share of DECIDED (null when nothing submitted)', '/workflow', (d.funnel as Json[]).find((s) => s.stage === 'DECIDED').share, total > 0 ? decided / total : null);

        add(L, 'processing: decidedCount', '/workflow', d.processingTime.decidedCount, decided);
        add(L, 'processing: inFlightCount (submitted - decided)', '/workflow', d.processingTime.inFlightCount, total - decided);
        const med = (
          await io.sql(
            `WITH d AS (SELECT a."submittedAt"::date AS s, (SELECT min(l."at") FROM "AuditLog" l WHERE l."applicationId" = a.id AND l.action = 'DECIDE')::date AS e
                          FROM "Application" a WHERE ${inWin('a."submittedAt"')}),
                  n AS (SELECT CASE WHEN e >= s THEN (SELECT count(*) FROM generate_series((s + 1)::timestamp, e::timestamp, interval '1 day') g WHERE extract(isodow FROM g) < 6 AND NOT EXISTS (SELECT 1 FROM "Holiday" h WHERE h.date = g::date))
                                    ELSE -(SELECT count(*) FROM generate_series((e + 1)::timestamp, s::timestamp, interval '1 day') g WHERE extract(isodow FROM g) < 6 AND NOT EXISTS (SELECT 1 FROM "Holiday" h WHERE h.date = g::date)) END AS wd
                          FROM d WHERE e IS NOT NULL)
             SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY wd)::float8 AS m FROM n`,
            P,
          )
        )[0]?.m;
        add(L, 'processing: median working days (null when none decided)', '/workflow', d.processingTime.medianWorkingDays, med === undefined ? null : med);
      });
    }

    // -------------------------------------------------------------------------------------------------------- assignment
    if (asg) {
      await guard(L, 'assignment', async () => {
        const d = asg.data;
        const cov = (await io.sql(`SELECT count(*)::int AS total, (count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "AssignmentTrace" t WHERE t."assignmentId" = a.id)))::int AS traced FROM "Assignment" a WHERE ${inWin('a."assignedAt"')}`, P))[0]!;
        const blocked = Number((await io.sql(`SELECT count(*)::int AS n FROM "AssignmentTrace" t WHERE t."assignmentId" IS NULL AND ${inWin('t."decidedAt"')}`, P))[0]!.n);
        add(L, 'trace coverage: tracedCount', '/assignment', d.coverage.tracedCount, cov.traced);
        add(L, 'trace coverage: assignmentTotal', '/assignment', d.coverage.assignmentTotal, cov.total);
        add(L, 'trace coverage: blockedCount', '/assignment', d.coverage.blockedCount, blocked);
        const out = toMap(await io.sql(`SELECT t.outcome AS k, count(*)::int AS n FROM "AssignmentTrace" t WHERE ${inWin('t."decidedAt"')} GROUP BY 1`, P));
        add(L, 'decision outcomes', '/assignment', mapStr(apiMap(d.outcomes, (o: Json) => o.outcome, (o: Json) => o.count)), mapStr(out));
        const cand = (
          await io.sql(
            `SELECT COALESCE(sum(jsonb_array_length(t.candidates)), 0)::int AS considered,
                    COALESCE(sum(jsonb_array_length(jsonb_path_query_array(t.candidates, '$[*] ? (@.eligible == true)'))), 0)::int AS eligible
             FROM "AssignmentTrace" t WHERE ${inWin('t."decidedAt"')}`,
            P,
          )
        )[0]!;
        add(L, 'candidates considered', '/assignment', d.candidates.candidatesConsidered, cand.considered);
        add(L, 'candidates eligible', '/assignment', d.candidates.eligible, cand.eligible);
        const versions = Number((await io.sql(`SELECT count(*)::int AS n FROM "Assignment" a WHERE ${inWin('a."assignedAt"')} AND EXISTS (SELECT 1 FROM "RulePackVersion" v WHERE v.id = a."rulePackVersionId")`, P))[0]!.n);
        add(L, 'rule-pack versions: assignments add up to assignmentTotal', '/assignment', sum((d.rulePackVersions as Json[]).map((v) => v.assignments)), versions);

        // Current state (never windowed): the same numbers must come back in every window.
        const off = await io.sql(
          `SELECT p."userId" AS id, (COALESCE((SELECT sum(a.weight) FROM "Assignment" a WHERE a."officerId" = p."userId" AND a."releasedAt" IS NULL), 0) / p."capacityPoints")::float8 AS util, p."maxUtil"::float8 AS cap
           FROM "OfficerProfile" p JOIN "User" u ON u.id = p."userId" WHERE u.role = 'OFFICER'`,
        );
        const officerUsers = Number((await io.sql(`SELECT count(*)::int AS n FROM "User" WHERE role = 'OFFICER'`))[0]!.n);
        const utils = off.map((o) => Number(o.util));
        const mean = utils.length ? sum(utils) / utils.length : null;
        const sd = utils.length >= 2 && mean !== null ? Math.sqrt(sum(utils.map((x) => (x - mean) ** 2)) / utils.length) : null;
        add(L, 'officer count (users with role OFFICER)', '/assignment', d.spread.officerCount, officerUsers);
        add(L, 'officers listed = OFFICER users with a capacity profile', '/assignment', (d.officers as Json[]).length, off.length);
        add(L, 'utilisation mean', '/assignment', d.spread.meanUtilisation, mean);
        add(L, 'utilisation stdDev (population; null under 2 officers)', '/assignment', d.spread.stdDev, sd);
        const over = off.filter((o) => Number(o.util) > Number(o.cap) + 1e-9).map((o) => String(o.id)).sort();
        add(L, 'above-cap officers (count)', '/assignment', d.continuityOverrides.count, over.length);
        add(L, 'above-cap officers (ids)', '/assignment', (d.continuityOverrides.rows as Json[]).map((r) => r.officerId).sort().join(',') || '(none)', over.join(',') || '(none)');

        const recent = await io.sql(
          `SELECT t.id::text AS id, a."applicationNo" AS no, t.outcome, u.name AS officer FROM "AssignmentTrace" t
           LEFT JOIN "Application" a ON a.id = t."applicationId" LEFT JOIN "User" u ON u.id = t."chosenOfficerId"
           WHERE ${inWin('t."decidedAt"')} ORDER BY t."decidedAt" DESC, t.id DESC LIMIT 10`,
          P,
        );
        const rd = d.recentDecisions as Json[];
        add(L, 'recentDecisions: trace ids, newest first', '/assignment', rd.map((r) => r.traceId).join(',') || '(none)', recent.map((r) => r.id).join(',') || '(none)');
        add(L, 'recentDecisions: application no / outcome / officer', '/assignment', rd.map((r) => `${r.applicationNo}|${r.outcome}|${r.chosenOfficer}`).join(';') || '(none)', recent.map((r) => `${r.no}|${r.outcome}|${r.officer}`).join(';') || '(none)');
      });
    }

    // ------------------------------------------------------------------------------------------------------------ alerts
    const ever = Boolean((await io.sql(`SELECT (EXISTS (SELECT 1 FROM "EngineRun") OR EXISTS (SELECT 1 FROM "AlertLog")) AS e`))[0]!.e);
    const alertSql = async () => {
      const kinds = toMap(await io.sql(`SELECT g.kind AS k, count(*)::int AS n FROM "AlertLog" g WHERE ${inWin('g."createdAt"')} GROUP BY 1`, P));
      const rem = (await io.sql(`SELECT count(*)::int AS r, (count(*) FILTER (WHERE g.late))::int AS l FROM "AlertLog" g WHERE g.kind = 'REMINDER' AND ${inWin('g."createdAt"')}`, P))[0]!;
      const esc = toMap(await io.sql(`SELECT g."offsetOrLevel"::text AS k, count(*)::int AS n FROM "AlertLog" g WHERE g.kind = 'ESCALATION' AND ${inWin('g."createdAt"')} GROUP BY 1`, P));
      return { kinds, total: sum(Object.values(kinds)), rem: Number(rem.r), late: Number(rem.l), esc };
    };
    if (al) {
      await guard(L, 'alerts', async () => {
        const d = al.data;
        const s = await alertSql();
        add(L, 'alerts total (null only if the engine never ran)', '/alerts', d.total, ever ? s.total : null);
        add(L, 'alerts by kind', '/alerts', mapStr(apiMap(d.byKind, (k: Json) => k.kind, (k: Json) => k.count)), mapStr(s.kinds));
        add(L, 'reminderTiming: reminders / late / onTime', '/alerts', d.reminderTiming ? `${d.reminderTiming.reminders}/${d.reminderTiming.late}/${d.reminderTiming.onTime}` : null, ever ? `${s.rem}/${s.late}/${s.rem - s.late}` : null);
        add(L, 'escalations by level', '/alerts', mapStr(apiMap(d.escalationsByLevel, (e: Json) => String(e.level), (e: Json) => e.count)), mapStr(s.esc));
        const perDay = toMap(await io.sql(`SELECT g."createdAt"::date::text AS k, count(*)::int AS n FROM "AlertLog" g WHERE ${inWin('g."createdAt"')} GROUP BY 1`, P));
        add(L, 'alerts per day (days with an alert only)', '/alerts', mapStr(apiMap(d.perDay, (x: Json) => x.day, (x: Json) => x.count)), mapStr(perDay));
        const nt = (await io.sql(`SELECT count(*)::int AS t, (count(*) FILTER (WHERE "read"))::int AS r FROM "Notification"`))[0]!;
        add(L, 'notifications total / read (not windowed)', '/alerts', `${d.notifications.total}/${d.notifications.read}`, `${nt.t}/${nt.r}`);
        add(L, 'notifications informative (read > 0)', '/alerts', d.notifications.informative, Number(nt.r) > 0);
      });
    }

    // ------------------------------------------------------------------------------------------------------- compliance
    if (co) {
      await guard(L, 'compliance', async () => {
        const d = co.data;
        const asOf = d.asOf as string; // the system's current (simulated) date; the engine's clock cannot be read from SQL
        const open = Number((await io.sql(`SELECT count(*)::int AS n FROM "DeadlineItem" i WHERE i.status::text = 'OPEN' AND ${inWin('i."dueDate"')}`, P))[0]!.n);
        add(L, 'open deadlines: openTotal', '/compliance', d.deadlines.openTotal, open);
        add(L, 'open deadlines: overdue + atRisk + dueSoon + onTrack = openTotal', '/compliance', d.deadlines.overdue + d.deadlines.atRisk + d.deadlines.dueSoon + d.deadlines.onTrack, open);
        const overdue = Number(
          (
            await io.sql(
              `SELECT count(*)::int AS n FROM "DeadlineItem" i WHERE i.status::text = 'OPEN' AND ${inWin('i."dueDate"')} AND i."dueDate" < $3::date
                 AND (i.unit::text = 'CALENDAR' OR EXISTS (SELECT 1 FROM generate_series((i."dueDate" + 1)::timestamp, $3::timestamp, interval '1 day') g
                        WHERE extract(isodow FROM g) < 6 AND NOT EXISTS (SELECT 1 FROM "Holiday" h WHERE h.date = g::date)))`,
              [...P, asOf],
            )
          )[0]!.n,
        );
        add(L, `open deadlines: overdue as of ${asOf}`, '/compliance', d.deadlines.overdue, overdue);
        add(L, 'open deadlines: not overdue = atRisk + dueSoon + onTrack', '/compliance', d.deadlines.atRisk + d.deadlines.dueSoon + d.deadlines.onTrack, open - overdue);
        const st = toMap(await io.sql(`SELECT i.status::text AS k, count(*)::int AS n FROM "DeadlineItem" i WHERE ${inWin('i."dueDate"')} GROUP BY 1`, P));
        add(L, 'closed-out deadlines: met / missed / paused / closed', '/compliance', `${d.deadlines.met}/${d.deadlines.missed}/${d.deadlines.paused}/${d.deadlines.closed}`, `${st.MET ?? 0}/${st.MISSED ?? 0}/${st.PAUSED ?? 0}/${st.CLOSED ?? 0}`);
        const s = await alertSql();
        add(L, 'alerts total', '/compliance', d.alerts.total, ever ? s.total : null);
        add(L, 'alerts by kind', '/compliance', mapStr(apiMap(d.alerts.byKind, (k: Json) => k.kind, (k: Json) => k.count)), mapStr(s.kinds));
        add(L, 'reminderTiming (late reminders): reminders / late / onTime', '/compliance', d.alerts.reminderTiming ? `${d.alerts.reminderTiming.reminders}/${d.alerts.reminderTiming.late}/${d.alerts.reminderTiming.onTime}` : null, ever ? `${s.rem}/${s.late}/${s.rem - s.late}` : null);
        add(L, 'escalations by level (1,2,3 zero-filled; empty if the engine never ran)', '/compliance', (d.escalations as Json[]).map((e) => `${e.level}=${e.count}`).join(' '), ever ? [1, 2, 3].map((l) => `${l}=${s.esc[String(l)] ?? 0}`).join(' ') : '');
        const runs = (await io.sql(`SELECT count(*)::int AS n, sum("alertsSuppressed")::int AS sup FROM "EngineRun" r WHERE ${inWin('r."simulatedToday"')}`, P))[0]!;
        add(L, 'engine runs in window (engineRunCount)', '/compliance', d.alerts.engineRunCount, runs.n);
        add(L, 'alerts suppressed (null when no run in window)', '/compliance', d.alerts.suppressed, Number(runs.n) > 0 ? Number(runs.sup ?? 0) : null);
      });
    }

    // ------------------------------------------------------------------------------------------------------- engine runs
    if (er) {
      await guard(L, 'engine-runs', async () => {
        const t = er.totals;
        const cutoff = new Date(clock.realNow().getTime() - 15 * 60_000).toISOString();
        const r = (
          await io.sql(
            `SELECT count(*)::int AS n, (count(*) FILTER (WHERE status = 'FAILED'))::int AS failed,
                    (count(*) FILTER (WHERE status = 'RUNNING' AND "startedAt" < $3::timestamp))::int AS abandoned,
                    sum("alertsCreated")::int AS created, sum("alertsSuppressed")::int AS suppressed
             FROM "EngineRun" r WHERE ${inWin('r."simulatedToday"')}`,
            [...P, cutoff],
          )
        )[0]!;
        add(L, 'engine runs: runCount', '/engine-runs', t.runCount, r.n);
        add(L, 'engine runs: total rows (pagination total)', '/engine-runs', er.total, r.n);
        add(L, 'engine runs: failedCount', '/engine-runs', t.failedCount, r.failed);
        add(L, 'engine runs: abandonedCount', '/engine-runs', t.abandonedCount, r.abandoned);
        add(L, 'engine runs: alertsCreated (null when no run)', '/engine-runs', t.alertsCreated, r.created === null ? null : Number(r.created));
        add(L, 'engine runs: alertsSuppressed (null when no run)', '/engine-runs', t.alertsSuppressed, r.suppressed === null ? null : Number(r.suppressed));
        const logged = Number((await io.sql(`SELECT count(*)::int AS n FROM "AlertLog" g WHERE ${inWin('g."createdAt"')}`, P))[0]!.n);
        add(L, 'alertsCreated by runs == AlertLog rows in same window', '/engine-runs', t.alertsCreated ?? 0, logged);
        if (al) add(L, 'alerts endpoint total == AlertLog rows (ever ran)', '/alerts', al.data.total ?? 0, logged);
      });
    }

    // -------------------------------------------------------------------------------------------------------------- audit
    if (au) {
      await guard(L, 'audit', async () => {
        const d = au.data;
        const entity = `(CASE WHEN l."applicationId" IS NOT NULL THEN 'APPLICATION' WHEN l."chainKey" = 'rules' THEN 'RULE_PACK' ELSE 'SYSTEM' END)`;
        const total = Number((await io.sql(`SELECT count(*)::int AS n FROM "AuditLog" l WHERE ${inWin('l."at"')}`, P))[0]!.n);
        add(L, 'audit events total', '/audit-analytics', d.total, total);
        const byAction = toMap(await io.sql(`SELECT l.action AS k, count(*)::int AS n FROM "AuditLog" l WHERE ${inWin('l."at"')} GROUP BY 1`, P));
        add(L, 'audit events by action', '/audit-analytics', mapStr(apiMap(d.byAction, (x: Json) => x.action, (x: Json) => x.count)), mapStr(byAction));
        const byRole = toMap(await io.sql(`SELECT l."actorRole" AS k, count(*)::int AS n FROM "AuditLog" l WHERE ${inWin('l."at"')} GROUP BY 1`, P));
        add(L, 'audit events by actor role', '/audit-analytics', mapStr(apiMap(d.byActorRole, (x: Json) => x.actorRole, (x: Json) => x.count)), mapStr(byRole));
        const byEnt = toMap(await io.sql(`SELECT ${entity} AS k, count(*)::int AS n FROM "AuditLog" l WHERE ${inWin('l."at"')} GROUP BY 1`, P));
        add(L, 'audit events by entity', '/audit-analytics', mapStr(apiMap(d.byEntity, (x: Json) => x.entity, (x: Json) => x.count)), mapStr(byEnt));
      });
    }
  }

  // ---- things that are not windowed, checked once ----------------------------------------------------------------------------
  const A = 'all';
  const base = 'all';
  await guard(base, 'audit filters', async () => {
    const top = (await io.sql(`SELECT action FROM "AuditLog" GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1`))[0]?.action as string | undefined;
    if (top) {
      const b = await fetchApi(A, '/audit-analytics?action', `/api/evidence/audit-analytics?action=${top}`);
      if (b) add(A, `audit filter action=${top}: total`, '/audit-analytics', b.data.total, Number((await io.sql(`SELECT count(*)::int AS n FROM "AuditLog" WHERE action = $1`, [top]))[0]!.n));
    }
    const e = await fetchApi(A, '/audit-analytics?entity', '/api/evidence/audit-analytics?entity=APPLICATION');
    if (e) add(A, 'audit filter entity=APPLICATION: total', '/audit-analytics', e.data.total, Number((await io.sql(`SELECT count(*)::int AS n FROM "AuditLog" WHERE "applicationId" IS NOT NULL`))[0]!.n));
  });

  await guard(base, 'engine-runs filter', async () => {
    for (const status of ['OK', 'FAILED']) {
      const b = await fetchApi(A, `/engine-runs?status=${status}`, `/api/evidence/engine-runs?status=${status}&pageSize=1`);
      const n = Number((await io.sql(`SELECT count(*)::int AS n FROM "EngineRun" WHERE status = $1`, [status]))[0]!.n);
      if (b) add(A, `engine runs filtered status=${status}: runCount / total`, '/engine-runs', `${b.totals.runCount}/${b.total}`, `${n}/${n}`);
    }
  });

  await guard(base, 'summary', async () => {
    const s = await fetchApi(A, '/summary', '/api/evidence/summary');
    if (!s) return;
    const last = (await io.sql(`SELECT status, "durationMs" AS ms, ${ISO_TS('"startedAt"')} AS at FROM "EngineRun" ORDER BY id DESC LIMIT 1`))[0];
    add(A, 'latest engine run: status', '/summary', s.scheduler.lastStatus, last?.status ?? null);
    add(A, 'latest engine run: startedAt', '/summary', s.scheduler.lastRunAt, last?.at ?? null);
    add(A, 'latest engine run: durationMs', '/summary', s.scheduler.lastDurationMs, last ? (last.ms === null ? null : Number(last.ms)) : null);
    const stuck = Number((await io.sql(`SELECT count(*)::int AS n FROM "EngineRun" WHERE status = 'RUNNING' AND "startedAt" < $1::timestamp`, [new Date(clock.realNow().getTime() - 15 * 60_000).toISOString()]))[0]!.n);
    add(A, 'stuck runs (RUNNING > 15 min, all dates)', '/summary', s.scheduler.stuckRuns, stuck);
    const hb = (await io.sql(`SELECT "instanceId" AS i FROM "SchedulerHeartbeat" WHERE "isLeader" ORDER BY "lastRunAt" DESC LIMIT 1`))[0];
    add(A, 'scheduler heartbeat leader (null when none)', '/summary', s.scheduler.heartbeat?.instanceId ?? null, hb?.i ?? null);
  });

  await guard(base, 'audit integrity', async () => {
    const b = await fetchApi(A, '/audit-integrity', '/api/evidence/audit-integrity');
    if (!b) return;
    const c = (await io.sql(`SELECT count(*)::int AS rows, count(DISTINCT "chainKey")::int AS chains FROM "AuditLog"`))[0]!;
    add(A, 'audit integrity: rowsChecked == AuditLog rows', '/audit-integrity', b.rowsChecked, c.rows);
    add(A, 'audit integrity: chainsChecked == distinct chains', '/audit-integrity', b.chainsChecked, c.chains);
    // Link check only (each row's prevHash is the previous row's rowHash, first is all zeros). Hashes are not recomputed here, so a
    // row edited in place with its links intact would make the API say ok=false and this say 0 broken links: that is reported, not hidden.
    const broken = Number(
      (
        await io.sql(
          `SELECT count(*)::int AS n FROM (SELECT "prevHash", lag("rowHash") OVER (PARTITION BY "chainKey" ORDER BY id) AS prev FROM "AuditLog") t
           WHERE "prevHash" IS DISTINCT FROM COALESCE(prev, repeat('0', 64))`,
        )
      )[0]!.n,
    );
    add(A, 'audit integrity: ok == (no broken prevHash link)', '/audit-integrity', b.ok, broken === 0);
  });

  await guard(base, 'assignment trace per application', async () => {
    const apps = await io.sql(
      `(SELECT "applicationId" AS id FROM "AssignmentTrace" GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1)
       UNION (SELECT "applicationId" FROM "AssignmentTrace" WHERE "assignmentId" IS NULL ORDER BY "applicationId" LIMIT 1)`,
    );
    for (const a of apps) {
      const id = String(a.id);
      const b = await fetchApi(A, '/assignment-trace/:applicationId', `/api/evidence/assignment-trace/${encodeURIComponent(id)}`);
      if (!b) continue;
      const r = (
        await io.sql(
          `SELECT (SELECT count(*)::int FROM "Assignment" x WHERE x."applicationId" = $1 AND EXISTS (SELECT 1 FROM "AssignmentTrace" t WHERE t."assignmentId" = x.id)) AS traced,
                  (SELECT count(*)::int FROM "Assignment" x WHERE x."applicationId" = $1) AS total,
                  (SELECT count(*)::int FROM "AssignmentTrace" t WHERE t."applicationId" = $1 AND t."assignmentId" IS NULL) AS blocked,
                  (SELECT count(*)::int FROM "AssignmentTrace" t WHERE t."applicationId" = $1) AS rows`,
          [id],
        )
      )[0]!;
      const tag = id.slice(0, 8);
      add(A, `trace of application ${tag}: traced/assignments/blocked`, '/assignment-trace', `${b.coverage.tracedCount}/${b.coverage.assignmentTotal}/${b.coverage.blockedCount}`, `${r.traced}/${r.total}/${r.blocked}`);
      add(A, `trace of application ${tag}: trace rows`, '/assignment-trace', (b.rows as Json[]).length, r.rows);
    }
  });

  await guard(base, 'artifacts', async () => {
    const b = await fetchApi(A, '/artifacts', '/api/evidence/artifacts');
    if (!b) return;
    const files = (await fs.readdir(path.join(evidenceDir, 'benchmark-results')).catch(() => [] as string[])).filter((f) => f.endsWith('.json')).sort();
    const names = [...files.map((f) => `benchmark-results/${f}`), 'formcheck/metrics.json'];
    add(A, 'artifacts listed (benchmark files + formcheck metrics)', '/artifacts', (b.artifacts as Json[]).map((x) => x.name).join(','), names.join(','));

    // ML evaluation: the confusion matrix is DERIVED (never stored). Recompute it from the file on disk and compare with what is
    // served, then recompute the precision from TP and FP and compare with the stored figure.
    let file: Json = null;
    try {
      file = JSON.parse(await fs.readFile(metricsPath, 'utf8'));
    } catch {
      file = null;
    }
    const served = (b.artifacts as Json[]).find((x) => x.name === 'formcheck/metrics.json');
    add(A, 'ML metrics.json readable (READ vs NOT_VERIFIED)', '/artifacts', served?.status ?? null, file && typeof file === 'object' ? 'READ' : 'NOT_VERIFIED');
    const derive = (m: Json): { tp: number; fn: number; fp: number; tn: number; precision: number; whole: boolean } | null => {
      const h = m?.modes?.['Hybrid (rules or model)'];
      const nf = m?.datasets?.testFaulty;
      const nn = m?.datasets?.testNormal;
      if (!h || !Number.isFinite(nf) || !Number.isFinite(nn)) return null;
      const tp = h.recall * nf;
      const fp = h.false_alarm_rate * nn;
      const whole = Math.abs(tp - Math.round(tp)) < 1e-6 && Math.abs(fp - Math.round(fp)) < 1e-6;
      return { tp: Math.round(tp), fn: nf - Math.round(tp), fp: Math.round(fp), tn: nn - Math.round(fp), precision: Math.round(tp) + Math.round(fp) === 0 ? 0 : Math.round(tp) / (Math.round(tp) + Math.round(fp)), whole };
    };
    const fromFile = derive(file);
    const fromApi = derive(served?.data);
    if (fromFile || fromApi) {
      const cm = (c: ReturnType<typeof derive>) => (c ? `TP=${c.tp} FN=${c.fn} FP=${c.fp} TN=${c.tn}` : null);
      add(A, 'ML confusion matrix (hybrid): served metrics vs file', '/artifacts', cm(fromApi), cm(fromFile));
      add(A, 'ML rates times sample sizes are whole numbers (matrix is exact)', '/artifacts', fromApi?.whole ?? null, fromFile?.whole ?? null);
      const stored = file?.modes?.['Hybrid (rules or model)']?.precision;
      add(A, 'ML hybrid precision: stored (served) vs TP/(TP+FP) recomputed, 3 dp', '/artifacts', served?.data?.modes?.['Hybrid (rules or model)']?.precision ?? null, fromFile ? Number(fromFile.precision.toFixed(3)) : null);
      add(A, 'ML hybrid precision: stored in file vs recomputed, 3 dp', '/artifacts', stored ?? null, fromFile ? Number(fromFile.precision.toFixed(3)) : null);
    }
  });

  const failures = checks.filter((c) => !c.agrees);
  return { checks, failures, windows, ok: failures.length === 0 && checks.length > 0 };
}

/** The table, one line per check, columns padded. Long values are cut for width (a disagreement is printed in full by the caller). */
export function formatTable(checks: Check[], maxCell = 60): string {
  const cut = (v: string): string => (v.length > maxCell ? `${v.slice(0, maxCell - 1)}~` : v);
  const rows = [['window', 'measure', 'endpoint', 'API', 'SQL', 'agrees'], ...checks.map((c) => [c.window, c.measure, c.endpoint, cut(c.api), cut(c.sql), c.agrees ? 'yes' : 'NO'])];
  const w = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
  const line = (r: string[]): string => r.map((c, i) => c.padEnd(w[i]!)).join(' | ');
  return [line(rows[0]!), w.map((n) => '-'.repeat(n)).join('-+-'), ...rows.slice(1).map(line)].join('\n');
}
