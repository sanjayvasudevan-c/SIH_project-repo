import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithApp } from '../../../../test/render';
import { OverviewSection } from './overview';
import { WorkflowSection } from './workflow';
import { audit, DEFS, engineRuns, summary, workflow } from './testFixtures';

vi.mock('../../../../api/client', async (orig) => ({ ...(await orig<typeof import('../../../../api/client')>()), api: { get: (path: string) => impl(path) } }));

// Plain functions, not vi.fn: a spy returning a rejecting promise fails the test with an unhandled rejection.
let impl: (path: string) => Promise<unknown> = async () => ({});
const calls: string[] = [];
// The API's own definitions legitimately explain what a scheduler is not; the claim test is about what the page asserts.
const outsideDefinitions = (root: HTMLElement) => {
  const c = root.cloneNode(true) as HTMLElement;
  c.querySelectorAll('details').forEach((d) => d.remove());
  return c.textContent!.toLowerCase();
};
let data: Record<string, () => Promise<unknown>> = {};
const serve = (over: Record<string, () => Promise<unknown>> = {}) => {
  data = { '/evidence/summary': async () => summary(), '/evidence/workflow': async () => workflow(), '/evidence/engine-runs?pageSize=1': async () => engineRuns(), '/evidence/audit-analytics': async () => audit(), ...over };
  impl = (path) => {
    calls.push(path);
    const f = data[path];
    return f ? f() : Promise.reject(new Error(`unexpected ${path}`));
  };
};

beforeEach(() => {
  calls.length = 0;
  serve();
});

