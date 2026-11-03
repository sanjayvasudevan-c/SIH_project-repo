import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { renderWithApp } from '../../../../test/render';
import { WorkflowSection } from './workflow';
import { DEFS, workflow } from './testFixtures';

vi.mock('../../../../api/client', async (orig) => ({ ...(await orig<typeof import('../../../../api/client')>()), api: { get: (path: string) => impl(path) } }));

let impl: (path: string) => Promise<unknown> = async () => ({});
const calls: string[] = [];
const serve = (f: (path: string) => Promise<unknown>) => {
  impl = (path) => {
    calls.push(path);
    return f(path);
  };
};
const ok = (over = {}) => serve(async () => workflow(over));

function Where() {
  const l = useLocation();
  return <span data-testid="where">{l.pathname + l.search}</span>;
}
const page = (route = '/admin/evidence/workflow') =>
  renderWithApp(
    <>
      <Routes>
        <Route path="/admin/evidence/:section" element={<WorkflowSection />} />
      </Routes>
      <Where />
    </>,
    { route },
  );
const panel = (title: string) => screen.getByRole('heading', { name: (n) => n.startsWith(title) }).closest('section')!;
const rowsOf = (el: HTMLElement) => Array.from(el.querySelectorAll('tbody tr')).map((r) => Array.from(r.querySelectorAll('td')).map((c) => c.textContent));

beforeEach(() => {
  calls.length = 0;
  ok();
});

