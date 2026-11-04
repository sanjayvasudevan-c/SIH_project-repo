import { useState } from 'react';
import type {
  AssignmentData,
  AssignmentDecision,
  AssignmentOutcome,
  AssignmentTraceResponse,
  AssignmentTraceRow,
  EvidenceEnvelope,
  ExcludedBy,
} from '../../../../api/types';
import { EmptyState, ErrorState, Skeleton, Table, type Column } from '../../../../components/ui';
import { formatDateTime } from '../../../../lib/format';
import { fmtPts, sharedCap, UtilisationBars } from '../charts';
import { DateRange, useRange, type Range } from '../DateRange';
import { fmtInt, fmtPct, list, UNAVAILABLE } from '../format';
import { Kpi, Panel, panelState } from '../Panel';
import { ScrollHint } from '../ScrollHint';
import { useEnvelope, useEvidence } from '../useEvidence';

const RETRY_MESSAGE = 'These figures could not be loaded.';
const SPREAD_UNAVAILABLE = 'Unavailable (fewer than two officers)';

export const OUTCOME_WORDS: Record<AssignmentOutcome, string> = {
  ASSIGNED: 'Assigned to an officer',
  BUREAU_OVERFLOW: 'Assigned to the Bureau (no eligible officer in the region)',
  BLOCKED: 'No officer could be assigned',
};
const OUTCOME_ORDER: AssignmentOutcome[] = ['ASSIGNED', 'BUREAU_OVERFLOW', 'BLOCKED'];
export const EXCLUDED_WORDS: Record<ExcludedBy, string> = {
  UNAVAILABLE: 'Unavailable',
  BARRED: 'Barred',
  RECUSED: 'Recused',
  OVER_CAPACITY: 'Over capacity',
};
const TASK_WORDS: Record<string, string> = {
  SCRUTINY: 'Scrutiny',
  RE_SCRUTINY: 'Re-scrutiny',
  EVC_DESK: 'EVC desk review',
  VERIFY: 'Evidence verification',
  SAC_SHC_FORWARD: 'SAC/SHC forwarding',
};
const task = (t: string) => TASK_WORDS[t] ?? t;
const outcome = (o: string) => OUTCOME_WORDS[o as AssignmentOutcome] ?? o;
const excluded = (e: string) => EXCLUDED_WORDS[e as ExcludedBy] ?? e;

const rangeText = ({ from, to }: Range) => (from && to ? `${from} to ${to}` : from ? `from ${from}` : to ? `up to ${to}` : 'all dates');

export function AssignmentSection() {
  const { range, setRange, invalid } = useRange();
  // Group 1 is current state: its query carries no dates and so is never refetched when the range changes.
  const now = useEnvelope<EvidenceEnvelope<AssignmentData>>('assignment');
  // Group 2 is windowed. With no range chosen it has the same key as Group 1 and shares its one request.
  const period = useEnvelope<EvidenceEnvelope<AssignmentData>>('assignment', { from: range.from, to: range.to });
  const retry = (q: { refetch: () => unknown }) => ({ message: RETRY_MESSAGE, onRetry: () => void q.refetch() });

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <CurrentWorkload q={now} retry={retry(now)} />
      <DecisionsInPeriod q={period} retry={retry(period)} range={range} setRange={setRange} invalid={invalid} />
    </div>
  );
}

type Q = ReturnType<typeof useEnvelope<EvidenceEnvelope<AssignmentData>>>;
type Retry = { message: string; onRetry: () => void };

