import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithApp } from '../../../../test/render';
import { SchedulerSection } from './scheduler';
import { AlertsSection } from './alerts';
import { alerts, COMPLIANCE_DEFS, compliance, DEFS, engineRunsDetail, noRuns, RUN_DEFS, RUN_ROWS, summary } from './testFixtures';

vi.mock('../../../../api/client', async (orig) => ({ ...(await orig<typeof import('../../../../api/client')>()), api: { get: (path: string) => impl(path) } }));

// Plain functions, not vi.fn: a spy returning a rejecting promise fails the test with an unhandled rejection.
let impl: (path: string) => Promise<unknown> = async () => ({});
const calls: string[] = [];
let comp = compliance();
let runs: () => unknown = () => engineRunsDetail();
let sum: () => unknown = () => summary();
let failAll = false;
const serve = () => {
  impl = (path) => {
    calls.push(path);
    if (failAll) return Promise.reject(new Error('down'));
    if (path.startsWith('/evidence/compliance')) return Promise.resolve(comp);
    if (path.startsWith('/evidence/engine-runs')) return Promise.resolve(runs());
    if (path.startsWith('/evidence/summary')) return Promise.resolve(sum());
    if (path.startsWith('/evidence/alerts')) return Promise.resolve(alerts());
    return Promise.reject(new Error(`unexpected ${path}`));
  };
};
const page = (route = '/admin/evidence/scheduler') =>
  renderWithApp(
    <Routes>
      <Route path="/admin/evidence/:section" element={<SchedulerSection />} />
    </Routes>,
    { route },
  );
const panel = (title: string) => screen.getByRole('heading', { name: (n) => n.startsWith(title) }).closest('section')!;
const kpi = (label: string) => screen.getByText(label).parentElement as HTMLElement;
const bodyOf = (el: HTMLElement) => Array.from(el.querySelectorAll('tbody tr')).map((r) => Array.from(r.querySelectorAll('td')).map((c) => c.textContent));
const loaded = () => waitFor(() => expect(kpi('Runs recorded').textContent).toMatch(/\d/));
const outsideDefinitions = (root: HTMLElement) => {
  const c = root.cloneNode(true) as HTMLElement;
  c.querySelectorAll('details').forEach((d) => d.remove());
  return c.textContent!.toLowerCase();
};

beforeEach(() => {
  calls.length = 0;
  comp = compliance();
  runs = () => engineRunsDetail();
  sum = () => summary();
  failAll = false;
  serve();
});

