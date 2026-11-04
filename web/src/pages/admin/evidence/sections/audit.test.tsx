import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { renderWithApp } from '../../../../test/render';
import { AuditSection } from './audit';
import { AUDIT_DEFS, auditAnalytics } from './testFixtures';

vi.mock('../../../../api/client', async (orig) => ({ ...(await orig<typeof import('../../../../api/client')>()), api: { get: (path: string) => impl(path) } }));

let impl: (path: string) => Promise<unknown> = async () => ({});
const calls: string[] = [];
let failAll = false;
let respond: (path: string) => unknown;
beforeEach(() => {
  calls.length = 0;
  failAll = false;
  respond = () => auditAnalytics();
  impl = (path) => {
    calls.push(path);
    return failAll ? Promise.reject(new Error('down')) : Promise.resolve(respond(path));
  };
});

function Where() {
  return <span data-testid="where">{useLocation().search}</span>;
}
const page = (route = '/admin/evidence/audit') =>
  renderWithApp(
    <>
      <Routes>
        <Route path="/admin/evidence/:section" element={<AuditSection />} />
      </Routes>
      <Where />
    </>,
    { route },
  );
const panel = (title: string) => screen.getByRole('heading', { name: (n) => n.startsWith(title) }).closest('section')!;
const bodyOf = (el: HTMLElement) => Array.from(el.querySelectorAll('tbody tr')).map((r) => Array.from(r.querySelectorAll('td')).map((c) => c.textContent));
const loaded = () => waitFor(() => expect(screen.getAllByText(/n = 772 audit events/).length).toBeGreaterThan(0));
const optionValues = (label: string) => Array.from((screen.getByLabelText(label) as HTMLSelectElement).options).map((o) => o.value);

