// Test data shaped like the live /evidence responses (read from the dev API), trimmed.
import type { AlertsData, AssignmentData, AssignmentTraceResponse, ComplianceData, ComplianceEnvelope, EngineRunDetailRow, EngineRunsDetailResponse, EngineRunsResponse, EvidenceEnvelope, EvidenceSummary, TraceCandidate, WorkflowData } from '../../../../api/types';

const STARTED = new Date(Date.now() - 4 * 3600_000).toISOString();

export const DEFS = {
  status: 'STATUS DEF: only PASS means the checks were verified for this code version.',
  scheduler: 'SCHEDULER DEF: two separate facts, the latest cycle and the heartbeat.',
  stuckRuns: 'STUCK DEF: runs still marked running after 15 minutes.',
  funnel: 'FUNNEL DEF: distinct applications that have reached each stage.',
  statusDistribution: 'STATUSDIST DEF: counts add up to the submitted total.',
  processingTime: 'PROCESSING DEF: median working days, decided only; no mean is given.',
  volumeOverTime: 'VOLUME DEF: the overdue points sit on the due date, not the From/To range.',
  assignmentOfficers: 'OFFICERS DEF: open points over capacity points, now.',
  assignmentSpread: 'SPREAD DEF: standard deviation of current utilisation, officers with capacity only.',
  assignmentCoverage: 'COVERAGE DEF: assignments with a recorded decision table.',
  assignmentCandidates: 'CANDIDATES DEF: candidate rows across decisions in the window.',
  assignmentRecent: 'RECENT DEF: the ten newest decisions in the window.',
  assignmentAboveCap: 'ABOVECAP DEF: current utilisation above the officer own cap.',
  integrity: 'INTEGRITY DEF: recomputed over the WHOLE audit log.',
};

export const summary = (over: Partial<EvidenceSummary> = {}): EvidenceSummary => ({
  status: 'NOT_VERIFIED',
  commit: 'db3e5844d2aaf91f18601ebd89bd5511857d837e',
  headUnresolved: false,
  artifactCommit: null,
  detail: null,
  checks: { passed: null, failed: null, notVerified: null },
  lastRunAt: null,
  scheduler: { lastRunAt: STARTED, lastStatus: 'OK', lastDurationMs: 742, stuckRuns: 0, heartbeat: null },
  definition: { status: DEFS.status, scheduler: DEFS.scheduler, stuckRuns: DEFS.stuckRuns },
  provenance: { status: null, scheduler: 'MEASURED' },
  ...over,
});

export const workflowData = (over: Partial<WorkflowData> = {}): WorkflowData => ({
  window: { from: null, to: null },
  submittedTotal: 191,
  funnel: [
    { stage: 'SUBMITTED', label: 'Submitted', reached: 191, onRoute: 191, share: 1 },
    { stage: 'SCRUTINY', label: 'Scrutiny', reached: 162, onRoute: 162, share: 0.848 },
    { stage: 'EVC', label: 'Expert visit committee', reached: 52, onRoute: 124, share: 0.272 },
    { stage: 'SAC_SHC', label: 'SAC/SHC', reached: 2, onRoute: 2, share: 0.0105 },
    { stage: 'DECISION', label: 'Awaiting decision', reached: 47, onRoute: 191, share: 0.246 },
    { stage: 'DECIDED', label: 'Decided', reached: 45, onRoute: 191, share: 0.2356 },
  ],
  statusDistribution: [
    { status: 'IN_STAGE', count: 141, share: 0.738 },
    { status: 'RETURNED', count: 5, share: 0.026 },
    { status: 'APPROVED', count: 34, share: 0.178 },
    { status: 'APPROVED_WITH_CONDITIONS', count: 6, share: 0.031 },
    { status: 'REJECTED', count: 3, share: 0.0157 },
    { status: 'CLOSED', count: 2, share: 0.0105 },
  ],
  processingTime: { decidedCount: 45, inFlightCount: 146, medianWorkingDays: 5, unit: 'working days' },
  volumeOverTime: [
    { day: '2026-05-21', submitted: 1, decided: 0, overdue: 0 },
    { day: '2026-05-28', submitted: 0, decided: 1, overdue: 2 },
    { day: '2026-06-03', submitted: 3, decided: 1, overdue: 0 },
  ],
  ...over,
});