describe('Scheduler: open deadlines now', () => {
  it('is named as current state with the as-of date, and its query carries no dates', async () => {
    page('/admin/evidence/scheduler?from=2026-10-01&to=2026-10-31');
    await waitFor(() => expect(screen.getByRole('heading', { name: /Open deadlines now/ }).textContent).toContain('as of 2026-11-03 — not affected by the dates'));
    expect(calls).toContain('/evidence/compliance');
    expect(calls.filter((c) => c.startsWith('/evidence/compliance') && c.includes('?'))).toEqual([]);
  });

  it('the four open-state segments sum to openTotal, and met, missed, paused and closed are not in the bar', async () => {
    page();
    await screen.findByText(/Outside the open total/);
    const p = panel('Open deadline items by state');
    const rows = bodyOf(p);
    expect(rows.map((r) => r[0])).toEqual(['Overdue', 'At risk', 'Due soon', 'On track']);
    const counts = rows.map((r) => Number(String(r[1]).replace(/,/g, '')));
    expect(counts).toEqual([20, 7, 4, 147]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(178);
    expect(p.textContent).toContain('178 open items');
    for (const w of ['Met', 'Missed', 'Paused', 'Closed']) expect(within(p).queryAllByRole('cell', { name: w })).toHaveLength(0);
    const legend = within(p).getByRole('list', { name: 'Open states' });
    expect(legend.textContent).toContain('Overdue');
    expect(legend.textContent).toContain('20 (11%)');
    expect(legend.textContent).toContain('147 (83%)');
    expect(legend.textContent).not.toMatch(/met|missed|paused|closed/i);
  });

  it('states what is outside the open total on its own line', async () => {
    page();
    const line = await screen.findByText(/Outside the open total/);
    expect(line.textContent).toBe('Outside the open total: 165 met · 1 missed · 5 paused · 0 closed');
  });

  it('does not draw a split whose states do not add up to the open total', async () => {
    comp = compliance({ onTrack: 100 });
    page();
    await screen.findByText(/do not add up to the open total/);
    expect(screen.queryByRole('list', { name: 'Open states' })).toBeNull();
  });

  it('overdue and at-risk KPIs read "of N open", with the definitions verbatim and adjacent', async () => {
    page();
    await waitFor(() => expect(kpi('Overdue now').textContent).toMatch(/20/));
    expect(kpi('Overdue now').textContent).toContain('of 178 open');
    expect(kpi('At risk now')).toHaveTextContent('7');
    expect(kpi('Overdue now').querySelector('details')!.textContent).toContain(COMPLIANCE_DEFS.overdue);
    expect(kpi('At risk now').querySelector('details')!.textContent).toContain(COMPLIANCE_DEFS.atRisk);
    const d = panel('Open deadline items by state').querySelector('details')!.textContent!;
    for (const t of Object.values(COMPLIANCE_DEFS)) expect(d).toContain(t);
  });

  it('openTotal 0 is an empty panel, not four zero segments', async () => {
    comp = compliance({ openTotal: 0, overdue: 0, atRisk: 0, dueSoon: 0, onTrack: 0 });
    page();
    await screen.findAllByText('No open deadline items.');
    expect(screen.queryByRole('list', { name: 'Open states' })).toBeNull();
  });
});

describe('Scheduler: engine run history', () => {
  it('the date range reaches only the engine-runs request', async () => {
    page('/admin/evidence/scheduler?from=2026-10-01&to=2026-10-31');
    await loaded();
    await waitFor(() => expect(calls).toContain('/evidence/engine-runs?from=2026-10-01&to=2026-10-31'));
    expect(calls).toContain('/evidence/compliance');
    expect(calls).toContain('/evidence/summary');
    expect(calls.filter((c) => c.includes('from=')).every((c) => c.startsWith('/evidence/engine-runs'))).toBe(true);
  });

  it('names the clock as the date the engine treated as today', async () => {
    page();
    const all = await screen.findAllByText(/treated as today/);
    expect(all.some((e) => /not the real time/i.test(e.textContent!))).toBe(true);
  });

  it('runs recorded, failed and abandoned are labelled with words and carry their definitions', async () => {
    page();
    await waitFor(() => expect(kpi('Runs recorded').textContent).toMatch(/3/));
    expect(kpi('Failed runs')).toHaveTextContent('1');
    expect(kpi('Abandoned runs')).toHaveTextContent('0');
    expect(kpi('Abandoned runs').textContent).toContain('still marked running after 15 minutes — a crash cannot update its own row');
    expect(kpi('Abandoned runs').querySelector('details')!.textContent).toContain(RUN_DEFS.abandoned);
    expect(kpi('Runs recorded').querySelector('details')!.textContent).toContain(RUN_DEFS.totals);
  });

  it('runCount 0 is insufficient data with no zero figures', async () => {
    runs = () => noRuns();
    page();
    await screen.findAllByText(/No engine run is dated in this range/);
    for (const l of ['Runs recorded', 'Failed runs', 'Abandoned runs']) expect(kpi(l).textContent).not.toMatch(/\b0\b/);
    expect(panel('Duplicate alerts prevented').textContent).not.toMatch(/\b0\b/);
    expect(panel('Duration of each run').textContent).toMatch(/No engine run is dated in this range/);
  });

  it('the duration chart data table equals the API rows, newest first as returned', async () => {
    page();
    await loaded();
    const p = await waitFor(() => panel('Duration of each run'));
    const t = within(p).getByRole('table', { hidden: true });
    const rows = bodyOf(t as HTMLElement);
    expect(rows.map((r) => r[0])).toEqual(RUN_ROWS.map((r) => r.id));
    expect(rows.map((r) => r[3])).toEqual(['300 ms', '4.2 s', '100 ms']);
    expect(rows.map((r) => r[2])).toEqual(RUN_ROWS.map((r) => `${Number(r.simulatedToday.slice(8))} Oct 2026`));
    expect(rows.map((r) => r[4])).toEqual(RUN_ROWS.map((r) => String(r.itemsChecked)));
  });

  it('a failed run is labelled Failed in the chart table, the recent-runs table and the caption, not by colour alone', async () => {
    page();
    await loaded();
    const p = panel('Duration of each run');
    expect(bodyOf(within(p).getByRole('table', { hidden: true }) as HTMLElement).map((r) => r[5])).toEqual(['Finished', 'Failed', 'Finished']);
    expect(p.textContent).toMatch(/Failed runs \(drawn in red\): 2/);
    const recent = panel('Recent engine runs');
    expect(within(recent).getAllByText('Failed').length).toBeGreaterThan(0);
  });

  it('duplicate alerts prevented: created and prevented, with the delivery-channel caveat and a link to the alert log', async () => {
    page();
    await loaded();
    const p = panel('Duplicate alerts prevented');
    expect(bodyOf(within(p).getByRole('table', { hidden: true }) as HTMLElement)).toEqual([['Alerts created', '39'], ['Duplicates prevented', '21']]);
    expect(p.textContent).toContain('no external delivery channel');
    expect(p.querySelector('details')!.textContent).toContain(RUN_DEFS.alertsSuppressed);
    expect(within(p).getByRole('link', { name: /Alerts/ })).toHaveAttribute('href', '/admin/evidence/alerts');
  });

  it('recent runs table: started, duration, status word, instance, simulated date, items, created, suppressed, provenance word, error', async () => {
    page();
    await loaded();
    const t = within(panel('Recent engine runs')).getByRole('table');
    const heads = Array.from(t.querySelectorAll('thead th')).map((h) => h.textContent?.trim());
    expect(heads).toEqual(['Run', 'Started (real time)', 'Duration', 'Status', 'Instance', 'Simulated date', 'Items checked', 'Alerts created', 'Duplicates prevented', 'Source', 'Error']);
    const rows = bodyOf(t as HTMLElement);
    expect(rows).toHaveLength(3);
    const failed = rows[1]!;
    expect(failed[0]).toBe('2');
    expect(failed[3]).toBe('Failed');
    expect(failed[5]).toBe('12 Oct 2026');
    expect(failed[9]).toBe('Simulated clock');
    expect(failed[10]).toBe('ERROR TEXT: database connection lost');
    expect(rows[2]![9]).toBe('Real clock');
    expect(rows[0]![10]).toBe('—');
  });

  it('pages the run rows from the API and keeps the dates', async () => {
    runs = () => engineRunsDetail({ total: 60 });
    page('/admin/evidence/scheduler?from=2026-10-01');
    const next = await screen.findByRole('button', { name: 'Next page of runs' });
    fireEvent.click(next);
    await waitFor(() => expect(calls).toContain('/evidence/engine-runs?from=2026-10-01&page=2'));
    expect(await screen.findByText(/Page 2 of 3/)).toBeInTheDocument();
  });

  it('shows the latest process check-in from the summary, verbatim definitions, and no healthy/down claims', async () => {
    page();
    await waitFor(() => expect(kpi('Latest process check-in').textContent).toMatch(/stuck/));
    const k = kpi('Latest process check-in');
    expect(k.textContent).toContain('No scheduler process has reported to this database');
    expect(k.textContent).toContain('0 stuck runs');
    expect(k.querySelector('details')!.textContent).toContain(DEFS.scheduler);
    expect(k.querySelector('details')!.textContent).toContain(DEFS.stuckRuns);
    expect(outsideDefinitions(k)).not.toMatch(/healthy|running|\bdown\b/);
  });

  it('shows a heartbeat age and stuck runs when present', async () => {
    sum = () => summary({ scheduler: { lastRunAt: null, lastStatus: null, lastDurationMs: null, stuckRuns: 2, heartbeat: { instanceId: 'x', isLeader: true, lastSeenAt: 'x', ageSeconds: 120 } } });
    page();
    await waitFor(() => expect(kpi('Latest process check-in').textContent).toContain('2 stuck runs'));
    expect(kpi('Latest process check-in').textContent).toContain('Last process heartbeat 2 min ago');
  });

  it('every request failing shows retry states, not figures', async () => {
    failAll = true;
    page();
    expect((await screen.findAllByRole('button', { name: /retry|try again/i })).length).toBeGreaterThan(3);
  });

  it('shows a loading state before data arrives', () => {
    impl = () => new Promise(() => {});
    const { container } = page();
    expect(container.querySelector('[aria-busy], .animate-pulse, [role=status]')).not.toBeNull();
  });
});

describe('Scheduler and Alerts agree', () => {
  it('alerts created by runs and the alert-log total show the same number for the same dates', async () => {
    runs = () => engineRunsDetail({ totals: { runCount: 25, failedCount: 0, abandonedCount: 0, alertsCreated: 107, alertsSuppressed: 96 } });
    const s = page();
    await waitFor(() => expect(within(panel('Duplicate alerts prevented')).getByRole('table', { hidden: true })).toBeInTheDocument());
    const created = bodyOf(within(panel('Duplicate alerts prevented')).getByRole('table', { hidden: true }) as HTMLElement)[0]![1];
    s.unmount();
    renderWithApp(<AlertsSection />);
    await waitFor(() => expect(kpi('Alerts raised').textContent).toMatch(/\d/));
    expect(kpi('Alerts raised')).toHaveTextContent(created!);
  });
});