describe('Audit', () => {
  it('sends the range and names the clock', async () => {
    page('/admin/evidence/audit?from=2026-10-01&to=2026-10-31');
    await waitFor(() => expect(calls).toEqual(['/evidence/audit-analytics?from=2026-10-01&to=2026-10-31']));
    expect(screen.getByText(/Dates are audit event dates/)).toBeInTheDocument();
  });

  it('select options equal the values in the response, plus All', async () => {
    page();
    await loaded();
    expect(optionValues('Actor role')).toEqual(['', 'COLLEGE', 'OFFICER', 'AUTHORITY', 'SYSTEM', 'ADMIN']);
    expect(optionValues('Action')).toEqual(['', 'ASSIGN', 'SUBMIT', 'RELEASE', 'FORM_CHECK_JUSTIFIED', 'LOGIN']);
    expect(optionValues('Entity')).toEqual(['', 'APPLICATION', 'SYSTEM', 'RULE_PACK']);
  });

  it('three breakdown panels list the API counts and the scope line states n and the window', async () => {
    page();
    await loaded();
    expect(bodyOf(within(panel('Events by action')).getByRole('table', { hidden: true }) as HTMLElement)[0]).toEqual(['Assign', '220']);
    expect(bodyOf(within(panel('Events by actor role')).getByRole('table', { hidden: true }) as HTMLElement)[0]).toEqual(['College', '428']);
    expect(bodyOf(within(panel('Events by entity')).getByRole('table', { hidden: true }) as HTMLElement)).toEqual([['Application', '724'], ['System', '28'], ['Rule pack', '20']]);
    expect(panel('Events by action').textContent).toContain('n = 772 audit events · all dates');
  });

  it('choosing a filter writes it to the URL, requests with it, and shows a removable chip', async () => {
    respond = (p) => (p.includes('actor=ADMIN') ? auditAnalytics({ total: 70, filters: { actor: 'ADMIN', action: null, entity: null } }) : auditAnalytics());
    page();
    await loaded();
    fireEvent.change(screen.getByLabelText('Actor role'), { target: { value: 'ADMIN' } });
    expect(screen.getByTestId('where').textContent).toBe('?actor=ADMIN');
    await waitFor(() => expect(calls).toContain('/evidence/audit-analytics?actor=ADMIN'));
    await waitFor(() => expect(screen.getAllByText(/n = 70 audit events/).length).toBeGreaterThan(0));
    // the options still come from the unfiltered answer, so the filter can be changed
    expect(optionValues('Actor role')).toContain('COLLEGE');
    const chip = screen.getByRole('button', { name: /Remove filter: Actor role Admin/ });
    fireEvent.click(chip);
    expect(screen.getByTestId('where').textContent).toBe('');
    expect(screen.queryByRole('button', { name: /Remove filter/ })).toBeNull();
  });

  it('an unknown value in the URL is ignored: not sent, no chip', async () => {
    page('/admin/evidence/audit?actor=NOBODY&entity=LOGIN&action=ASSIGN');
    await waitFor(() => expect(calls.at(-1)).toBe('/evidence/audit-analytics?action=ASSIGN'));
    expect(calls.some((c) => /NOBODY|LOGIN/.test(c))).toBe(false);
    expect(screen.getAllByRole('button', { name: /Remove filter/ })).toHaveLength(1);
    expect((screen.getByLabelText('Actor role') as HTMLSelectElement).value).toBe('');
  });

  it('integrity card: verbatim definition visible, the whole-log line, honest limits, no tamper-proof claim', async () => {
    const { container } = page();
    await loaded();
    const p = panel('Audit log integrity');
    expect(within(p).getAllByText(AUDIT_DEFS.integrity).length).toBeGreaterThan(0);
    expect(within(p).getAllByText(AUDIT_DEFS.integrity).some((el) => !el.closest('details'))).toBe(true);
    expect(p.textContent).toContain('Checked over the whole audit log. Filters and dates do not change it.');
    expect(p.textContent).toMatch(/193 chains/);
    expect(p.textContent).toMatch(/772 events/);
    expect(p.textContent).toMatch(/No broken chain found/);
    expect(p.textContent).toMatch(/edits that do not recompute the whole forward hash chain/);
    expect(p.textContent).toMatch(/cannot update or delete audit rows/);
    expect(p.textContent).toMatch(/owns the database table can disable/);
    expect(p.textContent).toMatch(/not tamper-proof against a database administrator/);
    expect(container.textContent).not.toMatch(/(?<!not )tamper-proof|cannot be altered|guarantee/i);
  });

  it('a failed check is stated plainly with the broken-chain count', async () => {
    respond = () => auditAnalytics({ integrity: { ok: false, chainsChecked: 193, rowsChecked: 772, brokenChainCount: 2, scope: 'WHOLE_LOG' } });
    page();
    await loaded();
    expect(panel('Audit log integrity').textContent).toMatch(/2 chains do not verify/);
  });

  it('filters leave the integrity figures as the API returned them', async () => {
    respond = (p) => (p.includes('actor=') ? auditAnalytics({ total: 70 }) : auditAnalytics());
    page('/admin/evidence/audit?actor=ADMIN');
    await waitFor(() => expect(screen.getAllByText(/n = 70 audit events/).length).toBeGreaterThan(0));
    expect(panel('Audit log integrity').textContent).toMatch(/772 events/);
  });

  it('never renders case fields', async () => {
    const { container } = page();
    await loaded();
    for (const f of ['fromState', 'toState', 'rowHash', 'prevHash', 'applicationId']) expect(container.textContent).not.toContain(f);
  });

  it('no events in the range is an empty state, not zero bars', async () => {
    respond = () => auditAnalytics({ total: 0, byActorRole: [], byAction: [], byEntity: [] });
    const { container } = page();
    await waitFor(() => expect(screen.getAllByText(/No audit events/).length).toBeGreaterThan(2));
    expect(container.querySelectorAll('[role=img]')).toHaveLength(0);
  });

  it('retry on error, and every panel has its definition', async () => {
    failAll = true;
    page();
    expect((await screen.findAllByRole('button', { name: /retry|try again/i })).length).toBeGreaterThan(2);
  });
  it('every panel carries a definition', async () => {
    page();
    await loaded();
    for (const t of ['Events by action', 'Events by actor role', 'Events by entity', 'Audit log integrity']) expect(panel(t).querySelector('details')).not.toBeNull();
  });
});