export const workflow = (over: Partial<WorkflowData> = {}): EvidenceEnvelope<WorkflowData> => ({
  definition: {
    scope: 'SCOPE',
    funnel: DEFS.funnel,
    statusDistribution: DEFS.statusDistribution,
    processingTime: DEFS.processingTime,
    volumeOverTime: DEFS.volumeOverTime,
  },
  provenance: { funnel: 'MEASURED', funnelShare: 'DERIVED', statusDistribution: 'MEASURED', processingTime: 'DERIVED', volumeOverTime: 'MEASURED' },
  data: workflowData(over),
});

export const engineRuns = (rows = true): EngineRunsResponse => ({
  total: rows ? 25 : 0,
  rows: rows ? [{ id: '25', startedAt: STARTED, finishedAt: null, durationMs: 742, simulatedToday: '2026-11-03', status: 'OK' }] : [],
  totals: { runCount: rows ? 25 : 0, failedCount: 0, abandonedCount: 0, alertsCreated: null, alertsSuppressed: null },
  definition: {},
  provenance: {},
});

export const audit = (ok = true) => ({
  definition: { integrity: DEFS.integrity },
  provenance: { integrity: 'LIVE_DEMO' },
  data: { total: 782, integrity: { ok, chainsChecked: 193, rowsChecked: 782, brokenChainCount: ok ? 0 : 2, scope: 'WHOLE_LOG' } },
});

const officer = (i: number, util: number): AssignmentData['officers'][number] => ({
  officerId: `o${i}`, name: `Officer ${i}`, role: 'OFFICER', capacityPoints: 10, maxUtil: 1, openPoints: util * 10, openTasks: 2, openPointsAssignedInWindow: util * 10, utilisation: util,
});
export const OFFICER_UTILS = [0.12, 0.45, 0.2, 1.3, 0.3];
export const assignmentData = (over: Partial<AssignmentData> = {}): AssignmentData => ({
  window: { from: null, to: null },
  officers: OFFICER_UTILS.map((u, i) => officer(i + 1, u)),
  spread: { officerCount: 5, meanUtilisation: 0.474, stdDev: 0.4 },
  coverage: { tracedCount: 221, assignmentTotal: 221, blockedCount: 1 },
  outcomes: [{ outcome: 'ASSIGNED', count: 219 }, { outcome: 'BUREAU_OVERFLOW', count: 1 }, { outcome: 'BLOCKED', count: 1 }],
  candidates: { candidatesConsidered: 7534, eligible: 7374, excluded: [{ reason: 'UNAVAILABLE', count: 160 }] },
  continuityOverrides: {
    count: 1, continuityUtilCap: 1.1, urgentMaxUtil: 1.25,
    rows: [{ officerId: 'o4', officer: 'Officer 4', utilisation: 1.3, normalCap: 1, text: 'Officer 4 is at 1.30 of capacity against a normal cap of 1.00. FULL TEXT: capacity reduced after the work was assigned.' }],
  },
  recentDecisions: [
    { traceId: '221', applicationId: 'app-1', applicationNo: 'W-2026-0025', taskType: 'SCRUTINY', outcome: 'ASSIGNED', chosenOfficer: 'Officer 2', decidedAt: '2026-11-02T09:03:00.000Z', considered: 3, eligible: 2 },
    { traceId: '107', applicationId: 'app-2', applicationNo: 'S-2026-0100', taskType: 'EVC_DESK', outcome: 'BLOCKED', chosenOfficer: null, decidedAt: '2026-10-21T09:18:00.000Z', considered: 2, eligible: 0 },
  ],
  rulePackVersions: [{ label: '2026-27 v3', assignments: 163 }, { label: '2027-28 v1', assignments: 57 }],
  policy: { label: '2027-28 v1' },
  ...over,
});
export const assignment = (over: Partial<AssignmentData> = {}): EvidenceEnvelope<AssignmentData> => ({
  definition: {
    scope: 'SCOPE', officers: DEFS.assignmentOfficers, spread: DEFS.assignmentSpread, coverage: DEFS.assignmentCoverage, candidates: DEFS.assignmentCandidates,
    recentDecisions: DEFS.assignmentRecent, continuityOverrides: DEFS.assignmentAboveCap,
  },
  provenance: { officers: 'MEASURED', utilisation: 'DERIVED', spread: 'DERIVED', coverage: 'MEASURED', candidates: 'MEASURED', recentDecisions: 'MEASURED', continuityOverrides: 'DERIVED' },
  data: assignmentData(over),
});

