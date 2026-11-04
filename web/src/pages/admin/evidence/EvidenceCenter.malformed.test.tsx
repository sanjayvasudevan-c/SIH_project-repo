import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithApp } from '../../../test/render';
import { EvidenceCenterPage } from './EvidenceCenter';
import { alerts, assignment, audit, compliance, engineRunsDetail, engineRuns, summary, workflow } from './sections/testFixtures';

vi.mock('../../../api/client', async (orig) => ({ ...(await orig<typeof import('../../../api/client')>()), api: { get: (path: string) => impl(path) } }));

let impl: (path: string) => Promise<unknown> = async () => ({});
// Each key is a path prefix; the first matching entry answers. A response is cloned before the test mutates it.
let served: Record<string, unknown> = {};
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const serve = (over: Record<string, unknown> = {}) => {
  served = {
    '/evidence/summary': summary(),
    '/evidence/workflow': workflow(),
    '/evidence/engine-runs?pageSize=1': engineRuns(),
    '/evidence/engine-runs': engineRunsDetail(),
    '/evidence/audit-analytics': audit(),
    '/evidence/compliance': compliance(),
    '/evidence/alerts': alerts(),
    '/evidence/assignment': assignment(),
    ...over,
  };
  impl = (path) => {
    const key = Object.keys(served).find((k) => path === k || path.startsWith(`${k}?`));
    return key ? Promise.resolve(clone(served[key])) : Promise.reject(new Error(`unexpected ${path}`));
  };
};
const BOUNDARY = 'This section could not be displayed. The data returned did not have the expected shape.';
const page = (section: string) =>
  renderWithApp(
    <Routes>
      <Route path="/admin/evidence/:section" element={<EvidenceCenterPage />} />
    </Routes>,
    { route: `/admin/evidence/${section}` },
  );
/** The shell survives: header, tabs and the section heading are still there. */
const shellPresent = (label: string) => {
  expect(screen.getByRole('heading', { level: 1, name: 'Evidence Center' })).toBeInTheDocument();
  expect(screen.getAllByRole('tab')).toHaveLength(8);
  expect(screen.getByRole('heading', { level: 2, name: label })).toBeInTheDocument();
};
/** Every request has been answered: no loading skeleton is left. Asserting earlier would pass on the loading screen. */
const loadedAll = () => waitFor(() => expect(document.querySelector('.animate-pulse')).toBeNull());

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  serve();
});

