import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { PrefsProvider } from '../lib/prefs';

/** Renders with the providers every page needs: preferences, a fresh query client, a memory router. */
export function renderWithApp(ui: ReactElement, { route = '/' }: { route?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // A wrapper (not wrapped markup) so that rerender() keeps the providers.
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PrefsProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
      </QueryClientProvider>
    </PrefsProvider>
  );
  return render(ui, { wrapper });
}