const cand = (name: string, over: Partial<TraceCandidate> = {}): TraceCandidate => ({
  officerId: name, name, tier: 0, eligible: true, excludedBy: null, chosen: false, capacity: 10, openPoints: 3, projectedUtil: 0.45, score: 0.315, ...over,
});
export const REASON = 'Assigned to Officer 2 (Officer, South): lowest load score. REASON VERBATIM.';
export const BLOCKED_REASON = 'No eligible officer for evc desk (tier 0: 1 candidates, 1 unavailable). BLOCKED REASON VERBATIM.';
export const traceFor = (applicationId: string): AssignmentTraceResponse =>
  applicationId === 'app-2'
    ? {
        rows: [{ id: '107', assignmentId: null, applicationId, taskType: 'EVC_DESK', decidedAt: '2026-10-21T09:18:00.000Z', chosenOfficerId: null, outcome: 'BLOCKED', weight: 2.1, reasonText: BLOCKED_REASON,
          candidates: [cand('Ravi Kumar', { eligible: false, excludedBy: 'UNAVAILABLE' }), cand('Farhan Qureshi', { tier: 1, eligible: false, excludedBy: 'OVER_CAPACITY' })] }],
        coverage: { tracedCount: 0, assignmentTotal: 0, blockedCount: 1 },
      }
    : {
        rows: [
          { id: '90', assignmentId: 'x', applicationId, taskType: 'SCRUTINY', decidedAt: '2026-10-01T09:00:00.000Z', chosenOfficerId: 'Other', outcome: 'ASSIGNED', weight: 1, reasonText: 'EARLIER DECISION', candidates: [cand('Other', { chosen: true })] },
          { id: '221', assignmentId: 'y', applicationId, taskType: 'SCRUTINY', decidedAt: '2026-11-02T09:03:00.000Z', chosenOfficerId: 'Officer 2', outcome: 'ASSIGNED', weight: 1.5, reasonText: REASON,
            candidates: [cand('Officer 2', { chosen: true, score: 0.3, projectedUtil: 0.45 }), cand('Officer 1', { score: 0.4, projectedUtil: 0.5 }), cand('Officer 9', { eligible: false, excludedBy: 'RECUSED' })] },
        ],
        coverage: { tracedCount: 1, assignmentTotal: 1, blockedCount: 0 },
      };

// ── Scheduler & compliance and alerts (live shapes, trimmed) ───────────────────
export const COMPLIANCE_DEFS = {
  asOf: 'ASOF DEF: evaluated on the system current date; the four states add up to openTotal.',
  overdue: 'OVERDUE DEF: open item whose due date has passed.',
  atRisk: 'ATRISK DEF: share of allowed days used is at least 80%.',
  dueSoon: 'DUESOON DEF: within 30 calendar days of its due date.',
  onTrack: 'ONTRACK DEF: open items that are none of the above.',
  met: 'MET DEF: closed as met on time; not part of openTotal.',
};
export const complianceData = (over: Partial<ComplianceData['deadlines']> = {}): ComplianceData => ({
  window: { from: null, to: null },
  asOf: '2026-11-03',
  deadlines: { openTotal: 178, overdue: 20, atRisk: 7, dueSoon: 4, onTrack: 147, met: 165, missed: 1, paused: 5, closed: 0, ...over },
  escalations: [{ level: 1, count: 20 }],
  alerts: { total: 107, byKind: [], reminderTiming: { reminders: 22, onTime: 1, late: 21 }, suppressed: 96, engineRunCount: 25 },
});
export const compliance = (over: Partial<ComplianceData['deadlines']> = {}): ComplianceEnvelope => ({
  definition: { scope: 'SCOPE', deadlines: COMPLIANCE_DEFS },
  provenance: { deadlines: 'DERIVED' },
  data: complianceData(over),
});

