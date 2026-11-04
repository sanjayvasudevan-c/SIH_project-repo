import { describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { renderWithApp } from '../../../test/render';
import { ProjectStory } from './ProjectStory';

function CurrentUrl() {
  const location = useLocation();
  return <output data-testid="url">{location.pathname + location.search}</output>;
}

function HistoryControls() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(-1)}>Back</button>;
}

function app() {
  return <><Routes><Route path="/admin/project-story" element={<ProjectStory />} /></Routes><CurrentUrl /><HistoryControls /></>;
}

describe('ProjectStory', () => {
  it('opens deep-linked finding details and keeps the observed CI result visible', () => {
    renderWithApp(app(), { route: '/admin/project-story?chapter=findings&finding=assignment-capacity-exclusion' });

    expect(screen.getByRole('heading', { level: 1, name: /SIH26262/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Test findings' })).toBeInTheDocument();
    expect(screen.getByText(/Assigned to Naveen Thomas/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View CI run' })).toHaveAttribute('href', expect.stringContaining('41791850558'));
  });

  it('filters findings using the selected suite and search text', () => {
    renderWithApp(app(), { route: '/admin/project-story?chapter=findings' });
    fireEvent.change(screen.getByLabelText('Test suite'), { target: { value: 'api' } });
    fireEvent.change(screen.getByLabelText('Search findings'), { target: { value: 'over capacity' } });

    expect(screen.getByRole('button', { name: /Assignment test did not report expected/ })).toBeInTheDocument();
    expect(screen.getByText(/1 finding/)).toBeInTheDocument();
  });

  it('uses a suite result card to drill into that suite’s findings', () => {
    renderWithApp(app(), { route: '/admin/project-story?chapter=findings' });
    fireEvent.click(screen.getByRole('button', { name: /241 pass/ }));
    expect(screen.getByLabelText('Test suite')).toHaveValue('api');
  });

  it('selects architecture components and exposes their interfaces and related tests', () => {
    renderWithApp(app(), { route: '/admin/project-story?chapter=system' });
    fireEvent.click(screen.getAllByRole('button', { name: /^Assignment engine/ })[0]!);

    expect(screen.getByRole('region', { name: 'Component details' })).toHaveTextContent('/api/applications');
    fireEvent.click(within(screen.getByRole('region', { name: 'Component details' })).getByRole('button', { name: 'API integration tests' }));
    expect(screen.getByLabelText('Test suite')).toHaveValue('api');
  });

  it('updates the selected chapter in the URL when a chapter is chosen', () => {
    renderWithApp(app(), { route: '/admin/project-story?chapter=overview' });
    fireEvent.click(screen.getByRole('button', { name: 'What remains' }));
    expect(screen.getByTestId('url')).toHaveTextContent('/admin/project-story?chapter=remaining');
    expect(screen.getByRole('heading', { name: 'What remains' })).toBeInTheDocument();
  });

  it('restores the prior chapter when browser history goes back', () => {
    renderWithApp(app(), { route: '/admin/project-story?chapter=overview' });
    fireEvent.click(screen.getByRole('button', { name: 'The problem' }));
    expect(screen.getByRole('heading', { name: 'The problem' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Project overview' })).toBeInTheDocument();
    expect(screen.getByTestId('url')).toHaveTextContent('chapter=overview');
  });

  it('keeps the overview focused on the product and omits the separate evidence dashboard', () => {
    renderWithApp(app(), { route: '/admin/project-story?chapter=overview' });

    expect(screen.getByText(/role-based review, assignment, deadlines, and compliance/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Evidence Center/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Evidence and verification' })).not.toBeInTheDocument();
  });
});