describe('Overview', () => {
  it('shows four tiles, each with its label, value and definition', async () => {
    const { container } = renderWithApp(<OverviewSection />);
    await screen.findByText('Not verified');
    for (const l of ['Test verification', 'Applications in flight', 'Last recorded scheduler cycle', 'Audit log integrity']) expect(screen.getByText(l)).toBeInTheDocument();
    expect(await screen.findByText('146')).toBeInTheDocument();
    expect(await screen.findByText('Intact')).toBeInTheDocument();
    const text = container.textContent!;
    for (const d of [DEFS.status, 'PROCESSING DEF', DEFS.scheduler, DEFS.integrity]) expect(text).toContain(d.slice(0, 20));
    expect(container.querySelectorAll('details').length).toBeGreaterThanOrEqual(5);
  });

  it('NOT_VERIFIED reads in words with warning emphasis and no success styling', async () => {
    const { container } = renderWithApp(<OverviewSection />);
    const v = await screen.findByText('Not verified');
    expect(v.className).toMatch(/text-warning/);
    expect(v.className).not.toMatch(/success/);
    expect(screen.getByText(/db3e584/)).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/text-success|bg-success/);
    expect(screen.queryByText('Passed')).toBeNull();
  });

  it('PASS reads Passed; FAIL is danger; STALE shows both commits in warning', async () => {
    serve({ '/evidence/summary': async () => summary({ status: 'FAIL', artifactCommit: 'a'.repeat(40) }) });
    const a = renderWithApp(<OverviewSection />);
    expect((await screen.findByText('Failed')).className).toMatch(/text-danger/);
    a.unmount();
    serve({ '/evidence/summary': async () => summary({ status: 'STALE', artifactCommit: '1234567890abcdef1234567890abcdef12345678' }) });
    const b = renderWithApp(<OverviewSection />);
    const stale = await screen.findByText('Out of date');
    expect(stale.className).toMatch(/text-warning/);
    expect(b.container.textContent).toContain('1234567');
    expect(b.container.textContent).toContain('db3e584');
    b.unmount();
    serve({ '/evidence/summary': async () => summary({ status: 'PASS', artifactCommit: 'db3e5844d2aaf91f18601ebd89bd5511857d837e' }) });
    renderWithApp(<OverviewSection />);
    expect(await screen.findByText('Passed')).toBeInTheDocument();
  });

  it('no scheduler cycle recorded: insufficient message and the word healthy appears nowhere', async () => {
    serve({ '/evidence/summary': async () => summary({ scheduler: { lastRunAt: null, lastStatus: null, lastDurationMs: null, stuckRuns: 0, heartbeat: null } }) });
    const { container } = renderWithApp(<OverviewSection />);
    expect(await screen.findByText('No scheduler cycle has been recorded.')).toBeInTheDocument();
    await screen.findByText('Intact');
    expect(container.textContent!.toLowerCase()).not.toContain('healthy');
    expect(outsideDefinitions(container)).not.toMatch(/healthy|running|\bdown\b/);
  });

  it('scheduler tile: status word, start time with age, duration, simulated date, heartbeat and stuck runs; never healthy/running/down', async () => {
    const { container } = renderWithApp(<OverviewSection />);
    await screen.findByText('Finished');
    await waitFor(() => expect(container.textContent).toContain('3 Nov 2026'));
    const t = container.textContent!;
    expect(t).toMatch(/4 h ago/);
    expect(t).toContain('742 ms');
    expect(t).toContain('No scheduler process has reported to this database');
    expect(t).toContain('0 stuck runs');
    expect(t.toLowerCase()).not.toContain('healthy');
    expect(outsideDefinitions(container)).not.toMatch(/healthy|running|\bdown\b/);
  });

  it('scheduler tile with a heartbeat and stuck runs', async () => {
    serve({ '/evidence/summary': async () => summary({ scheduler: { lastRunAt: new Date(Date.now() - 3600_000).toISOString(), lastStatus: 'FAILED', lastDurationMs: 2500, stuckRuns: 2, heartbeat: { instanceId: 'x', isLeader: true, lastSeenAt: 'x', ageSeconds: 120 } } }) });
    const { container } = renderWithApp(<OverviewSection />);
    const v = await screen.findByText('Failed');
    expect(v.className).toMatch(/text-danger/);
    expect(container.textContent).toContain('Last process heartbeat 2 min ago');
    expect(container.textContent).toContain('2 stuck runs');
  });

  it('audit tile: Broken is danger; counts and whole log are stated', async () => {
    serve({ '/evidence/audit-analytics': async () => audit(false) });
    const { container } = renderWithApp(<OverviewSection />);
    expect((await screen.findByText('Broken')).className).toMatch(/text-danger/);
    expect(container.textContent).toContain('193 chains · 782 rows checked · whole log');
  });

  it('applications in flight: hint states submitted and decided', async () => {
    const { container } = renderWithApp(<OverviewSection />);
    await screen.findByText('146');
    expect(container.textContent).toContain('of 191 submitted · 45 decided');
  });

  it('the trend: one chart whose data table equals the API rows (submitted and decided only)', async () => {
    const { container } = renderWithApp(<OverviewSection />);
    await screen.findByText('146');
    const table = await screen.findByRole('table', { hidden: true });
    const body = Array.from(table.querySelectorAll('tbody tr')).map((r) => Array.from(r.querySelectorAll('td')).map((c) => c.textContent));
    expect(body).toEqual([['21 May 2026', '1', '0'], ['28 May 2026', '0', '1'], ['3 Jun 2026', '3', '1']]);
    expect(within(table).queryByText(/overdue/i)).toBeNull();
    expect(container.querySelectorAll('[role=img]')).toHaveLength(1);
    expect(container.textContent).toContain('21 May 2026 to 3 Jun 2026');
    expect(container.textContent).toContain('days with no events are not shown');
    expect(container.textContent).toContain(DEFS.volumeOverTime);
  });

  it('trend with one day is insufficient; with none is empty', async () => {
    serve({ '/evidence/workflow': async () => workflow({ volumeOverTime: [{ day: '2026-05-21', submitted: 1, decided: 0, overdue: 0 }] }) });
    const a = renderWithApp(<OverviewSection />);
    expect(await screen.findByText(/at least two days/i)).toBeInTheDocument();
    a.unmount();
    serve({ '/evidence/workflow': async () => workflow({ submittedTotal: 0, volumeOverTime: [] }) });
    renderWithApp(<OverviewSection />);
    expect(await screen.findByText('No applications have been submitted yet.')).toBeInTheDocument();
  });

  it('tile and detail cannot disagree: Overview and Workflow share ONE workflow request and the same number', async () => {
    renderWithApp(
      <>
        <OverviewSection />
        <WorkflowSection />
      </>,
    );
    await screen.findByText(/146 still in progress/);
    expect((await screen.findAllByText('146')).length).toBeGreaterThanOrEqual(1);
    expect(calls.filter((c) => c === '/evidence/workflow')).toHaveLength(1);
  });

  it('every tile with no definition refuses to show its value', async () => {
    serve({ '/evidence/summary': async () => summary({ definition: {} }), '/evidence/audit-analytics': async () => ({ ...audit(), definition: {} }), '/evidence/workflow': async () => ({ ...workflow(), definition: {} }) });
    renderWithApp(<OverviewSection />);
    await waitFor(() => expect(screen.getAllByText('This measure has no definition and is not shown').length).toBeGreaterThanOrEqual(4));
    expect(screen.queryByText('Not verified')).toBeNull();
    expect(screen.queryByText('Intact')).toBeNull();
    expect(screen.queryByText('146')).toBeNull();
  });

  it('shows loading, then an error with a working retry', async () => {
    let fail = true;
    serve({ '/evidence/summary': async () => (fail ? Promise.reject(new Error('boom')) : summary()) });
    renderWithApp(<OverviewSection />);
    const retry = (await screen.findAllByRole('button', { name: /retry|try again/i }))[0];
    fail = false;
    fireEvent.click(retry);
    expect(await screen.findByText('Not verified')).toBeInTheDocument();
  });

  it('missing counts read Unavailable, never 0', async () => {
    serve({ '/evidence/audit-analytics': async () => ({ ...audit(), data: { total: 0, integrity: { ok: true, chainsChecked: null, rowsChecked: null, brokenChainCount: 0, scope: 'WHOLE_LOG' } } }) });
    const { container } = renderWithApp(<OverviewSection />);
    await screen.findByText('Intact');
    expect(container.textContent).toContain('Unavailable chains');
  });
});
