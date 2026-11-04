import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithApp } from '../../../../test/render';
import { PerformanceSection } from './performance';
import { comparableRuns, parseRun } from './perfModel';
import { artifacts, metricsEntry, NEW_RUN, OLD_RUN, runEntry } from './testFixtures';

vi.mock('../../../../api/client', async (orig) => ({ ...(await orig<typeof import('../../../../api/client')>()), api: { get: (path: string) => impl(path) } }));

let impl: (path: string) => Promise<unknown> = async () => ({});
let body: unknown;
let failAll = false;
beforeEach(() => {
  failAll = false;
  body = artifacts(runEntry(OLD_RUN), runEntry(NEW_RUN), metricsEntry());
  impl = () => (failAll ? Promise.reject(new Error('down')) : Promise.resolve(body));
});

const page = () =>
  renderWithApp(
    <Routes>
      <Route path="/admin/evidence/:section" element={<PerformanceSection />} />
    </Routes>,
    { route: '/admin/evidence/performance' },
  );
const panel = (title: string) => screen.getByRole('heading', { name: (n) => n.startsWith(title) }).closest('section')!;
const bodyOf = (el: HTMLElement) => Array.from(el.querySelectorAll('tbody tr')).map((r) => Array.from(r.querySelectorAll('th,td')).map((c) => c.textContent));
const tableIn = (title: string, name?: RegExp) => within(panel(title)).getAllByRole('table', { hidden: true }).find((t) => !name || name.test(t.getAttribute('aria-label') ?? t.querySelector('caption')?.textContent ?? ''))! as HTMLElement;
const loaded = () => waitFor(() => expect(screen.getAllByText(/f78d82e/).length).toBeGreaterThan(0));
const TITLES = ['Test configuration', 'Read latency per screen', 'Deadline engine cycles', 'Duplicate alert prevention', 'Run comparison'];
const otherMachine = { ...OLD_RUN, machine: { ...OLD_RUN.machine, cpus: 8 } };

describe('run parsing and comparability', () => {
  it('parses both committed runs and rejects malformed ones', () => {
    expect(parseRun(runEntry(OLD_RUN))!.commit).toBe('565c210');
    expect(parseRun(runEntry(NEW_RUN))!.repeats).toBe(1);
    expect(parseRun(runEntry(OLD_RUN, 'NOT_VERIFIED'))).toBeNull();
    expect(parseRun({ ...runEntry(OLD_RUN), data: { ...OLD_RUN, reads: 'x' } })).toBeNull();
    expect(parseRun({ ...runEntry(OLD_RUN), data: { ...OLD_RUN, machine: null } })).toBeNull();
  });
  it('compares on the fields both record: the old and new committed runs match', () => {
    const [a, b] = [parseRun(runEntry(OLD_RUN))!, parseRun(runEntry(NEW_RUN))!];
    expect(comparableRuns(a, b)).toEqual({ ok: true, fields: ['cpus', 'cpuModel', 'memoryGb', 'node', 'pgVersion'] });
  });
  it('differing machines are not comparable and name the field', () => {
    const r = comparableRuns(parseRun(runEntry(otherMachine))!, parseRun(runEntry(NEW_RUN))!);
    expect(r).toEqual({ ok: false, differing: ['cpus'] });
  });
});

