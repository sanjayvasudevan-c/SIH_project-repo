import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import { renderWithApp } from '../../test/render';
import { AdminPage } from './Admin';

afterEach(() => vi.restoreAllMocks());

describe('Admin directory', () => {
  it('shows a recoverable error instead of an empty directory when loading fails', async () => {
    const request = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/demo/clock') return { now: new Date().toISOString(), today: '2026-11-04', offsetDays: 0, simulated: false } as never;
      throw new Error('Directory service unavailable');
    });
    renderWithApp(<AdminPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Directory' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the directory.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('/admin/directory'));
    expect(request).toHaveBeenCalledTimes(3); // initial clock + directory + retry
  });

  it('marks scheduler metrics unavailable on request failure and offers retry', async () => {
    const request = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/demo/clock') return { now: new Date().toISOString(), today: '2026-11-04', offsetDays: 0, simulated: false } as never;
      throw new Error('Scheduler service unavailable');
    });
    renderWithApp(<AdminPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Scheduler' }));

    expect(await screen.findAllByText('Could not load scheduler status.')).toHaveLength(2);
    expect(screen.getAllByText('Unavailable')).toHaveLength(3);
    expect(screen.queryByText('No scheduler has reported yet.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(request.mock.calls.filter(([path]) => path === '/admin/scheduler')).toHaveLength(2));
  });
});
