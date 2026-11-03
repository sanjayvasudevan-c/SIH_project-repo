// Test data shaped like the live /evidence responses (read from the dev API), trimmed.
import type { EngineRunsResponse, EvidenceEnvelope, EvidenceSummary, WorkflowData } from '../../../../api/types';

const STARTED = new Date(Date.now() - 4 * 3600_000).toISOString();

export const DEFS = {
  status: 'STATUS DEF: only PASS means the checks were verified for this code version.',
  scheduler: 'SCHEDULER DEF: two separate facts, the latest cycle and the heartbeat.',
  stuckRuns: 'STUCK DEF: runs still marked running after 15 minutes.',
  funnel: 'FUNNEL DEF: distinct applications that have reached each stage.',
  statusDistribution: 'STATUSDIST DEF: counts add up to the submitted total.',
  processingTime: 'PROCESSING DEF: median working days, decided only; no mean is given.',
  volumeOverTime: 'VOLUME DEF: the overdue points sit on the due date, not the From/To range.',
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
