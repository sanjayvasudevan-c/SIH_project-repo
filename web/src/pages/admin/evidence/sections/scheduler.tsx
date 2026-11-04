import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ComplianceEnvelope, EngineRunDetailRow, EngineRunsDetailResponse, EvidenceSummary, RunProvenance } from '../../../../api/types';
import { Button, Table, type Column } from '../../../../components/ui';
import { formatDate, formatDateTime } from '../../../../lib/format';
import tokens from '../../../../lib/chartTokens';
import { HorizontalBars, RunDurationBars, SegmentedBar, wrapLabel } from '../charts';
import { DateRange, useRange, type Range } from '../DateRange';
import { agoSeconds, fmtInt, fmtMs, fmtPct, list, RUN_STATUS_WORDS } from '../format';
import { Kpi, Panel, panelState } from '../Panel';
import { useEnvelope, useEvidence } from '../useEvidence';

const RETRY_MESSAGE = 'These figures could not be loaded.';
const NO_RUNS = 'No engine run is dated in this range.';
const SOURCE_WORDS: Record<RunProvenance, string> = { SIMULATED: 'Simulated clock', LIVE_DEMO: 'Real clock', TEST_RUN: 'Automated test', BENCHMARK: 'Load test' };
const rangeText = ({ from, to }: Range) => (from && to ? `${from} to ${to}` : from ? `from ${from}` : to ? `up to ${to}` : 'all dates');

