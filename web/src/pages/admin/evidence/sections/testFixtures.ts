// Test data shaped like the live /evidence responses (read from the dev API), trimmed.
import type { AlertsData, AuditAnalyticsData, AssignmentData, AssignmentTraceResponse, ComplianceData, ComplianceEnvelope, EngineRunDetailRow, EngineRunsDetailResponse, EngineRunsResponse, EvidenceEnvelope, EvidenceSummary, TraceCandidate, WorkflowData } from '../../../../api/types';

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

// ── Audit analytics (the live /evidence/audit-analytics shape, trimmed) ──────
export const AUDIT_DEFS = {
  events: 'EVENTS DEF: number of audit-log events matching the filters.',
  integrity: 'INTEGRITY LIVE DEF: recomputed now over the WHOLE audit log. It reports damage after the fact; it does not prevent anyone with database access from changing rows.',
};
export const auditAnalytics = (over: Partial<AuditAnalyticsData> = {}): EvidenceEnvelope<AuditAnalyticsData> => ({
  definition: { scope: 'SCOPE', events: AUDIT_DEFS.events, integrity: AUDIT_DEFS.integrity },
  provenance: { events: 'MEASURED', integrity: 'LIVE_DEMO' },
  data: {
    window: { from: null, to: null },
    filters: { actor: null, action: null, entity: null },
    total: 772,
    byActorRole: [
      { actorRole: 'COLLEGE', count: 428 },
      { actorRole: 'OFFICER', count: 189 },
      { actorRole: 'AUTHORITY', count: 45 },
      { actorRole: 'SYSTEM', count: 40 },
      { actorRole: 'ADMIN', count: 70 },
    ],
    byAction: [
      { action: 'ASSIGN', count: 220 },
      { action: 'SUBMIT', count: 191 },
      { action: 'RELEASE', count: 83 },
      { action: 'FORM_CHECK_JUSTIFIED', count: 18 },
      { action: 'LOGIN', count: 3 },
    ],
    byEntity: [
      { entity: 'APPLICATION', count: 724 },
      { entity: 'SYSTEM', count: 28 },
      { entity: 'RULE_PACK', count: 20 },
    ],
    integrity: { ok: true, chainsChecked: 193, rowsChecked: 772, brokenChainCount: 0, scope: 'WHOLE_LOG' },
    ...over,
  },
});

// ── Artifacts (the live /evidence/artifacts shape) ───────────────────────────
export const METRICS = {
  model: 'application_form_v1',
  threshold: 0.5794,
  datasets: { train: 4000, testNormal: 1000, testFaulty: 1000, synthetic: true },
  modes: {
    'Rules only': { precision: 1, recall: 0.859, false_alarm_rate: 0 },
    'Model only': { precision: 0.842, recall: 0.117, false_alarm_rate: 0.022 },
    'Hybrid (rules or model)': { precision: 0.975, recall: 0.863, false_alarm_rate: 0.022 },
  },
  perFault: {
    unit_error: { 'Rules only': 0.295, 'Model only': 0.07, 'Hybrid (rules or model)': 0.315 },
    builtup_over: { 'Rules only': 1, 'Model only': 0.28, 'Hybrid (rules or model)': 1 },
    faculty_short: { 'Rules only': 1, 'Model only': 0.09, 'Hybrid (rules or model)': 1 },
    expired_lease: { 'Rules only': 1, 'Model only': 0.06, 'Hybrid (rules or model)': 1 },
    bulk_missing: { 'Rules only': 1, 'Model only': 0.085, 'Hybrid (rules or model)': 1 },
  },
  generatedAt: '2026-11-03T13:35:09+00:00',
  commit: '6f6e7cd',
};
export const metricsEntry = (data: unknown = METRICS, status: 'READ' | 'NOT_VERIFIED' = 'READ') => ({ name: 'formcheck/metrics.json', status, provenance: 'SYNTHETIC', commit: '6f6e7cd', data });

const reads = (p95: number[], p50: number[] = [100, 100, 100, 100, 100], p99: number[] = [900, 900, 900, 900, 900]) =>
  ['Action Center (officer)', 'Action Center summary (senior)', 'Applications list (officer)', 'Team report (senior)', 'Authority queue'].map((screen, i) => ({
    screen, requests: 400, concurrency: 20, errors: i === 3 ? 2 : 0, p50ms: p50[i], p95ms: p95[i], p99ms: p99[i], maxMs: p99[i]! + 10, perSecond: 50 - i,
  }));
const OLD_MACHINE = { cpus: 4, cpuModel: 'Intel(R) Xeon(R) Processor @ 2.10GHz', memoryGb: 16, node: 'v22.22.0' };
export const OLD_RUN = {
  commit: '565c210', datasetSize: 15000, pgVersion: '16.15', date: '2026-11-03T08:26:18.480Z', machine: OLD_MACHINE,
  data: { seededApplications: 191, applications: 15000, deadlineItems: 27412, openDeadlineItems: 13982, assignments: 17279, bulkLoadMs: 1742 },
  engine: { firstCycle: { ms: 93800, newAlerts: 9321 }, secondCycle: { ms: 47100, newAlerts: 0 } },
  reads: reads([461, 199, 815, 1851, 348], [276, 146, 756, 1648, 298], [572, 234, 849, 1946, 398]),
};
export const NEW_RUN = {
  provenance: 'BENCHMARK', repeats: 1, resourceUse: null, commit: 'f78d82e', datasetSize: 15000, pgVersion: '16.15', date: '2026-11-04T00:32:35.329Z',
  machine: { ...OLD_MACHINE, totalMemoryBytes: 16872804352, os: 'Linux 6.18.44-fc-v230 x64', postgres: '16.15' },
  data: { seededApplications: 191, applications: 15000, deadlineItems: 27409, openDeadlineItems: 13974, assignments: 17275, bulkLoadMs: 1854 },
  engine: { firstCycle: { ms: 131493, newAlerts: 10282, alertsSuppressed: 47 }, secondCycle: { ms: 68084, newAlerts: 0, alertsSuppressed: 6490 } },
  reads: reads([508, 259, 1022, 2296, 471], [358, 189, 904, 2087, 409], [526, 302, 1046, 2365, 486]),
};
export const runEntry = (run: { commit: string }, status: 'READ' | 'NOT_VERIFIED' = 'READ') => ({ name: `benchmark-results/${run.commit}.json`, status, provenance: 'BENCHMARK', commit: run.commit, data: status === 'READ' ? run : null });
export const artifacts = (...entries: unknown[]) => ({ artifacts: entries });
