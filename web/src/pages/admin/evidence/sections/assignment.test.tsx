import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithApp } from '../../../../test/render';
import { AssignmentSection } from './assignment';
import { assignment, BLOCKED_REASON, DEFS, OFFICER_UTILS, REASON, traceFor } from './testFixtures';

vi.mock('../../../../api/client', async (orig) => ({ ...(await orig<typeof import('../../../../api/client')>()), api: { get: (path: string) => impl(path) } }));

let impl: (path: string) => Promise<unknown> = async () => ({});
const calls: string[] = [];
type Over = Parameters<typeof assignment>[0];
let current: Over = {};
let windowed: Over = { coverage: { tracedCount: 3, assignmentTotal: 5, blockedCount: 0 }, outcomes: [{ outcome: 'ASSIGNED', count: 4 }] };
const serve = () => {
  impl = (path) => {
    calls.push(path);
    if (path.startsWith('/evidence/assignment-trace/')) return Promise.resolve(traceFor(path.split('/').pop()!));
    return Promise.resolve(assignment(path.includes('?') ? { ...current, ...windowed } : current));
  };
};

const page = (route = '/admin/evidence/assignment') =>
  renderWithApp(
    <Routes>
      <Route path="/admin/evidence/:section" element={<AssignmentSection />} />
    </Routes>,
    { route },
  );
const panel = (title: string) => screen.getByRole('heading', { name: (n) => n.startsWith(title) }).closest('section')!;
const kpi = (label: string) => screen.getByText(label).parentElement as HTMLElement;
const rowsOf = (el: HTMLElement) => Array.from(el.querySelectorAll('tbody tr')).map((r) => Array.from(r.querySelectorAll('td')).map((c) => c.textContent));

/** Group 1 has real numbers in it (the Kpi shows a skeleton until then). */
const loaded = () => waitFor(() => expect(kpi('Officers counted').textContent).toMatch(/\d/));

beforeEach(() => {
  calls.length = 0;
  current = {};
  windowed = { coverage: { tracedCount: 3, assignmentTotal: 5, blockedCount: 0 }, outcomes: [{ outcome: 'ASSIGNED', count: 4 }] };
  serve();
});

describe('Assignment: current workload', () => {
  it('names the group as current state, not affected by the dates', async () => {
    page();
    const h = await screen.findByRole('heading', { name: /Current workload/ });
    expect(h.textContent).toContain('current state — not affected by the dates');
  });

  it('officer count, average utilisation and the spread to two decimals, each with its definition', async () => {
    page();
    await loaded();
    expect(kpi('Officers counted')).toHaveTextContent('5');
    expect(kpi('Officers counted').textContent).toContain('role OFFICER with capacity; committee and Bureau excluded');
    expect(kpi('Average utilisation')).toHaveTextContent('47%');
    expect(kpi('Spread of utilisation')).toHaveTextContent('0.40');
    expect(kpi('Spread of utilisation').querySelector('details')!.textContent).toContain(DEFS.assignmentSpread);
  });

  it('a null spread is "Unavailable (fewer than two officers)", never 0', async () => {
    current = { spread: { officerCount: 1, meanUtilisation: 0.3, stdDev: null } };
    page();
    await loaded();
    const k = kpi('Spread of utilisation');
    expect(k).toHaveTextContent('Unavailable (fewer than two officers)');
    expect(k.textContent).not.toMatch(/\b0\.00\b/);
  });

  it('coverage reads "221 of 221" from the response, with the blocked count in the hint', async () => {
    page();
    await loaded();
    const k = kpi('Decisions with an explanation');
    expect(k).toHaveTextContent('221 of 221');
    expect(k).toHaveTextContent('1 found nobody eligible');
  });

  it('utilisation by officer: the data table lists every officer in the order the chart is sorted (highest first)', async () => {
    page();
    await loaded();
    const p = panel('Utilisation by officer');
    const rows = rowsOf(p);
    expect(rows).toHaveLength(OFFICER_UTILS.length);
    expect(rows.map((r) => r[0])).toEqual(['Officer 4', 'Officer 2', 'Officer 5', 'Officer 3', 'Officer 1']);
    expect(rows[0]).toEqual(['Officer 4', '13', '10', '130%', '100%']);
    expect(p.querySelector('details')!.textContent).toContain(DEFS.assignmentOfficers);
    expect(p).toHaveTextContent(/normal cap/i);
    expect(p).toHaveTextContent(/scroll/i);
  });

  it('officers above their cap: one row shows its text in full with the two ceilings and a Derived chip', async () => {
    page();
    await loaded();
    const p = panel('Officers above their normal cap');
    expect(p.textContent).toContain('Officer 4 is at 1.30 of capacity against a normal cap of 1.00. FULL TEXT: capacity reduced after the work was assigned.');
    expect(rowsOf(p)[0]!.slice(0, 3)).toEqual(['Officer 4', '130%', '100%']);
    expect(p.textContent).toContain('1.1');
    expect(p.textContent).toContain('1.25');
    expect(within(p).getByText('Derived')).toBeInTheDocument();
    expect(p.querySelector('details')!.textContent).toContain(DEFS.assignmentAboveCap);
  });

  it('zero officers above their cap is a genuine zero, not an empty state', async () => {
    current = { continuityOverrides: { count: 0, continuityUtilCap: 1.1, urgentMaxUtil: 1.25, rows: [] } };
    page();
    await loaded();
    const p = panel('Officers above their normal cap');
    expect(p).toHaveTextContent('No officer is above their normal cap.');
    expect(p.textContent).toContain('1.25');
    expect(p.textContent).not.toMatch(/no records|not enough data/i);
  });
});

