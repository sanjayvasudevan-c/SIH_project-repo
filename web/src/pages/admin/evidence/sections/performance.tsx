import { useState } from 'react';
import type { ArtifactsResponse, Provenance } from '../../../../api/types';
import { Field, Select } from '../../../../components/ui';
import { formatDate } from '../../../../lib/format';
import { CompareBars, CycleBars, fmtSec, LatencyBars } from '../chartsPerf';
import { fmtInt } from '../format';
import { Panel, panelState } from '../Panel';
import { useEvidence } from '../useEvidence';
import { comparableRuns, FIELD_WORDS, readRuns, type Run } from './perfModel';

const RETRY_MESSAGE = 'These figures could not be loaded.';
const NO_RESULTS = 'No benchmark results are available: no readable benchmark-results/*.json file was found, so nothing is shown. Nothing is shown as zero; the result is not verified.';
const NOT_RECORDED = 'not recorded in this run';
const when = (r: Run) => `${formatDate(r.date)} (UTC)`;
const or = <T,>(v: T | undefined, f: (x: T) => string) => (v === undefined ? NOT_RECORDED : f(v));
const uniform = (r: Run, k: 'requests' | 'concurrency') => (new Set(r.reads.map((x) => x[k])).size === 1 ? fmtInt(r.reads[0]![k]) : 'varies by screen');

const repeatsWord = (r: Run) => (r.repeats === undefined ? 'repeat count not recorded' : r.repeats === 1 ? 'a single run (repeat count 1)' : `repeated ${r.repeats} times`);

/** What the files say about CPU and memory use, run by run. The sentence stays the same when no run measured it. */
function resourceNote(runs: Run[]): string {
  if (runs.length > 0 && runs.every((r) => r.resourceUseMeasured === false)) return `CPU and memory use during the run${runs.length === 1 ? ' was' : 's were'} not measured.`;
  if (runs.length > 0 && runs.every((r) => r.resourceUseMeasured === true)) return 'CPU and memory use during the runs is recorded in the benchmark files; this page does not chart it.';
  return `CPU and memory use: ${runs.map((r) => `${r.commit} ${r.resourceUseMeasured === undefined ? 'not recorded' : r.resourceUseMeasured ? 'recorded in the file' : 'not measured'}`).join('; ')}.`;
}

/** What the files say about repeats, run by run. Variance is only ever claimed absent when no run repeated. */
function repeatNote(runs: Run[]): string {
  if (runs.length > 0 && runs.every((r) => r.repeats === 1)) return `${runs.length === 1 ? 'The run is' : 'Each run is'} a single run (repeat count 1): there is no repeat, so no variance can be stated.`;
  const per = runs.map((r) => `${r.commit} ${repeatsWord(r)}`).join('; ');
  return runs.some((r) => (r.repeats ?? 0) > 1) ? `Repeats: ${per}. This page shows one figure per measure and does not compute variance.` : `Repeats: ${per}. Where a run was not repeated or does not record repeats, no variance can be stated.`;
}

function environment(r: Run): string {
  const m = r.machine;
  return [
    m.cpus === undefined ? 'CPU cores not recorded' : `${m.cpus} CPU cores`,
    m.cpuModel ?? 'CPU model not recorded',
    m.memoryGb === undefined ? 'memory not recorded' : `${m.memoryGb} GB memory`,
    m.node ? `Node ${m.node}` : 'Node version not recorded',
    r.pgVersion ? `PostgreSQL ${r.pgVersion}` : 'PostgreSQL version not recorded',
  ].join(', ');
}