describe('a malformed response never blanks the Evidence Center', () => {
  it('Scheduler: /summary without provenance shows the shell and the section', async () => {
    const s = summary() as unknown as Record<string, unknown>;
    delete s.provenance;
    delete s.definition;
    serve({ '/evidence/summary': s });
    page('scheduler');
    await loadedAll();
    shellPresent('Scheduler & compliance');
    expect(screen.queryByText(BOUNDARY)).toBeNull();
    expect(screen.getAllByText(/Source not declared/).length).toBeGreaterThan(0);
  });

  it('Scheduler: /compliance without definition shows the shell and degraded panels', async () => {
    const c = compliance() as unknown as Record<string, unknown>;
    delete c.definition;
    delete c.provenance;
    serve({ '/evidence/compliance': c });
    page('scheduler');
    await loadedAll();
    shellPresent('Scheduler & compliance');
    expect(screen.queryByText(BOUNDARY)).toBeNull();
    expect(screen.getAllByText(/no definition/i).length).toBeGreaterThan(0);
  });

  it('Alerts: a response without data.byKind still shows the shell', async () => {
    const a = alerts() as unknown as { data: Record<string, unknown> };
    delete a.data.byKind;
    delete a.data.perDay;
    delete a.data.escalationsByLevel;
    serve({ '/evidence/alerts': a });
    page('alerts');
    await loadedAll();
    shellPresent('Alerts');
    expect(screen.queryByText(BOUNDARY)).toBeNull();
  });

  it('Alerts: a response with no data at all shows the boundary or degraded state, with the shell', async () => {
    serve({ '/evidence/alerts': { definition: {}, provenance: {} } });
    page('alerts');
    await loadedAll();
    shellPresent('Alerts');
  });

  it('Assignment: candidates stored as unexpected JSON shows the shell, not a blank page', async () => {
    serve({
      '/evidence/assignment-trace/app-1': { rows: [{ id: '221', assignmentId: 'y', applicationId: 'app-1', taskType: 'SCRUTINY', decidedAt: '2026-11-02T09:03:00.000Z', chosenOfficerId: 'x', outcome: 'ASSIGNED', weight: 1, reasonText: 'R', candidates: [{ officerId: 'a', name: 'A', tier: 0, eligible: true, excludedBy: null, chosen: true, capacity: 1, openPoints: 1, projectedUtil: 0.5 }] }], coverage: { tracedCount: 1, assignmentTotal: 1, blockedCount: 0 } },
    });
    page('assignment');
    await loadedAll();
    fireEvent.click(await screen.findByRole('row', { name: /W-2026-0025/ }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 4, name: /W-2026-0025/ })).toBeInTheDocument());
    shellPresent('Assignment');
    expect(within(screen.getByRole('region', { name: /Candidates considered/ })).getAllByText('Unavailable').length).toBeGreaterThan(0); // the missing score reads Unavailable, not a throw
  });

  it('Assignment: candidates that are not a list show the shell and no candidate rows', async () => {
    serve({
      '/evidence/assignment-trace/app-1': { rows: [{ id: '221', assignmentId: 'y', applicationId: 'app-1', taskType: 'SCRUTINY', decidedAt: '2026-11-02T09:03:00.000Z', chosenOfficerId: 'x', outcome: 'ASSIGNED', weight: 1, reasonText: 'R', candidates: 'not a list' }], coverage: { tracedCount: 1, assignmentTotal: 1, blockedCount: 0 } },
    });
    page('assignment');
    await loadedAll();
    fireEvent.click(await screen.findByRole('row', { name: /W-2026-0025/ }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 4, name: /W-2026-0025/ })).toBeInTheDocument());
    shellPresent('Assignment');
    expect(screen.getByText('No candidates are stored for this decision.')).toBeInTheDocument();
  });

  it('Assignment: officers without a list shows the shell', async () => {
    const a = assignment() as unknown as { data: Record<string, unknown> };
    delete a.data.officers;
    delete a.data.outcomes;
    serve({ '/evidence/assignment': a });
    page('assignment');
    await loadedAll();
    shellPresent('Assignment');
  });

  it('Overview: a summary with no scheduler block and a workflow with no data still shows the shell', async () => {
    const s = summary() as unknown as Record<string, unknown>;
    delete s.scheduler;
    serve({ '/evidence/summary': s, '/evidence/workflow': { definition: {}, provenance: {} } });
    page('overview');
    await loadedAll();
    shellPresent('Overview');
  });

  it('Overview: an unknown summary status reads as a word, not an empty value', async () => {
    serve({ '/evidence/summary': summary({ status: 'WEIRD' as never }) });
    page('overview');
    await waitFor(() => expect(screen.getByText('Unknown status: WEIRD')).toBeInTheDocument());
    expect(screen.getByText('Unknown status: WEIRD').className).toMatch(/text-warning/);
  });

  it('the boundary message and Retry appear when a section throws, and Retry remounts it', async () => {
    // A workflow whose funnel rows are numbers makes the chart row mapping throw inside a render.
    const w = workflow() as unknown as { data: Record<string, unknown> };
    w.data.funnel = [null];
    serve({ '/evidence/workflow': w });
    page('workflow');
    await waitFor(() => expect(screen.getByText(BOUNDARY)).toBeInTheDocument());
    shellPresent('Workflow');
    expect(screen.getByRole('alert')).toHaveTextContent(BOUNDARY);
    serve(); // the API recovers
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByText(BOUNDARY)).toBeNull());
  });
});
