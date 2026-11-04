import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { renderWithApp } from './test/render';
import { App } from './App';

const { auth } = vi.hoisted(() => ({ auth: { user: { id: 'admin-test', role: 'ADMIN' }, loading: false } }));
vi.mock('./auth/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('./components/Layout', async () => {
  const { Outlet } = await import('react-router-dom');
  return { Layout: () => <Outlet /> };
});
vi.mock('./pages/admin/Admin', () => ({ AdminPage: () => <h1>Administration test page</h1> }));
vi.mock('./pages/admin/projectStory/ProjectStory', () => ({ ProjectStory: () => <h1>Project review test page</h1> }));
vi.mock('./pages/NoAccess', () => ({ NoAccessPage: () => <h1>No access test page</h1> }));

function CurrentPath() {
  return <output data-testid="current-path">{useLocation().pathname}</output>;
}

describe('removed Evidence Center routes', () => {
  beforeEach(() => {
    auth.user.role = 'ADMIN';
  });

  it.each(['/admin/evidence', '/admin/evidence/overview'])('does not register %s', (route) => {
    renderWithApp(<><App /><CurrentPath /></>, { route });

    expect(screen.getByRole('heading', { name: 'No access test page' })).toBeInTheDocument();
    expect(screen.getByTestId('current-path')).toHaveTextContent(route);
  });
});

describe('Project review application route', () => {
  beforeEach(() => {
    auth.user.role = 'ADMIN';
  });

  it('renders the project reviewer journey for ADMIN', async () => {
    renderWithApp(<App />, { route: '/admin/project-story?chapter=findings' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Project review test page' })).toBeInTheDocument();
  });

  it('keeps the project reviewer journey behind the ADMIN role check', () => {
    auth.user.role = 'OFFICER';
    renderWithApp(<App />, { route: '/admin/project-story' });
    expect(screen.getByRole('heading', { name: 'No access test page' })).toBeInTheDocument();
  });
});