export function SchedulerSection() {
  const { range, setRange, invalid } = useRange();
  const [pageNo, setPageNo] = useState(1);
  // Group 1 is current state: no dates, so it is never refetched when the range changes.
  const comp = useEnvelope<ComplianceEnvelope>('compliance');
  const runs = useEvidence<EngineRunsDetailResponse>('engine-runs', { from: range.from, to: range.to, page: pageNo > 1 ? String(pageNo) : undefined });
  const summary = useEvidence<EvidenceSummary>('summary');
  const retry = (q: { refetch: () => unknown }) => ({ message: RETRY_MESSAGE, onRetry: () => void q.refetch() });

  // ── Group 1
  const d = comp.data?.data?.deadlines;
  const cdef = comp.data?.definition?.deadlines ?? {};
  const cprov = comp.data?.provenance?.deadlines ?? null;
  const asOf = comp.data?.data?.asOf;
  const nowScope = `Current state · as of ${asOf ?? '…'}`;
  const sums = !!d && d.overdue + d.atRisk + d.dueSoon + d.onTrack === d.openTotal;
  const segments = d
    ? [
        { key: 'overdue', word: 'Overdue', count: d.overdue, fill: tokens.danger },
        { key: 'atRisk', word: 'At risk', count: d.atRisk, fill: tokens.warning },
        { key: 'dueSoon', word: 'Due soon', count: d.dueSoon, fill: tokens.accent },
        { key: 'onTrack', word: 'On track', count: d.onTrack, fill: tokens.neutral },
      ]
    : [];
  const stateDef = ['asOf', 'overdue', 'atRisk', 'dueSoon', 'onTrack', 'met'].map((k) => cdef[k]).filter(Boolean).join('\n\n') || undefined;
  const openState = panelState(comp, !!d && d.openTotal === 0, !!d && d.openTotal > 0 && !sums);
  const kState = panelState(comp, !!d && d.openTotal === 0);

  // ── Group 2
  const r = runs.data;
  const t = r?.totals;
  const rows = list(r?.rows);
  const none = !!t && t.runCount === 0;
  const rscope = `${rangeText(range)} · by the date the engine treated as today`;
  const rdef = r?.definition;
  const rprov = r?.provenance;
  const failedIds = rows.filter((x) => x.status === 'FAILED').map((x) => x.id);
  const pages = r && r.pageSize > 0 && Number.isFinite(r.total) ? Math.max(1, Math.ceil(r.total / r.pageSize)) : 1;
  const rState = panelState(runs, false, none);
  const changeRange = (n: Range) => {
    setPageNo(1);
    setRange(n);
  };

  const hb = summary.data?.scheduler?.heartbeat;
  // Missing is not zero: a stuck-run count the response does not carry reads Unavailable.
  const stuckRaw = summary.data?.scheduler?.stuckRuns;
  const stuck = typeof stuckRaw === 'number' ? stuckRaw : null;

  const columns: Column<EngineRunDetailRow>[] = [
    { key: 'id', header: 'Run', render: (x) => x.id },
    { key: 'started', header: 'Started (real time)', render: (x) => formatDateTime(x.startedAt) },
    { key: 'dur', header: 'Duration', align: 'right', render: (x) => fmtMs(x.durationMs) },
    { key: 'status', header: 'Status', render: (x) => RUN_STATUS_WORDS[x.status] ?? x.status },
    { key: 'inst', header: 'Instance', render: (x) => x.instanceId },
    { key: 'sim', header: 'Simulated date', render: (x) => formatDate(x.simulatedToday) },
    { key: 'items', header: 'Items checked', align: 'right', render: (x) => fmtInt(x.itemsChecked) },
    { key: 'created', header: 'Alerts created', align: 'right', render: (x) => fmtInt(x.alertsCreated) },
    { key: 'supp', header: 'Duplicates prevented', align: 'right', render: (x) => fmtInt(x.alertsSuppressed) },
    { key: 'src', header: 'Source', render: (x) => SOURCE_WORDS[x.provenance] ?? x.provenance },
    { key: 'err', header: 'Error', wrap: true, render: (x) => x.error ?? '—' },
  ];

  const runKpi = { provenance: rprov?.totals ?? null, scope: rscope, state: rState, insufficientMessage: NO_RUNS, error: retry(runs) };

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="open-h" className="flex flex-col gap-4">
        <h2 id="open-h" className="text-xl font-semibold">
          Open deadlines now (as of {asOf ?? '…'} — not affected by the dates)
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Kpi label="Overdue now" value={fmtInt(d?.overdue)} emphasis="danger" hint={d ? `of ${fmtInt(d.openTotal)} open` : undefined} provenance={cprov} scope={nowScope} definition={cdef.overdue} state={kState} emptyMessage="No open deadline items." error={retry(comp)} />
          <Kpi label="At risk now" value={fmtInt(d?.atRisk)} emphasis="warning" hint={d ? `of ${fmtInt(d.openTotal)} open` : undefined} provenance={cprov} scope={nowScope} definition={cdef.atRisk} state={kState} emptyMessage="No open deadline items." error={retry(comp)} />
        </div>
        <Panel
          title="Open deadline items by state (count of items)"
          provenance={cprov}
          scope={`${fmtInt(d?.openTotal)} open items · ${nowScope}`}
          definition={stateDef}
          state={openState}
          emptyMessage="No open deadline items."
          insufficientMessage="The four states do not add up to the open total, so the split is not shown."
          error={retry(comp)}
        >
          {d ? (
            <>
              <SegmentedBar label={`Open deadline items by state: ${segments.map((g) => `${g.word} ${g.count}`).join(', ')}, of ${d.openTotal} open`} total={d.openTotal} segments={segments} />
              <ul aria-label="Open states" className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                {segments.map((g) => (
                  <li key={g.key} className="flex items-center gap-2">
                    <span aria-hidden className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: g.fill }} />
                    <span>
                      <span className="font-medium">{g.word}</span> — <span className="tnum">{fmtInt(g.count)} ({fmtPct(g.count / d.openTotal)})</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm text-secondary">
                Outside the open total: {fmtInt(d.met)} met · {fmtInt(d.missed)} missed · {fmtInt(d.paused)} paused · {fmtInt(d.closed)} closed
              </p>
            </>
          ) : null}
        </Panel>
      </section>

      <section aria-labelledby="runs-h" className="flex flex-col gap-4">
        <h2 id="runs-h" className="text-xl font-semibold">
          Engine run history (by the date the engine treated as today)
        </h2>
        <DateRange from={range.from} to={range.to} onChange={changeRange} invalid={invalid} clockLabel="Dates are the date the engine treated as today when each run happened (the simulated date in this demo), not the real time the run started. They select the runs in this group only; the open deadlines above are not affected." />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Runs recorded" value={fmtInt(t?.runCount)} definition={rdef?.totals} {...runKpi} />
          <Kpi label="Failed runs" value={fmtInt(t?.failedCount)} emphasis={t && t.failedCount > 0 ? 'danger' : undefined} hint="Runs that ended in failure" definition={rdef?.totals} {...runKpi} />
          <Kpi label="Abandoned runs" value={fmtInt(t?.abandonedCount)} emphasis={t && t.abandonedCount > 0 ? 'warning' : undefined} hint="still marked running after 15 minutes — a crash cannot update its own row" definition={rdef?.abandoned} {...runKpi} />
          <Kpi
            label="Latest process check-in"
            value={hb ? agoSeconds(hb.ageSeconds) : 'None reported'}
            hint={
              <>
                <span className="block">{hb ? `Last process heartbeat ${agoSeconds(hb.ageSeconds)}` : 'No scheduler instance marked as leader has reported to this database'}</span>
                <span className="block">{stuck === null ? 'Stuck runs: Unavailable' : `${fmtInt(stuck)} stuck run${stuck === 1 ? '' : 's'}`}</span>
              </>
            }
            provenance={summary.data?.provenance?.scheduler ?? null}
            scope="Current state · not affected by the dates"
            definition={[summary.data?.definition?.scheduler, summary.data?.definition?.stuckRuns].filter(Boolean).join('\n\n') || undefined}
            state={panelState(summary, false)}
            error={retry(summary)}
          />
        </div>

        <Panel
          title="Duration of each run (how long each cycle took, oldest run on the left)"
          provenance={rprov?.rows ?? null}
          scope={`${fmtInt(rows.length)} runs on this page · ${rscope} · run order, not a time axis`}
          definition={rdef?.rows}
          state={rState}
          insufficientMessage={NO_RUNS}
          error={retry(runs)}
        >
          <p className="mb-2 text-sm text-secondary">Bars follow run order. All demo runs share one real day, so the horizontal axis is the run number, not a date; the simulated date of each run is in the tooltip and the table.</p>
          <RunDurationBars label={`Duration of each of ${rows.length} engine runs, oldest on the left`} rows={rows} />
          <p className="mt-2 text-sm text-secondary">{failedIds.length ? `Failed runs (drawn in red): ${failedIds.join(', ')}` : 'No run on this page failed.'}</p>
        </Panel>

        <Panel
          title="Duplicate alerts prevented (count of alerts, all runs in the range)"
          provenance={rprov?.totals ?? null}
          scope={rscope}
          definition={[rdef?.alertsCreated, rdef?.alertsSuppressed].filter(Boolean).join('\n\n') || undefined}
          state={panelState(runs, false, none || (!!t && t.alertsCreated === null))}
          insufficientMessage={NO_RUNS}
          error={retry(runs)}
        >
          <HorizontalBars
            label="Alerts created by the runs, and duplicate alerts the runs declined to create"
            rows={[
              { label: 'Alerts created', count: t?.alertsCreated ?? null },
              { label: 'Duplicates prevented', count: t?.alertsSuppressed ?? null },
            ]}
            categoryKey="label"
            categoryHeader="Measure"
            valueKey="count"
            valueHeader="Alerts"
            rowHeight={48}
            lines={(x) => wrapLabel(String(x.label), 18)}
          />
          <p className="mt-2 max-w-prose text-sm text-secondary">
            The alert log&apos;s unique key lets the engine decide to alert once per item, kind and level, so a repeated cycle creates no second alert. These were prevented, not delivered twice: there is no external delivery channel. The created count should match &quot;Alerts raised&quot; in the{' '}
            <Link to="/admin/evidence/alerts" className="text-accent hover:underline">
              Alerts section
            </Link>{' '}
            for the same dates when every alert came from a recorded run (see the definition).
          </p>
        </Panel>

        <Panel title="Recent engine runs" provenance={rprov?.rows ?? null} scope={`${fmtInt(r?.total)} runs · ${rscope} · newest first`} definition={rdef?.rows} state={rState} insufficientMessage={NO_RUNS} error={retry(runs)}>
          <Table caption="Recent engine runs" rows={rows} rowKey={(x) => x.id} columns={columns} pageSize={200} emptyMessage={NO_RUNS} />
          {pages > 1 ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <Button variant="secondary" disabled={pageNo <= 1} onClick={() => setPageNo(pageNo - 1)} aria-label="Previous page of runs">
                Previous
              </Button>
              <span className="tnum">
                Page {pageNo} of {pages}
              </span>
              <Button variant="secondary" disabled={pageNo >= pages} onClick={() => setPageNo(pageNo + 1)} aria-label="Next page of runs">
                Next
              </Button>
            </div>
          ) : null}
        </Panel>
      </section>
    </div>
  );
}