describe('Assignment: decisions in the period', () => {
  it('the date range reaches only the second group: Group 1 keeps its unfiltered query', async () => {
    page();
    await loaded();
    await screen.findByRole('heading', { name: (n) => n.startsWith('Why this officer?') });
    await screen.findByRole('row', { name: /W-2026-0025/ });
    expect(calls).toEqual(['/evidence/assignment']); // one shared, unfiltered request
    expect(screen.getByText(/decision dates/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-30' } });
    await waitFor(() => expect(calls).toContain('/evidence/assignment?from=2026-09-01&to=2026-09-30'));
    await waitFor(() => expect(panel('Why this officer?')).toHaveTextContent('3 of 5'));
    expect(calls.filter((c) => c === '/evidence/assignment')).toHaveLength(1); // not refetched, and no other unfiltered call
    expect(kpi('Decisions with an explanation')).toHaveTextContent('221 of 221'); // Group 1 unchanged
    expect(kpi('Officers counted')).toHaveTextContent('5');
  });

  it('summarises outcomes in plain words, candidates, excluded by reason and rule pack versions', async () => {
    page();
    const s = await screen.findByTestId('period-summary');
    const t = s.textContent!;
    expect(t).toContain('219');
    expect(t).toMatch(/Assigned to an officer/);
    expect(t).toMatch(/Assigned to the Bureau/);
    expect(t).toMatch(/No officer could be assigned/);
    expect(t).toContain('7,534');
    expect(t).toContain('7,374');
    expect(t).toMatch(/160.*unavailable|unavailable.*160/);
    expect(t).toContain('2026-27 v3');
    expect(t).toContain('163');
    expect(s.closest('section')!.querySelector('details')!.textContent).toContain(DEFS.assignmentCandidates);
  });

  it('Why this officer: lists the recent decisions; selecting one requests its trace and shows the candidate table and the reason verbatim', async () => {
    page();
    const row = await screen.findByRole('row', { name: /W-2026-0025/ });
    fireEvent.click(row);
    await waitFor(() => expect(calls).toContain('/evidence/assignment-trace/app-1'));
    const p = panel('Why this officer?');
    await within(p).findByText(REASON);
    const table = within(p).getByRole('table', { name: /candidates/i });
    const header = Array.from(table.querySelectorAll('thead th')).map((h) => h.textContent);
    expect(header).toEqual(['Officer', 'Tier', 'Eligible', 'Excluded by', 'Capacity', 'Open points', 'Utilisation after this task', 'Score', 'Chosen']);
    const body = rowsOf(table as HTMLElement);
    expect(body).toEqual([
      ['Officer 2', '0', 'Yes', '—', '10', '3', '45%', '0.300', 'Chosen'],
      ['Officer 1', '0', 'Yes', '—', '10', '3', '50%', '0.400', 'Not chosen'],
      ['Officer 9', '0', 'No', 'Recused', '10', '3', '45%', '0.315', 'Not chosen'],
    ]);
    expect(p.textContent).not.toContain('EARLIER DECISION'); // only the selected decision, not every decision for the application
  });

  it('a BLOCKED decision says no officer could be assigned and every candidate is excluded with a reason', async () => {
    page();
    fireEvent.click(await screen.findByRole('row', { name: /S-2026-0100/ }));
    const p = panel('Why this officer?');
    await within(p).findByText(BLOCKED_REASON);
    expect(p).toHaveTextContent(/no officer could be assigned/i);
    const table = within(p).getByRole('table', { name: /candidates/i });
    const body = rowsOf(table as HTMLElement);
    expect(body).toHaveLength(2);
    expect(body.map((r) => [r[2], r[3], r[8]])).toEqual([['No', 'Unavailable', 'Not chosen'], ['No', 'Over capacity', 'Not chosen']]);
  });

  it('no decisions in the period is the insufficient-data state', async () => {
    windowed = { recentDecisions: [] };
    page('/admin/evidence/assignment?from=2099-01-01&to=2099-01-02');
    expect(await screen.findByText(/No assignment decision was recorded in this date range/)).toBeInTheDocument();
  });

  it('says explanations are recorded for automatic assignments only, using the coverage', async () => {
    page();
    const p = panel('Why this officer?');
    await within(p).findByText(/explanations are recorded for automatic assignments only/i);
    expect(p).toHaveTextContent('221 of 221');
  });

  it('every panel receives a definition: a missing one replaces the body with the no-definition error', async () => {
    impl = async () => ({ ...assignment(), definition: {} });
    page();
    await waitFor(() => expect(screen.getAllByText('This measure has no definition and is not shown').length).toBeGreaterThanOrEqual(6));
    expect(screen.queryByText('Officer 4')).toBeNull();
  });

  it('the word "fair" appears nowhere on the page, including after selecting a decision', async () => {
    const { container } = page();
    fireEvent.click(await screen.findByRole('row', { name: /W-2026-0025/ }));
    await screen.findByText(REASON);
    expect(container.textContent).not.toMatch(/\bfair/i);
    expect(document.body.innerHTML).not.toMatch(/\bfair/i);
  });


  it('a failed load shows a retry in each panel', async () => {
    let fail = true;
    impl = () => (fail ? Promise.reject(new Error('boom')) : Promise.resolve(assignment()));
    page();
    const retries = await screen.findAllByRole('button', { name: /retry|try again/i });
    expect(retries.length).toBeGreaterThanOrEqual(4);
    fail = false;
    fireEvent.click(retries[0]!);
    await loaded();
  });
});