describe('Performance', () => {
  it('test configuration shows each run, with unrecorded fields as "not recorded in this run", never 0', async () => {
    page();
    await loaded();
    const rows = bodyOf(tableIn('Test configuration'));
    const get = (label: string) => rows.find((r) => r[0] === label)!;
    expect(get('Commit')).toEqual(['Commit', '565c210', 'f78d82e']);
    expect(get('CPU model')).toEqual(['CPU model', 'Intel(R) Xeon(R) Processor @ 2.10GHz', 'Intel(R) Xeon(R) Processor @ 2.10GHz']);
    expect(get('CPU cores')).toEqual(['CPU cores', '4', '4']);
    expect(get('Memory')).toEqual(['Memory', '16 GB', '16 GB']);
    expect(get('Node')).toEqual(['Node', 'v22.22.0', 'v22.22.0']);
    expect(get('PostgreSQL')).toEqual(['PostgreSQL', '16.15', '16.15']);
    expect(get('Operating system')).toEqual(['Operating system', 'not recorded in this run', 'Linux 6.18.44-fc-v230 x64']);
    expect(get('Repeats')).toEqual(['Repeats', 'not recorded in this run', '1']);
    expect(get('Applications')).toEqual(['Applications', '15,000', '15,000']);
    expect(get('Requests per screen')[2]).toBe('400');
    expect(get('Concurrency')[2]).toBe('20');
    expect(get('CPU and memory use')).toEqual(['CPU and memory use', 'not recorded in this run', 'not measured']);
  });

  it('states one run per side, no variance, synthetic demo scale, and that CPU and memory use were not measured', async () => {
    page();
    await loaded();
    const p = panel('Test configuration').textContent!;
    expect(p).toContain('CPU and memory use: 565c210 not recorded; f78d82e not measured.');
    expect(p).toMatch(/one run|single run/i);
    expect(p).toMatch(/synthetic/i);
    expect(p).toMatch(/15,000 applications/);
    expect(p).toMatch(/Benchmark/);
  });

  it('read latency table equals the JSON for the newest run, with errors and requests per second', async () => {
    page();
    await loaded();
    const rows = bodyOf(tableIn('Read latency per screen'));
    expect(rows).toEqual([
      ['Action Center (officer)', '358', '508', '526', '0', '50'],
      ['Action Center summary (senior)', '189', '259', '302', '0', '49'],
      ['Applications list (officer)', '904', '1,022', '1,046', '0', '48'],
      ['Team report (senior)', '2,087', '2,296', '2,365', '2', '47'],
      ['Authority queue', '409', '471', '486', '0', '46'],
    ]);
  });

  it('the run selector shows the older run in the same panels', async () => {
    page();
    await loaded();
    fireEvent.change(screen.getByLabelText(/Run shown/), { target: { value: '565c210' } });
    expect(bodyOf(tableIn('Read latency per screen'))[0]).toEqual(['Action Center (officer)', '276', '461', '572', '0', '50']);
  });

  it('engine cycles: durations in seconds and new alerts, the second cycle creating none', async () => {
    page();
    await loaded();
    const rows = bodyOf(tableIn('Deadline engine cycles'));
    expect(rows).toEqual([
      ['First cycle', '131.5 s', '10,282', '47'],
      ['Second cycle', '68.1 s', '0', '6,490'],
    ]);
  });

  it('duplicate prevention: 47 then 6,490, with the note that suppressed need not equal created', async () => {
    page();
    await loaded();
    const p = panel('Duplicate alert prevention').textContent!;
    expect(p).toContain('47');
    expect(p).toContain('6,490');
    expect(p).toMatch(/duplicate attempts/);
    expect(p).toMatch(/need not equal the alerts created/);
  });
  it('duplicate prevention for a run without the counter says so, not zero', async () => {
    page();
    await loaded();
    fireEvent.change(screen.getByLabelText(/Run shown/), { target: { value: '565c210' } });
    const p = panel('Duplicate alert prevention').textContent!;
    expect(p).toMatch(/not recorded in this run/);
    expect(p).not.toContain('6,490');
  });

  it('the latency definition and scope take requests and concurrency from the run, not from the page', async () => {
    const small = { ...NEW_RUN, reads: NEW_RUN.reads.map((r) => ({ ...r, requests: 100, concurrency: 5 })) };
    body = artifacts(runEntry(OLD_RUN), runEntry(small));
    page();
    await loaded();
    const p = panel('Read latency per screen').textContent!;
    expect(p).toContain('Time to answer 100 requests for each screen, 5 at a time');
    expect(p).not.toContain('400 requests');
    expect(p).not.toContain('20 at a time');
  });

  it('repeats are stated per run from the files; a run without the field is not called a single run', async () => {
    page();
    await loaded();
    const t = panel('Test configuration').textContent!;
    expect(t).toContain('565c210 repeat count not recorded');
    expect(t).toContain('f78d82e a single run (repeat count 1)');
    expect(t).not.toMatch(/Each run is a single run/);
  });

  it('two runs that both record repeat count 1 are called single runs, and a repeated run is not', async () => {
    body = artifacts(runEntry({ ...OLD_RUN, repeats: 1 } as typeof OLD_RUN), runEntry(NEW_RUN));
    page();
    await loaded();
    expect(panel('Test configuration').textContent).toMatch(/Each run is a single run \(repeat count 1\)/);
    cleanup();
    body = artifacts(runEntry({ ...OLD_RUN, repeats: 3 } as typeof OLD_RUN), runEntry({ ...NEW_RUN, repeats: 3 } as typeof NEW_RUN));
    page();
    await loaded();
    const t = panel('Test configuration').textContent!;
    expect(t).toContain('repeated 3 times');
    expect(t).not.toMatch(/single run/);
    expect(t).not.toMatch(/no variance can be stated/);
  });

  it('two runs on the same machine are compared: p95 side by side with commit and date, no averages', async () => {
    const { container } = page();
    await loaded();
    const p = panel('Run comparison');
    const rows = bodyOf(within(p).getAllByRole('table', { hidden: true })[0] as HTMLElement);
    expect(rows[0]).toEqual(['Action Center (officer)', '461', '508', '+47']);
    expect(rows[3]).toEqual(['Team report (senior)', '1,851', '2,296', '+445']);
    expect(p.textContent).toContain('565c210');
    expect(p.textContent).toContain('3 Nov 2026');
    expect(p.textContent).toContain('4 Nov 2026');
    expect(p.textContent).toMatch(/slower on every measure compared: all 5 p95 values and both engine cycles/);
    expect(p.textContent).toMatch(/slower on 16 of 17 measures; not slower: Action Center \(officer\) p99/);
    expect(p.textContent).toMatch(/whether the runs are like-for-like/);
    expect(p.textContent).toMatch(/simulated date/);
    expect(p.textContent).not.toMatch(/state differed between them/);
    expect(p.textContent).toMatch(/no variance can be stated/i);
    expect(p.textContent).toContain('docs/evidence/BENCHMARKS.md');
    expect(container.textContent).not.toMatch(/average|mean\b/i);
  });

  it('the comparison does not say faster when a measure improved', async () => {
    const better = { ...NEW_RUN, reads: NEW_RUN.reads.map((r, i) => (i === 0 ? { ...r, p50ms: 1, p95ms: 1, p99ms: 1 } : r)) };
    body = artifacts(runEntry(OLD_RUN), runEntry(better));
    page();
    await loaded();
    const t = panel('Run comparison').textContent!;
    expect(t).not.toMatch(/slower on every measure/);
    expect(t).toMatch(/slower on 6 of 7 measures compared/);
  });

  it('one run: insufficient-data panel naming how many runs exist', async () => {
    body = artifacts(runEntry(NEW_RUN));
    page();
    await loaded();
    const t = panel('Run comparison').textContent!;
    expect(t).toMatch(/Insufficient data/);
    expect(t).toMatch(/1 benchmark run is on record/);
    expect(within(panel('Run comparison')).queryByRole('img')).toBeNull();
  });

  it('two runs on different machines are not compared; each is shown with its environment', async () => {
    body = artifacts(runEntry(otherMachine), runEntry(NEW_RUN));
    page();
    await loaded();
    const p = panel('Run comparison');
    expect(p.textContent).toMatch(/Not compared/);
    expect(p.textContent).toMatch(/CPU cores/);
    expect(p.textContent).toContain('8 CPU cores');
    expect(p.textContent).toContain('4 CPU cores');
    expect(p.querySelector('[role=img]')).toBeNull();
    expect(p.textContent).not.toMatch(/slower on/);
  });

  it('no benchmark files at all is an honest not-available state', async () => {
    body = artifacts(metricsEntry());
    const { container } = page();
    await waitFor(() => expect(screen.getAllByText(/No benchmark results/).length).toBeGreaterThan(3));
    expect(container.querySelector('[role=img]')).toBeNull();
  });
  it('unreadable benchmark files are left out and counted', async () => {
    body = artifacts(runEntry(NEW_RUN), runEntry(OLD_RUN, 'NOT_VERIFIED'));
    page();
    await loaded();
    expect(panel('Test configuration').textContent).toMatch(/1 benchmark file could not be read/);
  });

  it('retry on error, and every panel carries a definition', async () => {
    failAll = true;
    page();
    expect((await screen.findAllByRole('button', { name: /retry|try again/i })).length).toBeGreaterThan(3);
  });
  it('definitions', async () => {
    page();
    await loaded();
    for (const t of TITLES) expect(panel(t).querySelector('details')).not.toBeNull();
  });
});
