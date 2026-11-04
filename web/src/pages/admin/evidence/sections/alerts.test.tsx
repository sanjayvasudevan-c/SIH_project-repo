import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithApp } from '../../../../test/render';
import { AlertsSection } from './alerts';
import { ALERT_DEFS, alerts } from './testFixtures';

vi.mock('../../../../api/client', async (orig) => ({ ...(await orig<typeof import('../../../../api/client')>()), api: { get: (path: string) => impl(path) } }));

let impl: (path: string) => Promise<unknown> = async () => ({});
const calls: string[] = [];
let over: Parameters<typeof alerts>[0] = {};
let failAll = false;
beforeEach(() => {
  calls.length = 0;
  over = {};
  failAll = false;
  impl = (path) => {
    calls.push(path);
    return failAll ? Promise.reject(new Error('down')) : Promise.resolve(alerts(over));
  };
});

const page = (route = '/admin/evidence/alerts') =>
  renderWithApp(
    <Routes>
      <Route path="/admin/evidence/:section" element={<AlertsSection />} />
    </Routes>,
    { route },
  );
const panel = (title: string) => screen.getByRole('heading', { name: (n) => n.startsWith(title) }).closest('section')!;
const kpi = (label: string) => screen.getByText(label).parentElement as HTMLElement;
const bodyOf = (el: HTMLElement) => Array.from(el.querySelectorAll('tbody tr')).map((r) => Array.from(r.querySelectorAll('td')).map((c) => c.textContent));
const loaded = () => waitFor(() => expect(kpi('Alerts raised').textContent).toMatch(/\d/));

describe('Alerts', () => {
  it('sends the date range to the alerts request and names the clock', async () => {
    page('/admin/evidence/alerts?from=2026-10-01&to=2026-10-31');
    await loaded();
    expect(calls).toEqual(['/evidence/alerts?from=2026-10-01&to=2026-10-31']);
    expect(screen.getByText(/system's own calendar/)).toBeInTheDocument();
  });

  it('KPIs: alerts raised, escalations, and late reminders as "21 of 22 reminders"', async () => {
    page();
    await loaded();
    expect(kpi('Alerts raised')).toHaveTextContent('107');
    expect(kpi('Escalations')).toHaveTextContent('31');
    expect(kpi('Reminders raised late')).toHaveTextContent('21 of 22 reminders');
    expect(kpi('Reminders raised late').querySelector('details')!.textContent).toContain(ALERT_DEFS.reminderTiming);
  });

  it('never presents a share of all alerts as on time', async () => {
    const { container } = page();
    await loaded();
    expect(container.textContent).not.toMatch(/% on time|raised on time|are on time|on-time/i);
    expect(container.textContent).not.toMatch(/\b(?:1|1\.\d+|0\.9\d*)%\b.*on/i);
    expect(kpi('Reminders raised late').textContent).toContain('reminders only');
  });

  it('alerts by kind uses plain-language names and the API counts', async () => {
    page();
    await loaded();
    const rows = bodyOf(within(panel('Alerts by kind')).getByRole('table', { hidden: true }) as HTMLElement);
    expect(rows).toEqual([['Deadline at risk', '17'], ['Daily digest', '16'], ['Escalation', '31'], ['Deadline overdue', '21'], ['Reminder', '22']]);
  });

  it('alerts per day lists exactly the API days, none with zero, and says a missing day is not "no alerts"', async () => {
    page();
    await loaded();
    const p = panel('Alerts per day');
    expect(bodyOf(within(p).getByRole('table', { hidden: true }) as HTMLElement)).toEqual([['14 Sept 2026', '1'], ['5 Oct 2026', '3'], ['19 Oct 2026', '16'], ['2 Nov 2026', '43']].map(([d, c]) => [d!.replace('Sept', 'Sep'), c]));
    expect(p.textContent).toContain('These are the days the deadline engine ran; a missing day means it did not run, not that there were no alerts.');
    expect(p.querySelector('details')!.textContent).toContain(ALERT_DEFS.perDay);
  });

  it('escalations by level lists the levels returned', async () => {
    page();
    await loaded();
    expect(bodyOf(within(panel('Escalations by level')).getByRole('table', { hidden: true }) as HTMLElement)).toEqual([['Level 1', '20'], ['Level 2', '8'], ['Level 3', '3']]);
  });

  it('alert status is an insufficient-data panel: acknowledgement not recorded, alert-to-close recorded but not computed, no chart', async () => {
    page();
    await loaded();
    const p = panel('Alert status');
    expect(p.textContent).toMatch(/acknowledgement/);
    expect(p.textContent).not.toMatch(/resolution time/i);
    expect(p.textContent).toMatch(/does not compute or chart it/);
    expect(p.textContent).toMatch(/deadline item closing|followed by its deadline item closing/);
    expect(p.textContent).toContain('NOTCOMPUTED DEF');
    expect(document.body.textContent).not.toMatch(/\bfair/i);
    expect(p.querySelector('[role=img]')).toBeNull();
    expect(p.textContent).toContain('None of the 810 notifications has been opened');
    expect(p.textContent).toContain('says nothing about whether anyone responded');
  });

  it('informative notification read state is shown as counts', async () => {
    over = { notifications: { total: 810, read: 40, unread: 770, informative: true } };
    page();
    await loaded();
    const p = panel('Alert status');
    expect(p.textContent).toContain('40 of 810 notifications have been opened');
    expect(p.textContent).not.toContain('None of the');
  });

  it('total null is "no engine activity recorded", not zero', async () => {
    over = { engineEverRan: false, total: null, byKind: [], reminderTiming: null, perDay: [], escalationsByLevel: [] };
    const { container } = page();
    await waitFor(() => expect(screen.getAllByText(/No engine activity recorded/).length).toBeGreaterThan(2));
    expect(kpi('Alerts raised').textContent).not.toMatch(/\b0\b/);
    expect(kpi('Reminders raised late').textContent).not.toMatch(/\b0\b/);
    expect(container.querySelector('[role=img]')).toBeNull();
  });

  it('total 0 is a genuine zero', async () => {
    over = { total: 0, byKind: [], reminderTiming: { reminders: 0, onTime: 0, late: 0 }, perDay: [], escalationsByLevel: [] };
    page();
    await waitFor(() => expect(kpi('Alerts raised')).toHaveTextContent('0'));
    expect(kpi('Escalations')).toHaveTextContent('0');
    expect(kpi('Reminders raised late')).toHaveTextContent('0 of 0 reminders');
  });

  it('shows retry on error and loading before data', async () => {
    failAll = true;
    page();
    expect((await screen.findAllByRole('button', { name: /retry|try again/i })).length).toBeGreaterThan(3);
  });

  it('every panel carries its definition', async () => {
    page();
    await loaded();
    for (const t of ['Alerts by kind', 'Alerts per day', 'Escalations by level', 'Alert status']) expect(panel(t).querySelector('details')).not.toBeNull();
  });
});
