import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { renderWithApp } from '../test/render';
import { BureauQueuePage, CommitteeQueuePage } from './Queues';

afterEach(() => vi.restoreAllMocks());

describe('role queue error states', () => {
  it.each([
    ['committee', CommitteeQueuePage, 'SAC/SHC cases'],
    ['bureau', BureauQueuePage, 'SAC/SHC forwarding'],
  ])('%s reports a failed secondary table and retries its queue query', async (_name, Page, caption) => {
    const request = vi.spyOn(api, 'get').mockRejectedValue(new Error('Queue service unavailable'));
    renderWithApp(<Page />);

    const table = await screen.findByRole('region', { name: caption });
    const alerts = await screen.findAllByRole('alert');
    expect(alerts[alerts.length - 1]).toHaveTextContent('Queue service unavailable');
    expect(table).not.toHaveTextContent(caption === 'SAC/SHC cases' ? 'No cases are waiting' : 'No SAC/SHC cases are waiting');
    const retries = screen.getAllByRole('button', { name: 'Try again' });
    fireEvent.click(retries[retries.length - 1]!);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });
});
