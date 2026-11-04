import { Link } from 'react-router-dom';
import type { AuditAnalyticsData, EngineRunsResponse, EngineRunStatus, EvidenceEnvelope, EvidenceSummary, TestStatus, WorkflowData } from '../../../../api/types';
import { formatDate, formatDateTime } from '../../../../lib/format';
import { daySpan, VolumeBars } from '../charts';
import { ago, agoSeconds, fmtInt, fmtMs, list } from '../format';
import { Kpi, Panel, panelState } from '../Panel';
import { useEnvelope, useEvidence } from '../useEvidence';

const TEST_WORDS: Record<TestStatus, string> = { PASS: 'Passed', FAIL: 'Failed', STALE: 'Out of date', NOT_VERIFIED: 'Not verified' };
const TEST_EMPHASIS: Record<TestStatus, 'danger' | 'warning' | undefined> = { PASS: undefined, FAIL: 'danger', STALE: 'warning', NOT_VERIFIED: 'warning' };
// Words for how the latest recorded cycle ended. None of them claims anything about the scheduler process itself.
const CYCLE_WORDS: Record<EngineRunStatus, string> = { OK: 'Finished', FAILED: 'Failed', RUNNING: 'Started, not finished' };
const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : 'unknown');
const RETRY_MESSAGE = 'These figures could not be loaded.';

function TileLink({ to, children }: { to: string; children: string }) {
  return (
    <Link to={to} className="hit text-sm text-accent hover:underline">
      {children}
    </Link>
  );
}

