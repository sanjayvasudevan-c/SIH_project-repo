// Evidence Center: alerts. Counts of what the deadline engine logged, never case detail. AlertLog records that an alert was
// raised and nothing about what happened next, so acknowledgement and resolution are reported as NOT RECORDED, not as zero.
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { bounds, SCOPE, ZERO_ALERTS, type Counted, type Q } from './aggregates.js';
import type { Provenance } from './artifacts.js';

export async function alerts(q: Q) {
  const b = bounds(q);
  const at = Prisma.sql`g."createdAt"`;
  const [kinds, remindersRow, perDay, levels, notif, ever] = await Promise.all([
    prisma.$queryRaw<Counted[]>`SELECT g.kind AS k, count(*)::int AS n FROM "AlertLog" g WHERE TRUE ${b.sql(at)} GROUP BY 1 ORDER BY 1`,
    // Lateness is only ever assessed for reminders (engine/cycle.ts); every other kind is stored with late = false by default.
    prisma.$queryRaw<{ reminders: number; late: number }[]>`SELECT count(*)::int AS reminders, (count(*) FILTER (WHERE g.late))::int AS late FROM "AlertLog" g WHERE g.kind = 'REMINDER' ${b.sql(at)}`,
    // Only days that have at least one alert come back; there is no calendar join, so nothing can be zero-filled.
    prisma.$queryRaw<Counted[]>`SELECT g."createdAt"::date::text AS k, count(*)::int AS n FROM "AlertLog" g WHERE TRUE ${b.sql(at)} GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ level: number; n: number }[]>`SELECT g."offsetOrLevel" AS level, count(*)::int AS n FROM "AlertLog" g WHERE g.kind = 'ESCALATION' ${b.sql(at)} GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ total: number; read: number }[]>`SELECT count(*)::int AS total, (count(*) FILTER (WHERE "read"))::int AS read FROM "Notification"`,
    // All-time and clock-independent: has the engine, or anything it writes, ever been recorded?
    prisma.$queryRaw<{ ever: boolean }[]>`SELECT (EXISTS (SELECT 1 FROM "EngineRun") OR EXISTS (SELECT 1 FROM "AlertLog")) AS ever`,
  ]);
  const engineEverRan = ever[0]?.ever ?? false;
  const total = engineEverRan ? kinds.reduce((s, k) => s + k.n, 0) : null; // never ran: "none recorded", not "measured as zero"
  const reminders = remindersRow[0]?.reminders ?? 0;
  const late = remindersRow[0]?.late ?? 0;
  const read = notif[0]?.read ?? 0;
  const nTotal = notif[0]?.total ?? 0;
  return {
    definition: {
      scope: SCOPE,
      window:
        'The From and To dates (inclusive; all dates if none given) apply to the date each alert was logged, on the system\'s SIMULATED clock (the date the demo is pretending it is), not the real calendar date. The same window applies to total, byKind, reminderTiming, perDay and escalationsByLevel. The notifications block is NOT windowed: it always describes every notification ever created.',
      total:
        'Number of alerts the deadline engine logged in the window: one row per deadline item, kind and level (daily digests are one row per user per day, not per item), so the same alert is never logged twice. Blank (null) when no engine run and no alert has ever been recorded (engineEverRan is true if either exists, even an alert with no run on file), meaning "none recorded". Otherwise the engine has recorded activity at some time (not necessarily in this window). ' + ZERO_ALERTS + ' This counts the decision to alert. This build has no external delivery channel, so it says nothing about an alert reaching anyone outside the system.',
      byKind: 'Alerts in the window counted by kind (REMINDER, AT_RISK, OVERDUE, ESCALATION, DIGEST). The counts add up to total.',
      reminderTiming:
        'Timeliness of REMINDER alerts only. reminders = reminder alerts in the window; late = reminders raised more than one day after their reminder date because the engine had not run in time; onTime = reminders - late, so onTime + late = reminders (not total). The other alert kinds (at-risk, overdue, escalation, digest) have no timeliness measure in this system, so they are not counted as on time or late. Blank when total is blank.',
      perDay:
        'Alerts per simulated calendar day, only for days on which at least one alert was logged; days with none are left out, never shown as zero, and nothing is back-filled. The simulated date in this demo can be moved forward, and alerts are only logged when the engine runs, so a missing day usually means the engine did not run on that date, not that no alerts were due. perDay therefore records when the engine ran and is not an operational trend: do not read a rising or falling line as the workload getting better or worse. The counts add up to total.',
      escalationsByLevel:
        'Escalation alerts in the window counted by escalation level (1, 2 or 3, raised as a deadline item becomes more overdue). Only levels with at least one alert are listed. The counts add up to the escalation kind in byKind.',
      notifications:
        'Every in-system notification ever created (not windowed): total, read (opened by its recipient) and unread = total - read. informative is true only when read is above 0. While nobody has opened any notification, "0 read" is a true count but says nothing about whether people see alerts, so it should not be presented as a result.',
      notRecorded:
        'Acknowledgement (someone confirming they have seen an alert) and resolution time (how long until the underlying problem was fixed) are not recorded by this system, so no figure for either exists here. They are listed so their absence is visible rather than mistaken for zero.',
    },
    provenance: { total: 'MEASURED', byKind: 'MEASURED', reminderTiming: 'MEASURED', perDay: 'MEASURED', escalationsByLevel: 'MEASURED', notifications: 'MEASURED', notRecorded: null } as Record<string, Provenance | null>,
    data: {
      window: b.window,
      engineEverRan,
      total,
      byKind: kinds.map((k) => ({ kind: k.k, count: k.n })),
      reminderTiming: total === null ? null : { reminders, onTime: reminders - late, late },
      perDay: perDay.map((d) => ({ day: d.k, count: d.n })),
      escalationsByLevel: levels.map((l) => ({ level: l.level, count: l.n })),
      notifications: { total: nTotal, read, unread: nTotal - read, informative: read > 0 },
      notRecorded: ['acknowledgement', 'resolution time'] as ('acknowledgement' | 'resolution time')[],
    },
  };
}