export const RUN_DEFS = {
  window: 'RUNWINDOW DEF: the dates select the day the engine treated as today.',
  rows: 'RUNROWS DEF: one row per cycle, newest first.',
  totals: 'RUNTOTALS DEF: counted over every run in the window.',
  abandoned: 'ABANDONED DEF: still marked running after 15 minutes of real time.',
  alertsCreated: 'CREATED DEF: alerts newly logged by the runs in the window.',
  alertsSuppressed: 'SUPPRESSED DEF: the unique key makes the decision to alert once; no external delivery channel.',
};
export const runRow = (id: number, over: Partial<EngineRunDetailRow> = {}): EngineRunDetailRow => ({
  id: String(id),
  startedAt: `2026-11-03T19:17:${String(10 + id).padStart(2, '0')}.000Z`,
  finishedAt: `2026-11-03T19:17:${String(11 + id).padStart(2, '0')}.000Z`,
  durationMs: 100 * id,
  instanceId: 'vm:14368',
  simulatedToday: `2026-10-${String(10 + id).padStart(2, '0')}`,
  provenance: 'SIMULATED',
  itemsChecked: 100 + id,
  alertsCreated: 10 + id,
  alertsSuppressed: 5 + id,
  notifications: 0,
  flagsRaised: 0,
  escalations: 0,
  status: 'OK',
  error: null,
  ...over,
});
/** Newest first, like the API. Run 2 failed. */
export const RUN_ROWS: EngineRunDetailRow[] = [runRow(3), runRow(2, { status: 'FAILED', error: 'ERROR TEXT: database connection lost', durationMs: 4200 }), runRow(1, { provenance: 'LIVE_DEMO' })];
export const engineRunsDetail = (over: Partial<EngineRunsDetailResponse> = {}): EngineRunsDetailResponse => ({
  total: RUN_ROWS.length,
  page: 1,
  pageSize: 25,
  rows: RUN_ROWS,
  totals: { runCount: 3, failedCount: 1, abandonedCount: 0, alertsCreated: 39, alertsSuppressed: 21 },
  definition: RUN_DEFS,
  provenance: { rows: 'MEASURED', totals: 'MEASURED' },
  ...over,
});
export const noRuns = (): EngineRunsDetailResponse =>
  engineRunsDetail({ total: 0, rows: [], totals: { runCount: 0, failedCount: 0, abandonedCount: 0, alertsCreated: null, alertsSuppressed: null } });

export const ALERT_DEFS = {
  total: 'ALERTTOTAL DEF: alerts the engine logged in the window; blank when no engine activity.',
  byKind: 'BYKIND DEF: counts add up to total.',
  reminderTiming: 'TIMING DEF: reminders only; onTime + late = reminders (not total).',
  perDay: 'PERDAY DEF: only days with at least one alert; nothing is back-filled.',
  escalationsByLevel: 'ESCLEVEL DEF: only levels with at least one alert are listed.',
  notifications: 'NOTIF DEF: every notification ever created, not windowed.',
  notRecorded: 'NOTRECORDED DEF: acknowledgement and resolution time are not recorded.',
};
export const alertsData = (over: Partial<AlertsData> = {}): AlertsData => ({
  window: { from: null, to: null },
  engineEverRan: true,
  total: 107,
  byKind: [{ kind: 'AT_RISK', count: 17 }, { kind: 'DIGEST', count: 16 }, { kind: 'ESCALATION', count: 31 }, { kind: 'OVERDUE', count: 21 }, { kind: 'REMINDER', count: 22 }],
  reminderTiming: { reminders: 22, onTime: 1, late: 21 },
  perDay: [{ day: '2026-09-14', count: 1 }, { day: '2026-10-05', count: 3 }, { day: '2026-10-19', count: 16 }, { day: '2026-11-02', count: 43 }],
  escalationsByLevel: [{ level: 1, count: 20 }, { level: 2, count: 8 }, { level: 3, count: 3 }],
  notifications: { total: 810, read: 0, unread: 810, informative: false },
  notRecorded: ['acknowledgement', 'resolution time'],
  ...over,
});
export const alerts = (over: Partial<AlertsData> = {}): EvidenceEnvelope<AlertsData> => ({
  definition: ALERT_DEFS,
  provenance: { total: 'MEASURED', byKind: 'MEASURED', reminderTiming: 'MEASURED', perDay: 'MEASURED', escalationsByLevel: 'MEASURED', notifications: 'MEASURED', notRecorded: null },
  data: alertsData(over),
});
