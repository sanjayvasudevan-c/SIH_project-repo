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
vi.mock('./pages/admin/evidence/EvidenceCenter', () => ({ EvidenceCenterPage: () => <h1>Evidence Center test page</h1> }));
vi.mock('./pages/NoAccess', () => ({ NoAccessPage: () => <h1>No access test page</h1> }));

function CurrentPath() {
  return <output data-testid="current-path">{useLocation().pathname}</output>;
}

describe('Evidence Center application route', () => {
  beforeEach(() => {
    auth.user.role = 'ADMIN';
  });

  it.each(['/admin/evidence', '/admin/evidence/overview'])('renders the Evidence Center at %s', async (route) => {
    renderWithApp(<><App /><CurrentPath /></>, { route });

    expect(await screen.findByRole('heading', { name: 'Evidence Center test page' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Administration test page' })).not.toBeInTheDocument();
    expect(screen.getByTestId('current-path')).toHaveTextContent(route);
  });

  it('keeps the Evidence Center behind the admin role check', async () => {
    auth.user.role = 'OFFICER';
    renderWithApp(<><App /><CurrentPath /></>, { route: '/admin/evidence/overview' });

    expect(screen.getByRole('heading', { name: 'No access test page' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Evidence Center test page' })).not.toBeInTheDocument();
  });
});