describe('Workflow', () => {
  it('has four panels with plain titles, each with a non-empty definition verbatim', async () => {
    page();
    await screen.findByText(/5 working days/);
    const titles = ['Where applications got to', 'Current status of submitted applications', 'Time to decision', 'Applications over time'];
    const defs = [DEFS.funnel, DEFS.statusDistribution, DEFS.processingTime, DEFS.volumeOverTime];
    titles.forEach((t, i) => {
      const p = panel(t);
      expect(p.querySelector('details')!.textContent).toContain(defs[i]);
      expect(p).toHaveTextContent('n = 191 applications · all dates');
    });
  });

  it('funnel: the data table has exactly 6 rows equal to the API, each "of {onRoute}", and says stages are not monotonic', async () => {
    page();
    await screen.findByText(/5 working days/);
    const p = panel('Where applications got to');
    expect(rowsOf(p)).toEqual([
      ['Submitted', '191', 'of 191 on this route', '100%'],
      ['Scrutiny', '162', 'of 162 on this route', '85%'],
      ['Expert visit committee', '52', 'of 124 on this route', '27%'],
      ['SAC/SHC', '2', 'of 2 on this route', '1%'],
      ['Awaiting decision', '47', 'of 191 on this route', '25%'],
      ['Decided', '45', 'of 191 on this route', '24%'],
    ]);
    expect(p.textContent).toMatch(/not .*(always|steadily|necessarily).*(fall|decrease|monoton)|routes differ/i);
  });

  it('status: the six real statuses in the app\'s own words, no Pending or Overdue, counts sum to the submitted total, links to Scheduler', async () => {
    page();
    await screen.findByText(/5 working days/);
    const p = panel('Current status of submitted applications');
    const rows = rowsOf(p);
    expect(rows.map((r) => r[0])).toEqual(['In progress', 'Waiting on college', 'Approved', 'Approved with conditions', 'Rejected', 'Closed']);
    expect(rows.reduce((n, r) => n + Number(r[1]), 0)).toBe(191);
    expect(within(p).queryByRole('row', { name: /pending|overdue/i })).toBeNull();
    const t = p.textContent!;
    expect(t.match(/pending/i)).toBeNull();
    expect(within(p).getByRole('link', { name: /scheduler/i })).toHaveAttribute('href', '/admin/evidence/scheduler');
  });

  it('time to decision: median in working days with decided and in-progress counts', async () => {
    page();
    const p = panel('Time to decision');
    expect(await within(p).findByText('5 working days (median)')).toBeInTheDocument();
    expect(p).toHaveTextContent('45 decided · 146 still in progress (not counted)');
  });

  it('time to decision: a null median is the insufficient state, never 0', async () => {
    ok({ processingTime: { decidedCount: 0, inFlightCount: 191, medianWorkingDays: null, unit: 'working days' } });
    page();
    await screen.findByText(/No application in this scope has been decided yet/);
    const p = panel('Time to decision');
    expect(p.textContent).not.toMatch(/\b0 working days/);
    expect(p).toHaveTextContent(DEFS.processingTime.slice(0, 20));
  });

  it('volume: data table equals the API rows with the overdue series, and states the day axis is not the date range', async () => {
    page();
    await screen.findByText(/5 working days/);
    const p = panel('Applications over time');
    expect(rowsOf(p)).toEqual([
      ['21 May 2026', '1', '0', '0'],
      ['28 May 2026', '0', '1', '2'],
      ['3 Jun 2026', '3', '1', '0'],
    ]);
    expect(p.textContent).toContain('21 May 2026 to 3 Jun 2026');
    expect(p.textContent).toMatch(/not the (selected )?date range/i);
    expect(p.textContent).toContain('days with no events are not shown');
    expect(p.textContent).toContain(DEFS.volumeOverTime);
  });

  it('empty: nothing submitted gives each panel its empty message', async () => {
    ok({ submittedTotal: 0, funnel: [], statusDistribution: [], processingTime: { decidedCount: 0, inFlightCount: 0, medianWorkingDays: null, unit: 'working days' }, volumeOverTime: [] });
    page();
    expect((await screen.findAllByText('No applications were submitted in this date range.')).length).toBe(3);
    expect(screen.getByText(/No application in this scope has been decided yet/)).toBeInTheDocument();
  });

  it('insufficient: a single day is not a trend', async () => {
    ok({ volumeOverTime: [{ day: '2026-05-21', submitted: 1, decided: 0, overdue: 0 }] });
    page();
    expect(await screen.findByText(/at least two days/i)).toBeInTheDocument();
  });

  it('a missing definition replaces the panel body with the no-definition error', async () => {
    serve(async () => ({ ...workflow(), definition: {} }));
    page();
    await waitFor(() => expect(screen.getAllByText('This measure has no definition and is not shown')).toHaveLength(4));
    expect(screen.queryByText(/5 working days/)).toBeNull();
  });

  it('the date range reaches the request and the URL, and nothing else changes the panels', async () => {
    page();
    await screen.findByText(/5 working days/);
    expect(calls).toEqual(['/evidence/workflow']);
    expect(screen.getByText(/application dates/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-30' } });
    await waitFor(() => expect(calls).toContain('/evidence/workflow?from=2026-09-01&to=2026-09-30'));
    expect(screen.getByTestId('where').textContent).toBe('/admin/evidence/workflow?from=2026-09-01&to=2026-09-30');
    await waitFor(() => expect(panel('Where applications got to')).toHaveTextContent('2026-09-01 to 2026-09-30'));
    // every request is the one workflow endpoint
    expect(new Set(calls.map((c) => c.split('?')[0]))).toEqual(new Set(['/evidence/workflow']));
  });

  it('an invalid range in the link is ignored: no impossible date is sent', async () => {
    page('/admin/evidence/workflow?from=2026-02-30');
    await screen.findByText(/5 working days/);
    expect(calls).toEqual(['/evidence/workflow']);
    expect(screen.getByText(/not valid and has been ignored/)).toBeInTheDocument();
  });

  it('shows loading then an error with retry', async () => {
    let fail = true;
    serve(async () => (fail ? Promise.reject(new Error('boom')) : workflow()));
    page();
    const retries = await screen.findAllByRole('button', { name: /retry|try again/i });
    expect(retries.length).toBe(4);
    fail = false;
    fireEvent.click(retries[0]);
    expect(await screen.findByText(/5 working days/)).toBeInTheDocument();
  });
});