/** The four headline tiles and one trend. The tiles read the same queries the detail sections read. */
export function OverviewSection() {
  const summary = useEvidence<EvidenceSummary>('summary');
  const workflow = useEnvelope<EvidenceEnvelope<WorkflowData>>('workflow');
  const runs = useEvidence<EngineRunsResponse>('engine-runs', { pageSize: '1' });
  const audit = useEnvelope<EvidenceEnvelope<AuditAnalyticsData>>('audit-analytics');
  const err = (q: { refetch: () => unknown }) => ({ message: RETRY_MESSAGE, onRetry: () => void q.refetch() });

  // Test verification. A status this page has no word for is named, never shown as an empty value.
  const s = summary.data;
  const knownStatus = !!s && Object.hasOwn(TEST_WORDS, s.status);
  const testValue = !s ? '' : knownStatus ? TEST_WORDS[s.status] : `Unknown status: ${String(s.status)}`;
  const testEmphasis = !s ? undefined : knownStatus ? TEST_EMPHASIS[s.status] : 'warning';
  const testHint = s ? (
    <>
      {s.status === 'STALE' ? `Recorded for ${short(s.artifactCommit)}; code now at ${short(s.commit)}` : s.headUnresolved ? 'Current code version could not be determined' : `Code version ${short(s.commit)}`}
      {s.detail ? <span className="block">{s.detail}</span> : null}
    </>
  ) : null;

  // Applications in flight
  const w = workflow.data?.data;
  const pt = w?.processingTime;

  // Scheduler: the latest recorded cycle, and whether anything has reported
  const sch = s?.scheduler;
  const noSchedulerBlock = !!s && !sch;
  const noCycle = noSchedulerBlock || (!!sch && (sch.lastRunAt === null || sch.lastRunAt === undefined));
  const cycleRow = list(runs.data?.rows)[0];
  const simulated = cycleRow && sch && cycleRow.startedAt === sch.lastRunAt ? cycleRow.simulatedToday : null;
  // Missing is not zero: a stuck-run count the response does not carry reads Unavailable.
  const stuck = typeof sch?.stuckRuns === 'number' ? sch.stuckRuns : null;
  const schedulerHint = sch && !noCycle ? (
    <>
      <span className="block">
        Started {formatDateTime(sch.lastRunAt)} IST ({ago(sch.lastRunAt)}) · took {fmtMs(sch.lastDurationMs)}
      </span>
      {simulated ? <span className="block">Simulated date {formatDate(simulated)}</span> : null}
      <span className="block">{sch.heartbeat ? `Last process heartbeat ${agoSeconds(sch.heartbeat.ageSeconds)}` : 'No scheduler instance marked as leader has reported to this database'}</span>
      <span className="block">{stuck === null ? 'Stuck runs: Unavailable' : `${fmtInt(stuck)} stuck run${stuck === 1 ? '' : 's'}`}</span>
    </>
  ) : null;

  // Audit
  const integrity = audit.data?.data?.integrity;
  const emptyLog = !!integrity && integrity.rowsChecked === 0;

  // Trend
  const points = list(w?.volumeOverTime);
  const trendState = panelState(workflow, !!w && (w.submittedTotal === 0 || points.length === 0), !!w && w.submittedTotal > 0 && points.length === 1);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="flex flex-col gap-1">
          <Kpi
            label="Test verification"
            value={testValue}
            hint={testHint}
            emphasis={testEmphasis}
            provenance={s?.provenance?.status ?? null}
            scope="Whole system · latest recorded test result"
            definition={s?.definition?.status}
            state={panelState(summary, false)}
            error={err(summary)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Kpi
            label="Applications in flight"
            value={w ? fmtInt(pt?.inFlightCount) : ''}
            hint={w ? `of ${fmtInt(w.submittedTotal)} submitted · ${fmtInt(pt?.decidedCount)} decided` : null}
            provenance={workflow.data?.provenance?.processingTime ?? null}
            scope={`n = ${fmtInt(w?.submittedTotal)} applications · all dates`}
            definition={workflow.data?.definition?.processingTime}
            state={panelState(workflow, false)}
            error={err(workflow)}
          />
          <TileLink to="/admin/evidence/workflow">See the workflow detail</TileLink>
        </div>
        <div className="flex flex-col gap-1">
          <Kpi
            label="Last recorded scheduler cycle"
            value={sch?.lastStatus ? (CYCLE_WORDS[sch.lastStatus] ?? `Unknown status: ${String(sch.lastStatus)}`) : ''}
            hint={schedulerHint}
            emphasis={sch?.lastStatus === 'FAILED' ? 'danger' : sch?.lastStatus === 'RUNNING' || (stuck !== null && stuck > 0) ? 'warning' : undefined}
            provenance={s?.provenance?.scheduler ?? null}
            scope="Latest recorded cycle · all dates"
            definition={[s?.definition?.scheduler, s?.definition?.stuckRuns].filter(Boolean).join('\n\n') || undefined}
            state={panelState(summary, false, noCycle)}
            insufficientMessage={noSchedulerBlock ? "Unavailable: the response did not include scheduler information." : "No scheduler cycle has been recorded."}
            error={err(summary)}
          />
          <TileLink to="/admin/evidence/scheduler">See the scheduler detail</TileLink>
        </div>
        <div className="flex flex-col gap-1">
          <Kpi
            label="Audit log integrity"
            value={integrity ? (emptyLog ? 'Nothing to check' : integrity.ok === true ? 'Intact' : integrity.ok === false ? 'Broken' : 'Unavailable') : ''}
            hint={integrity ? (emptyLog ? 'Nothing to check — the audit log is empty' : `${fmtInt(integrity.chainsChecked)} chains · ${fmtInt(integrity.rowsChecked)} rows checked · whole log`) : null}
            emphasis={integrity && !emptyLog && !integrity.ok ? 'danger' : undefined}
            provenance={audit.data?.provenance?.integrity ?? null}
            scope="Whole audit log · all dates"
            definition={audit.data?.definition?.integrity}
            state={panelState(audit, false, !!audit.data?.data && !integrity)}
            insufficientMessage="Unavailable: the response did not include the integrity check."
            error={err(audit)}
          />
          <TileLink to="/admin/evidence/audit">See the audit detail</TileLink>
        </div>
      </div>

      <Panel
        title="Applications submitted and decided per day (count of applications)"
        provenance={workflow.data?.provenance?.volumeOverTime ?? null}
        scope={`n = ${fmtInt(w?.submittedTotal)} applications · all dates${points.length ? ` · ${daySpan(points)} · days with no events are not shown` : ''}`}
        definition={workflow.data?.definition?.volumeOverTime}
        state={trendState}
        emptyMessage="No applications have been submitted yet."
        insufficientMessage="A trend needs at least two days with events; only one has been recorded."
        error={err(workflow)}
      >
        <VolumeBars label={`Applications submitted and decided per day, ${daySpan(points)}`} points={points} series={['submitted', 'decided']} />
      </Panel>
    </div>
  );
}