function CurrentWorkload({ q, retry }: { q: Q; retry: Retry }) {
  const d = q.data?.data;
  const def = q.data?.definition;
  const prov = q.data?.provenance;
  const kpiState = panelState(q, false);
  const spread = d?.spread;
  const cov = d?.coverage;
  const sorted = list(d?.officers)
    .filter((o) => o && typeof o === 'object')
    .sort((a, b) => (Number(b.utilisation) || 0) - (Number(a.utilisation) || 0) || String(a.name ?? '').localeCompare(String(b.name ?? '')));
  const over = d?.continuityOverrides;
  const common = { state: kpiState, error: retry };
  const nowScope = 'Current state · all officers now';

  return (
    <section aria-labelledby="workload-h" className="flex min-w-0 flex-col gap-4">
      <h2 id="workload-h" className="text-xl font-semibold">
        Current workload (current state — not affected by the dates)
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Officers counted"
          value={fmtInt(spread?.officerCount)}
          provenance={prov?.officers ?? null}
          scope="Current state · role OFFICER with capacity; committee and Bureau excluded"
          definition={def?.spread}
          {...common}
        />
        <Kpi label="Average utilisation" value={fmtPct(spread?.meanUtilisation)} hint="Open points over capacity points, averaged across the officers counted" provenance={prov?.utilisation ?? null} scope={nowScope} definition={def?.officers} {...common} />
        <Kpi
          label="Spread of utilisation"
          value={typeof spread?.stdDev === 'number' && Number.isFinite(spread.stdDev) ? spread.stdDev.toFixed(2) : SPREAD_UNAVAILABLE}
          hint="Standard deviation of utilisation; it describes how load is spread, not whether it is right"
          provenance={prov?.spread ?? null}
          scope={nowScope}
          definition={def?.spread}
          {...common}
        />
        <Kpi
          label="Decisions with an explanation"
          value={cov ? `${fmtInt(cov.tracedCount)} of ${fmtInt(cov.assignmentTotal)}` : ''}
          hint={cov ? `${fmtInt(cov.blockedCount)} found nobody eligible` : undefined}
          provenance={prov?.coverage ?? null}
          scope="All assignments · all dates"
          definition={def?.coverage}
          {...common}
        />
      </div>

      <Panel
        title="Utilisation by officer (open points as a share of capacity, highest first)"
        provenance={prov?.utilisation ?? null}
        scope={`${fmtInt(sorted.length)} officers · current state`}
        definition={def?.officers}
        state={panelState(q, !!d && sorted.length === 0)}
        emptyMessage="No officer with a capacity is recorded."
        error={retry}
      >
        <p className="mb-2 text-sm text-secondary">
          {sharedCap(sorted) !== null ? 'The dashed line is the normal cap. Red bars are above it.' : 'Officers do not all have the same normal cap, so no single cap line is drawn. Red bars are above that officer\'s own cap.'} With this many officers the chart is wider than the screen: scroll sideways inside it, or open the data table to read every officer.
        </p>
        <UtilisationBars label={`Utilisation of each of ${sorted.length} officers, with the normal cap`} officers={sorted} />
      </Panel>

      <Panel
        title="Officers above their normal cap"
        provenance={prov?.continuityOverrides ?? null}
        scope="Current state · officers whose utilisation is above their own cap"
        definition={def?.continuityOverrides}
        state={panelState(q, false)}
        error={retry}
      >
        {over ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-secondary">
              Allowed ceilings in the current rule pack: continuity {over.continuityUtilCap}, urgent task {over.urgentMaxUtil}.
            </p>
            {list(over.rows).length === 0 ? (
              <p className="text-base">No officer is above their normal cap.</p>
            ) : (
              <>
                {/* Below md each officer is a stacked card, so the explanation is read in full without scrolling sideways. */}
                <ul aria-label="Officers above their normal cap (cards)" className="flex flex-col gap-3 md:hidden">
                  {list(over.rows).map((r) => (
                    <li key={r.officerId} className="rounded-lg border p-3">
                      <p className="font-semibold">{r.officer}</p>
                      <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                        <dt className="text-secondary">Utilisation</dt>
                        <dd className="tnum text-right">{fmtPct(r.utilisation)}</dd>
                        <dt className="text-secondary">Normal cap</dt>
                        <dd className="tnum text-right">{fmtPct(r.normalCap)}</dd>
                      </dl>
                      <p className="mt-2 text-sm">
                        <span className="font-medium text-secondary">What this means: </span>
                        {r.text}
                      </p>
                    </li>
                  ))}
                </ul>
                <div className="hidden md:block">
                  <Table
                    caption="Officers above their normal cap"
                    rows={list(over.rows)}
                    rowKey={(r) => r.officerId}
                    emptyMessage="No officer is above their normal cap."
                    columns={[
                      { key: 'officer', header: 'Officer', render: (r) => r.officer, title: (r) => r.officer },
                      { key: 'util', header: 'Utilisation', align: 'right', render: (r) => fmtPct(r.utilisation) },
                      { key: 'cap', header: 'Normal cap', align: 'right', render: (r) => fmtPct(r.normalCap) },
                      { key: 'text', header: 'What this means', wrap: true, className: 'min-w-[18rem]', render: (r) => r.text },
                    ]}
                  />
                </div>
              </>
            )}
          </div>
        ) : null}
      </Panel>
    </section>
  );
}

