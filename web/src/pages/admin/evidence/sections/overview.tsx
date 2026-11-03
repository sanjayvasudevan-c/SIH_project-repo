import { Link } from 'react-router-dom';
import type { AuditAnalyticsData, EngineRunsResponse, EngineRunStatus, EvidenceEnvelope, EvidenceSummary, TestStatus, WorkflowData } from '../../../../api/types';
import { formatDate, formatDateTime } from '../../../../lib/format';
import { daySpan, VolumeBars } from '../charts';
import { ago, agoSeconds, fmtInt, fmtMs } from '../format';
import { Kpi, Panel, panelState } from '../Panel';
import { useEvidence } from '../useEvidence';

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
  const workflow = useEvidence<EvidenceEnvelope<WorkflowData>>('workflow');
  const runs = useEvidence<EngineRunsResponse>('engine-runs', { pageSize: '1' });
  const audit = useEvidence<EvidenceEnvelope<AuditAnalyticsData>>('audit-analytics');
  const err = (q: { refetch: () => unknown }) => ({ message: RETRY_MESSAGE, onRetry: () => void q.refetch() });

  // Test verification
  const s = summary.data;
  const testHint = s ? (
    <>
      {s.status === 'STALE' ? `Recorded for ${short(s.artifactCommit)}; code now at ${short(s.commit)}` : s.headUnresolved ? 'Current code version could not be determined' : `Code version ${short(s.commit)}`}
      {s.detail ? <span className="block">{s.detail}</span> : null}
    </>
  ) : null;

  // Applications in flight
  const w = workflow.data?.data;

  // Scheduler: the latest recorded cycle, and whether anything has reported
  const sch = s?.scheduler;
  const noCycle = !!sch && sch.lastRunAt === null;
  const cycleRow = runs.data?.rows[0];
  const simulated = cycleRow && sch && cycleRow.startedAt === sch.lastRunAt ? cycleRow.simulatedToday : null;
  const stuck = sch?.stuckRuns ?? 0;
  const schedulerHint = sch && !noCycle ? (
    <>
      <span className="block">
        Started {formatDateTime(sch.lastRunAt)} IST ({ago(sch.lastRunAt)}) · took {fmtMs(sch.lastDurationMs)}
      </span>
      {simulated ? <span className="block">Simulated date {formatDate(simulated)}</span> : null}
      <span className="block">{sch.heartbeat ? `Last process heartbeat ${agoSeconds(sch.heartbeat.ageSeconds)}` : 'No scheduler process has reported to this database'}</span>
      <span className="block">
        {fmtInt(stuck)} stuck run{stuck === 1 ? '' : 's'}
      </span>
    </>
  ) : null;

  // Audit
  const integrity = audit.data?.data.integrity;

  // Trend
  const points = w?.volumeOverTime ?? [];
  const trendState = panelState(workflow, !!w && (w.submittedTotal === 0 || points.length === 0), !!w && w.submittedTotal > 0 && points.length === 1);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="flex flex-col gap-1">
          <Kpi
            label="Test verification"
            value={s ? TEST_WORDS[s.status] : ''}
            hint={testHint}
            emphasis={s ? TEST_EMPHASIS[s.status] : undefined}
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
            value={w ? fmtInt(w.processingTime.inFlightCount) : ''}
            hint={w ? `of ${fmtInt(w.submittedTotal)} submitted · ${fmtInt(w.processingTime.decidedCount)} decided` : null}
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
            value={sch?.lastStatus ? CYCLE_WORDS[sch.lastStatus] : ''}
            hint={schedulerHint}
            emphasis={sch?.lastStatus === 'FAILED' ? 'danger' : sch?.lastStatus === 'RUNNING' || stuck > 0 ? 'warning' : undefined}
            provenance={s?.provenance?.scheduler ?? null}
            scope="Latest recorded cycle · all dates"
            definition={[s?.definition?.scheduler, s?.definition?.stuckRuns].filter(Boolean).join('\n\n') || undefined}
            state={panelState(summary, false, noCycle)}
            insufficientMessage="No scheduler cycle has been recorded."
            error={err(summary)}
          />
          <TileLink to="/admin/evidence/scheduler">See the scheduler detail</TileLink>
        </div>
        <div className="flex flex-col gap-1">
          <Kpi
            label="Audit log integrity"
            value={integrity ? (integrity.ok ? 'Intact' : 'Broken') : ''}
            hint={integrity ? `${fmtInt(integrity.chainsChecked)} chains · ${fmtInt(integrity.rowsChecked)} rows checked · whole log` : null}
            emphasis={integrity && !integrity.ok ? 'danger' : undefined}
            provenance={audit.data?.provenance?.integrity ?? null}
            scope="Whole audit log · all dates"
            definition={audit.data?.definition?.integrity}
            state={panelState(audit, false)}
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