function ConfigTable({ runs }: { runs: Run[] }) {
  const rows: [string, (r: Run) => string][] = [
    ['Commit', (r) => r.commit],
    ['Date run', when],
    ['CPU model', (r) => or(r.machine.cpuModel, String)],
    ['CPU cores', (r) => or(r.machine.cpus, fmtInt)],
    ['Memory', (r) => or(r.machine.memoryGb, (g) => `${g} GB`)],
    ['Node', (r) => or(r.machine.node, String)],
    ['Operating system', (r) => or(r.machine.os, String)],
    ['PostgreSQL', (r) => or(r.pgVersion, String)],
    ['Applications', (r) => fmtInt(r.applications)],
    ['Deadline items (open)', (r) => (r.deadlineItems === undefined ? NOT_RECORDED : `${fmtInt(r.deadlineItems)} (${or(r.openDeadlineItems, fmtInt)})`)],
    ['Requests per screen', (r) => uniform(r, 'requests')],
    ['Concurrency', (r) => uniform(r, 'concurrency')],
    ['Repeats', (r) => or(r.repeats, fmtInt)],
    ['CPU and memory use', (r) => (r.resourceUseMeasured === undefined ? NOT_RECORDED : r.resourceUseMeasured ? 'recorded in the file' : 'not measured')],
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed text-left text-sm">
        <caption className="sr-only">Test configuration of each benchmark run</caption>
        <thead>
          <tr className="border-b">
            <td className="px-2 py-1" />
            {runs.map((r) => (
              <th key={r.commit} scope="col" className="px-2 py-1 font-medium text-secondary">
                Run {r.commit}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, get]) => (
            <tr key={label} className="border-b last:border-0">
              <th scope="row" className="px-2 py-1 font-medium text-secondary">{label}</th>
              {runs.map((r) => {
                const v = get(r);
                return (
                  <td key={r.commit} className={`tnum break-words px-2 py-1 ${v === NOT_RECORDED ? 'italic text-muted' : ''}`}>
                    {v}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface Slower {
  main: { slower: number; total: number };
  all: { slower: number; total: number };
  notSlower: string[];
}
/**
 * Where the latest run is slower than the one before it. "main" is what the comparison shows (p95 per screen and the two
 * cycle durations); "all" adds every p50 and p99. Nothing is averaged: each measure is compared with its own counterpart.
 */
function slowerCount(prev: Run, latest: Run): Slower {
  const out: Slower = { main: { slower: 0, total: 0 }, all: { slower: 0, total: 0 }, notSlower: [] };
  const cmp = (label: string, a: number | undefined, b: number | undefined, main: boolean) => {
    if (a === undefined || b === undefined) return;
    for (const t of main ? [out.main, out.all] : [out.all]) {
      t.total += 1;
      if (b > a) t.slower += 1;
    }
    if (!(b > a)) out.notSlower.push(label);
  };
  for (const r of latest.reads) {
    const p = prev.reads.find((x) => x.screen === r.screen);
    cmp(`${r.screen} p50`, p?.p50ms, r.p50ms, false);
    cmp(`${r.screen} p95`, p?.p95ms, r.p95ms, true);
    cmp(`${r.screen} p99`, p?.p99ms, r.p99ms, false);
  }
  cmp('first cycle', prev.first.ms, latest.first.ms, true);
  cmp('second cycle', prev.second.ms, latest.second.ms, true);
  return out;
}

export function PerformanceSection() {
  const q = useEvidence<ArtifactsResponse>('artifacts');
  const { runs, unreadable } = readRuns(Array.isArray(q.data?.artifacts) ? q.data.artifacts : []);
  const [picked, setPicked] = useState<string | null>(null);
  const run = runs.find((r) => r.commit === picked) ?? runs[runs.length - 1];
  const none = !!q.data && runs.length === 0;
  const error = { message: RETRY_MESSAGE, onRetry: () => void q.refetch() };
  const prov = (run?.provenance ?? 'BENCHMARK') as Provenance;
  const synthetic = run ? `${fmtInt(run.applications)} synthetic applications` : 'synthetic data';
  const runScope = run ? `Run ${run.commit} · ${when(run)} · ${uniform(run, 'requests')} requests per screen at concurrency ${uniform(run, 'concurrency')} · ${synthetic}` : 'Benchmark runs';
  const common = { provenance: prov, insufficientMessage: NO_RESULTS, error, state: panelState(q, false, none) };

  const latest = runs[runs.length - 1];
  const prev = runs[runs.length - 2];
  const cmp = latest && prev ? comparableRuns(prev, latest) : null;
  const compareState = panelState(q, false, runs.length < 2);
  const insufficient = runs.length === 0 ? NO_RESULTS : `Insufficient data: ${runs.length} benchmark run is on record. A comparison needs at least two runs on the same machine, and one run says nothing about variance.`;
  const count = latest && prev && cmp?.ok ? slowerCount(prev, latest) : null;

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-prose text-base text-secondary">
        These are timings from a load test on <strong>synthetic</strong> demo-scale data, on one machine that also ran the API and the database. They show how the prototype behaved there; they are not a production benchmark.
      </p>
      {runs.length > 1 ? (
        <div className="max-w-md">
          <Field label="Run shown in the latency and engine panels">
            {({ id }) => (
              <Select id={id} value={run?.commit ?? ''} onChange={(e) => setPicked(e.target.value)}>
                {[...runs].reverse().map((r) => (
                  <option key={r.commit} value={r.commit}>
                    {r.commit} · {when(r)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <Panel
            title="Test configuration"
            scope={`${runs.length} benchmark run${runs.length === 1 ? '' : 's'} on record · synthetic demo-scale data`}
            definition="Each column is one committed benchmark file, as written by the load test. A field the file does not record is shown as not recorded, never as 0."
            {...common}
          >
            <div className="flex flex-col gap-3">
              <ConfigTable runs={runs} />
              <ul className="flex max-w-prose list-disc flex-col gap-1 pl-5 text-sm text-secondary">
                <li>{resourceNote(runs)}</li>
                <li>{repeatNote(runs)}</li>
                <li>
                  The data is synthetic: {run ? fmtInt(run.applications) : '15,000'} applications{run?.seeded ? `, made by copying the ${fmtInt(run.seeded)} seeded ones` : ''}, not real AICTE caseload.
                </li>
                {unreadable > 0 ? <li>{unreadable} benchmark file{unreadable === 1 ? '' : 's'} could not be read and {unreadable === 1 ? 'is' : 'are'} left out.</li> : null}
              </ul>
            </div>
          </Panel>
        </div>

        <div className="lg:col-span-2">
          <Panel
            title="Read latency per screen (milliseconds)"
            scope={runScope}
            definition={`${run ? `Time to answer ${uniform(run, 'requests') === 'varies by screen' ? 'the requests made for each screen (the number varies by screen)' : `${uniform(run, 'requests')} requests for each screen`}${uniform(run, 'concurrency') === 'varies by screen' ? '' : `, ${uniform(run, 'concurrency')} at a time`}` : 'Time to answer the requests made for each screen'}. p50 is the median request, p95 and p99 are the times 95% and 99% of the requests finished within. Errors are failed requests; requests/s is the throughput.`}
            {...common}
          >
            {run ? <LatencyBars run={run} /> : null}
          </Panel>
        </div>

        <Panel
          title="Deadline engine cycles (seconds)"
          scope={runScope}
          definition="Two full deadline-engine cycles run back to back on the same data: how long each took and how many new alerts it created. The second cycle should create none."
          {...common}
        >
          {run ? <CycleBars run={run} /> : null}
        </Panel>

        <Panel
          title="Duplicate alert prevention"
          scope={runScope}
          definition="Alerts the engine declined to create because the same alert already existed, counted for the first and the second cycle. A declined attempt is not an alert created, so the two counts need not match."
          {...common}
          state={panelState(q, false, none || (!!run && (run.first.alertsSuppressed === undefined || run.second.alertsSuppressed === undefined)))}
          insufficientMessage={none ? NO_RESULTS : `Duplicate attempts declined: ${NOT_RECORDED}. Pick a later run to see them.`}
        >
          {run ? (
            <div className="flex flex-col gap-3">
              <dl className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border p-3">
                  <dt className="text-sm font-medium text-secondary">First cycle</dt>
                  <dd className="tnum text-2xl font-semibold">{fmtInt(run.first.alertsSuppressed)}</dd>
                  <p className="text-xs text-secondary">declined · {fmtInt(run.first.newAlerts)} alerts created</p>
                </div>
                <div className="rounded-lg border p-3">
                  <dt className="text-sm font-medium text-secondary">Second cycle</dt>
                  <dd className="tnum text-2xl font-semibold">{fmtInt(run.second.alertsSuppressed)}</dd>
                  <p className="text-xs text-secondary">declined · {fmtInt(run.second.newAlerts)} alerts created</p>
                </div>
              </dl>
              <p className="max-w-prose text-sm text-secondary">
                These count duplicate attempts the engine declined. The number of attempts declined need not equal the alerts created, and the second cycle created {fmtInt(run.second.newAlerts)}: a second look at unchanged data declined {fmtInt(run.second.alertsSuppressed)} attempts rather than raising them again.
              </p>
            </div>
          ) : null}
        </Panel>

        <div className="lg:col-span-2">
          <Panel
            title="Run comparison (p95 per screen)"
            scope={runs.length >= 2 ? `${runs.length} runs on record · p95 in milliseconds · runs are never combined` : `${runs.length} benchmark run${runs.length === 1 ? '' : 's'} on record`}
            definition="Runs are compared only when their machine blocks are identical on every field both runs record: CPU cores, CPU model, memory and Node version, plus the PostgreSQL version. Each run is shown separately; nothing is combined across runs."
            {...common}
            state={compareState}
            insufficientMessage={insufficient}
          >
            {latest && prev && cmp ? (
              cmp.ok ? (
                <div className="flex flex-col gap-3">
                  {count ? (
                    <div className="flex max-w-prose flex-col gap-1">
                      <p className="text-base font-medium">
                        {count.main.slower === count.main.total
                          ? `The newer run (${latest.commit}) was slower on every measure compared: all ${count.main.total - 2} p95 values and both engine cycles.`
                          : `The newer run (${latest.commit}) was slower on ${count.main.slower} of ${count.main.total} measures compared (p95 per screen and both engine cycles).`}
                      </p>
                      <p className="text-sm text-secondary">
                        Counting every p50, p95 and p99 as well, it was slower on {count.all.slower} of {count.all.total} measures
                        {count.notSlower.length > 0 ? `; not slower: ${count.notSlower.join(', ')}` : ''}.
                      </p>
                    </div>
                  ) : null}
                  <CompareBars runs={runs} />
                  <ul className="flex flex-col gap-1 text-sm">
                    {runs.map((r) => (
                      <li key={r.commit} className="tnum">
                        Run {r.commit}: {when(r)}; first cycle {fmtSec(r.first.ms)}, second cycle {fmtSec(r.second.ms)}.
                      </li>
                    ))}
                  </ul>
                  <ul className="flex max-w-prose list-disc flex-col gap-1 pl-5 text-sm text-secondary">
                    <li>The runs match on {cmp.fields.map((f) => FIELD_WORDS[f] ?? f).join(', ')}. Fields only one run records (operating system, total memory in bytes, PostgreSQL build) could not be compared.</li>
                    <li>Whether the two runs used the same simulated date and seed state is not recorded in the benchmark files, so it is not known whether the runs are like-for-like (see "Second run" in docs/evidence/BENCHMARKS.md for what is known), and the cause of any difference was not isolated.</li>
                    <li>
                      {(prev.repeats ?? 0) > 1 && (latest.repeats ?? 0) > 1
                        ? 'Both runs were repeated, but this page shows one figure per measure and does not compute variance, so the size of the difference cannot be judged against run-to-run variation here.'
                        : `No variance can be stated: ${prev.commit} is ${repeatsWord(prev)} and ${latest.commit} is ${repeatsWord(latest)}, so the size of the difference cannot be told apart from run-to-run variation.`}{' '}
                      Results from different runs are never combined.
                    </li>
                    <li>Synthetic data at demo scale, one shared machine, no CPU or memory measurement. Limits and method: docs/evidence/BENCHMARKS.md.</li>
                  </ul>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="max-w-prose text-base font-medium">
                    Not compared: the machine blocks of these runs differ on {cmp.differing.map((f) => FIELD_WORDS[f] ?? f).join(', ')}, so their timings are not like-for-like. Each run is shown on its own above and here.
                  </p>
                  <ul className="flex flex-col gap-1 text-sm">
                    {runs.map((r) => (
                      <li key={r.commit}>
                        Run {r.commit} ({when(r)}): {environment(r)}.
                      </li>
                    ))}
                  </ul>
                  <p className="text-sm text-secondary">Limits and method: docs/evidence/BENCHMARKS.md.</p>
                </div>
              )
            ) : null}
          </Panel>
        </div>
      </div>
    </div>
  );
}