function DecisionsInPeriod({ q, retry, range, setRange, invalid }: { q: Q; retry: Retry; range: Range; setRange: (r: Range) => void; invalid: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const d = q.data?.data;
  const def = q.data?.definition;
  const prov = q.data?.provenance;
  const scope = `Decisions recorded · ${rangeText(range)}`;
  const recent = list(d?.recentDecisions);
  const pick = recent.find((r) => r.traceId === selected) ?? null;
  const noDecisions = !!d && list(d.outcomes).length === 0 && !d.candidates?.candidatesConsidered;

  return (
    <section aria-labelledby="period-h" className="flex min-w-0 flex-col gap-4">
      <h2 id="period-h" className="text-xl font-semibold">
        Assignment decisions in the period
      </h2>
      <DateRange
        from={range.from}
        to={range.to}
        onChange={setRange}
        invalid={invalid}
        clockLabel="Dates are decision dates: the day each assignment decision was recorded. They apply only to this group; the current workload above never changes with them."
      />

      <Panel
        title="What was decided in the period"
        provenance={prov?.candidates ?? null}
        scope={scope}
        definition={def?.candidates}
        state={panelState(q, noDecisions)}
        emptyMessage="Nothing was counted: no decision was recorded in this date range."
        error={retry}
      >
        {d ? <PeriodSummary d={d} /> : null}
      </Panel>

      <Panel
        title="Why this officer? (the stored reason for each recent decision)"
        provenance={prov?.recentDecisions ?? null}
        scope={`${scope} · newest ${recent.length} shown`}
        definition={def?.recentDecisions}
        state={panelState(q, false, !!d && recent.length === 0)}
        insufficientMessage="No assignment decision was recorded in this date range, so there is nothing to explain."
        error={retry}
      >
        {d ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-secondary">
              Explanations are recorded for automatic assignments only: {fmtInt(d.coverage?.tracedCount)} of {fmtInt(d.coverage?.assignmentTotal)} assignments made in this period have one. A manual assignment or reassignment has none.
            </p>
            <DecisionList rows={recent} selected={pick?.traceId ?? null} onSelect={(r) => setSelected(r.traceId)} />
            {pick ? <Explanation decision={pick} /> : <p className="text-sm text-secondary">Select a decision to see every officer considered for it.</p>}
          </div>
        ) : null}
      </Panel>
    </section>
  );
}

function PeriodSummary({ d }: { d: AssignmentData }) {
  const c = d.candidates;
  const outcomes = list(d.outcomes);
  const excludedList = list(c?.excluded);
  const versions = list(d.rulePackVersions);
  return (
    <div data-testid="period-summary" className="flex flex-col gap-4">
      <div>
        <h4 className="text-sm font-semibold text-secondary">Decisions by outcome</h4>
        <ul className="mt-1 flex flex-col gap-1">
          {[...outcomes].sort((a, b) => OUTCOME_ORDER.indexOf(a.outcome) - OUTCOME_ORDER.indexOf(b.outcome)).map((o) => (
            <li key={o.outcome} className="flex items-baseline gap-2">
              <span className="tnum text-xl font-semibold">{fmtInt(o.count)}</span>
              <span>{outcome(o.outcome)}</span>
            </li>
          ))}
        </ul>
      </div>
      <p>
        Officers considered across these decisions: <span className="tnum font-semibold">{fmtInt(c?.candidatesConsidered)}</span>, of which <span className="tnum font-semibold">{fmtInt(c?.eligible)}</span> were eligible. Excluded:{' '}
        {excludedList.length === 0 ? 'none' : excludedList.map((e) => `${fmtInt(e.count)} ${excluded(e.reason).toLowerCase()}`).join(', ')}.
      </p>
      <p className="text-sm text-secondary">
        Assignments made in the period, by rule pack version: {versions.length === 0 ? 'none' : versions.map((v) => `${v.label}: ${fmtInt(v.assignments)}`).join(' · ')}.
      </p>
    </div>
  );
}

