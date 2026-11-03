import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useEvidence } from './useEvidence';

vi.mock('../../../api/client', async (orig) => ({ ...(await orig<typeof import('../../../api/client')>()), api: { get: (path: string) => impl(path) } }));

// A plain function, not vi.fn: a spy that returns a rejecting promise leaves a derived promise unhandled and vitest fails the test.
let impl: (path: string) => Promise<unknown> = async () => ({});
const calls: string[] = [];
const respond = (f: (path: string) => Promise<unknown>) => {
  impl = (path) => {
    calls.push(path);
    return f(path);
  };
};

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

describe('useEvidence', () => {
  beforeEach(() => {
    calls.length = 0;
    impl = async () => ({});
  });

  it('puts the path and params in the query key and the URL', async () => {
    respond(async () => ({ ok: 1 }));
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useEvidence('workflow', { from: '2026-01-01', to: '2026-02-01' }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryCache().getAll().map((q) => q.queryKey)).toEqual([['evidence', 'workflow', { from: '2026-01-01', to: '2026-02-01' }]]);
    expect(calls).toEqual(['/evidence/workflow?from=2026-01-01&to=2026-02-01']);
  });
  it('surfaces an error to the caller', async () => {
    respond(() => Promise.reject(new Error('nope')));
    const { wrapper } = setup();
    function Probe() {
      const q = useEvidence('summary');
      return <p>{q.isError ? `error: ${(q.error as Error).message}` : 'pending'}</p>;
    }
    render(<Probe />, { wrapper });
    expect(await screen.findByText('error: nope')).toBeInTheDocument();
  });
  it('{from: undefined} and {} are the same question: one key, one request', async () => {
    respond(async () => ({}));
    const { client, wrapper } = setup();
    const a = renderHook(() => useEvidence('summary', { from: undefined }), { wrapper });
    const b = renderHook(() => useEvidence('summary', {}), { wrapper });
    await waitFor(() => expect(a.result.current.isSuccess && b.result.current.isSuccess).toBe(true));
    expect(client.getQueryCache().getAll()).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });
  it('different params are different keys', async () => {
    respond(async () => ({}));
    const { client, wrapper } = setup();
    renderHook(() => useEvidence('summary', { from: '2026-01-01' }), { wrapper });
    renderHook(() => useEvidence('summary', {}), { wrapper });
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(client.getQueryCache().getAll()).toHaveLength(2);
  });
});
