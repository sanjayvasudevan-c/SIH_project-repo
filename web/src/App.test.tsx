import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { renderWithApp } from './test/render';
import { App } from './App';

vi.mock('./auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'admin-test', role: 'ADMIN' }, loading: false }),
}));
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
  it.each(['/admin/evidence', '/admin/evidence/overview'])('redirects %s to Administration', (route) => {
    renderWithApp(<><App /><CurrentPath /></>, { route });

    expect(screen.getByRole('heading', { name: 'Administration test page' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Evidence Center test page' })).not.toBeInTheDocument();
    expect(screen.getByTestId('current-path')).toHaveTextContent('/admin');
  });
});
