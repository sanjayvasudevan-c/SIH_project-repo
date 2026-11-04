import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithApp } from '../../../test/render';
import { BOUNDARY_MESSAGE, SectionBoundary } from './ErrorBoundary';

let explode = true;
function Bomb() {
  if (explode) throw new Error('patient record 42 is malformed');
  return <p>fine</p>;
}

describe('SectionBoundary', () => {
  it('shows the fixed message and a Retry, never the error text, and logs nothing of its own', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    explode = true;
    const { container } = renderWithApp(
      <SectionBoundary>
        <Bomb />
      </SectionBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(BOUNDARY_MESSAGE);
    expect(container.textContent).not.toContain('patient record');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    // React reports the render error itself; the boundary adds nothing carrying the error's message.
    expect(log.mock.calls.flat().filter((a) => typeof a === 'string' && a.includes('patient record') && a.includes('SectionBoundary'))).toEqual([]);
    log.mockRestore();
  });

  it('Retry calls onRetry and shows the children again', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    explode = true;
    const onRetry = vi.fn(() => {
      explode = false;
    });
    renderWithApp(
      <SectionBoundary onRetry={onRetry}>
        <Bomb />
      </SectionBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByText('fine')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