function DecisionList({ rows, selected, onSelect }: { rows: AssignmentDecision[]; selected: string | null; onSelect: (r: AssignmentDecision) => void }) {
  const columns: Column<AssignmentDecision>[] = [
    { key: 'when', header: 'Decided', render: (r) => formatDateTime(r.decidedAt), title: (r) => r.decidedAt },
    { key: 'app', header: 'Application', render: (r) => r.applicationNo ?? 'Unknown', title: (r) => r.applicationNo ?? '' },
    { key: 'task', header: 'Task', render: (r) => task(r.taskType) },
    { key: 'outcome', header: 'Outcome', wrap: true, render: (r) => outcome(r.outcome) },
    { key: 'officer', header: 'Chosen officer', render: (r) => r.chosenOfficer ?? 'None', title: (r) => r.chosenOfficer ?? '' },
    { key: 'cons', header: 'Considered', align: 'right', render: (r) => fmtInt(r.considered) },
    { key: 'elig', header: 'Eligible', align: 'right', render: (r) => fmtInt(r.eligible) },
    { key: 'open', header: 'Explanation', render: (r) => (r.traceId === selected ? 'Shown below' : 'Show candidates') },
  ];
  return (
    <>
    <Table
      caption="Recent assignment decisions"
      rows={rows}
      rowKey={(r) => r.traceId}
      columns={columns}
      selectedKey={selected}
      onRowClick={onSelect}
      rowLabel={(r) => `Show how ${r.applicationNo ?? 'this application'} ${task(r.taskType)} was decided`}
      emptyMessage="No decisions."
    />
    <ScrollHint />
    </>
  );
}

function Explanation({ decision }: { decision: AssignmentDecision }) {
  const t = useEvidence<AssignmentTraceResponse>(`assignment-trace/${decision.applicationId}`);
  if (t.isPending) return <Skeleton lines={3} />;
  if (t.isError) return <ErrorState message="This explanation could not be loaded." onRetry={() => void t.refetch()} />;
  // The endpoint returns every decision recorded for the application; show the one that was selected.
  const row: AssignmentTraceRow | undefined = list(t.data?.rows).find((r) => r.id === decision.traceId);
  if (!row) return <EmptyState message="No decision table is stored for this decision." />;
  const blocked = row.outcome === 'BLOCKED';
  return (
    <div className="flex flex-col gap-3">
      <h4 className="text-base font-semibold">
        {decision.applicationNo ?? 'Application'} · {task(row.taskType)} · {outcome(row.outcome)}
      </h4>
      {blocked ? <p className="text-base">No officer could be assigned. Every officer considered was excluded, for the reason shown against their name.</p> : null}
      <CandidateTable row={row} />
      <div>
        <h5 className="text-sm font-semibold text-secondary">Reason recorded with the decision</h5>
        <p className="mt-1 max-w-prose whitespace-pre-line">{row.reasonText}</p>
      </div>
    </div>
  );
}

function CandidateTable({ row }: { row: AssignmentTraceRow }) {
  const candidates = list(row.candidates);
  const heads = ['Officer', 'Tier', 'Eligible', 'Excluded by', 'Capacity', 'Open points', 'Utilisation after this task', 'Score', 'Chosen'];
  const num = new Set(['Tier', 'Capacity', 'Open points', 'Utilisation after this task', 'Score']);
  return (
    <div className="max-h-96 overflow-auto rounded-lg border" tabIndex={0} role="region" aria-label="Candidates considered (scrolls sideways)">
      <table className="w-full min-w-[44rem] border-collapse text-sm">
        <caption className="sr-only">Candidates considered for this decision</caption>
        <thead className="sticky top-0 bg-subtle">
          <tr>
            {heads.map((h) => (
              <th key={h} scope="col" className={`px-3 py-2 text-xs font-semibold text-secondary ${num.has(h) ? 'text-right' : 'text-left'}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {candidates.length === 0 ? (
            <tr className="border-t">
              <td colSpan={heads.length} className="px-3 py-2">
                No candidates are stored for this decision.
              </td>
            </tr>
          ) : null}
          {candidates.map((c, i) => (
            <tr key={c.officerId ?? i} className={`border-t ${c.chosen ? 'bg-accent-soft font-semibold' : ''}`}>
              <td className="px-3 py-2">{c.name}</td>
              <td className="tnum px-3 py-2 text-right">{c.tier}</td>
              <td className="px-3 py-2">{c.eligible ? 'Yes' : 'No'}</td>
              <td className="px-3 py-2">{c.excludedBy ? excluded(c.excludedBy) : '—'}</td>
              <td className="tnum px-3 py-2 text-right">{fmtPts(c.capacity)}</td>
              <td className="tnum px-3 py-2 text-right">{fmtPts(c.openPoints)}</td>
              <td className="tnum px-3 py-2 text-right">{fmtPct(c.projectedUtil)}</td>
              <td className="tnum px-3 py-2 text-right">{typeof c.score === 'number' && Number.isFinite(c.score) ? c.score.toFixed(3) : UNAVAILABLE}</td>
              <td className="px-3 py-2">{c.chosen ? 'Chosen' : 'Not chosen'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ScrollHint />
    </div>
  );
}
