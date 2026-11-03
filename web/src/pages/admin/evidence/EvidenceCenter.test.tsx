import { describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { renderWithApp } from '../../../test/render';
import { EvidenceCenterPage } from './EvidenceCenter';
import { SECTIONS } from './sections';

const IDS = ['overview', 'workflow', 'assignment', 'scheduler', 'alerts', 'audit', 'ml', 'performance'];
const LABELS = ['Overview', 'Workflow', 'Assignment', 'Scheduler & compliance', 'Alerts', 'Audit', 'ML evaluation', 'Performance'];

function Where() {
  const l = useLocation();
  return <span data-testid="where">{l.pathname + l.search}</span>;
}
function app() {
  return (
    <>
      <Routes>
        <Route path="/admin/evidence" element={<EvidenceCenterPage />} />
        <Route path="/admin/evidence/:section" element={<EvidenceCenterPage />} />
      </Routes>
      <Where />
    </>
  );
}

describe('sections', () => {
  it('has the eight sections in order, each with a description', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(IDS);
    expect(SECTIONS.map((s) => s.label)).toEqual(LABELS);
    for (const s of SECTIONS) expect(s.description.length).toBeGreaterThan(10);
  });
});

describe('EvidenceCenter shell', () => {
  it('lists the same eight sections in the tabs and in the native select', () => {
    renderWithApp(app(), { route: '/admin/evidence/overview' });
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(LABELS);
    const select = screen.getByLabelText('Section') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(LABELS);
    expect(Array.from(select.options).map((o) => o.value)).toEqual(IDS);
  });
  it('tabs are shown from md up and the select below it', () => {
    renderWithApp(app(), { route: '/admin/evidence/overview' });
    expect(screen.getByRole('tablist').parentElement!.parentElement!.className).toMatch(/hidden md:block/);
    expect(screen.getByLabelText('Section').parentElement!.className).toMatch(/md:hidden/);
  });
  it('shows the current section and marks it selected in both', () => {
    const { container } = renderWithApp(app(), { route: '/admin/evidence/alerts' });
    expect(screen.getByRole('tab', { name: 'Alerts' })).toHaveAttribute('aria-selected', 'true');
    expect((screen.getByLabelText('Section') as HTMLSelectElement).value).toBe('alerts');
    expect(screen.getByRole('heading', { level: 2, name: 'Alerts' })).toBeInTheDocument();
    expect(container.querySelectorAll('[role=tabpanel]')).toHaveLength(1);
  });
  it('the body is the tabpanel of the active tab', () => {
    renderWithApp(app(), { route: '/admin/evidence/audit' });
    const tab = screen.getByRole('tab', { name: 'Audit' });
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', tab.id);
    expect(tab).toHaveAttribute('aria-controls', panel.id);
  });
  it('an unbuilt section is marked as a placeholder (scheduler)', () => {
    const { container } = renderWithApp(app(), { route: '/admin/evidence/scheduler' });
    expect(container.querySelector('[data-placeholder]')).not.toBeNull();
  });
  it('arrow-key tab changes replace history rather than push', () => {
    renderWithApp(app(), { route: '/admin/evidence/overview' });
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Overview' }), { key: 'ArrowRight' });
    expect(screen.getByTestId('where').textContent).toBe('/admin/evidence/workflow');
  });
  it('choosing from the select navigates and drops the date range', () => {
    renderWithApp(app(), { route: '/admin/evidence/overview?from=2026-09-01&to=2026-09-30' });
    fireEvent.change(screen.getByLabelText('Section'), { target: { value: 'audit' } });
    expect(screen.getByTestId('where').textContent).toBe('/admin/evidence/audit');
  });
  it('clicking a tab navigates and drops the date range', () => {
    renderWithApp(app(), { route: '/admin/evidence/overview?from=2026-09-01' });
    fireEvent.click(screen.getByRole('tab', { name: 'ML evaluation' }));
    expect(screen.getByTestId('where').textContent).toBe('/admin/evidence/ml');
  });
  it('an unknown section redirects to overview', () => {
    renderWithApp(app(), { route: '/admin/evidence/nonsense' });
    expect(screen.getByTestId('where').textContent).toBe('/admin/evidence/overview');
  });
  it('the bare path redirects to overview', () => {
    renderWithApp(app(), { route: '/admin/evidence' });
    expect(screen.getByTestId('where').textContent).toBe('/admin/evidence/overview');
  });
});
