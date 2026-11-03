import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { Route, Routes, useNavigate, useLocation } from 'react-router-dom';
import { renderWithApp } from '../../../test/render';
import { DateRange, useRange } from './DateRange';

const CLOCK = "Dates apply to the system's own calendar";

describe('DateRange', () => {
  it('labels From and To and shows the clock label', () => {
    renderWithApp(<DateRange onChange={() => {}} clockLabel={CLOCK} />);
    expect(screen.getByLabelText('From')).toBeInTheDocument();
    expect(screen.getByLabelText('To')).toBeInTheDocument();
    expect(screen.getByText(CLOCK)).toBeVisible();
  });
  it('reports a valid range', () => {
    const onChange = vi.fn();
    renderWithApp(<DateRange onChange={onChange} clockLabel={CLOCK} from="2026-10-01" />);
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-31' } });
    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-10-01', to: '2026-10-31' });
  });
  it('rejects from > to with a visible message and does not call onChange', () => {
    const onChange = vi.fn();
    renderWithApp(<DateRange onChange={onChange} clockLabel={CLOCK} from="2026-10-10" />);
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-01' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/"From" date must not be after the "To" date/);
  });
  it('Clear resets both', () => {
    const onChange = vi.fn();
    renderWithApp(<DateRange onChange={onChange} clockLabel={CLOCK} from="2026-10-01" to="2026-10-31" />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenCalledWith({});
  });
});

function Probe() {
  const { range, setRange } = useRange();
  const nav = useNavigate();
  const loc = useLocation();
  return (
    <div>
      <span data-testid="range">{`${range.from ?? ''}|${range.to ?? ''}`}</span>
      <span data-testid="search">{loc.search}</span>
      <button onClick={() => setRange({ from: '2026-10-01', to: '2026-10-31' })}>set</button>
      <button onClick={() => nav(`/admin/evidence/workflow${loc.search}`)}>go</button>
    </div>
  );
}

describe('useRange', () => {
  const app = (
    <Routes>
      <Route path="/admin/evidence/:section" element={<Probe />} />
    </Routes>
  );
  it('holds the range in the URL', () => {
    renderWithApp(app, { route: '/admin/evidence/overview?from=2026-09-01&to=2026-09-30' });
    expect(screen.getByTestId('range')).toHaveTextContent('2026-09-01|2026-09-30');
    fireEvent.click(screen.getByText('set'));
    expect(screen.getByTestId('search')).toHaveTextContent('from=2026-10-01');
    expect(screen.getByTestId('search')).toHaveTextContent('to=2026-10-31');
  });
  it('clears from/to when the section changes', () => {
    renderWithApp(app, { route: '/admin/evidence/overview?from=2026-09-01&to=2026-09-30' });
    fireEvent.click(screen.getByText('go'));
    expect(screen.getByTestId('search').textContent).toBe('');
    expect(screen.getByTestId('range')).toHaveTextContent('|');
  });
  it('setRange({}) removes the params', () => {
    function Clear() {
      const { setRange } = useRange();
      const loc = useLocation();
      return (
        <>
          <button onClick={() => setRange({})}>clear</button>
          <span data-testid="s">{loc.search}</span>
        </>
      );
    }
    renderWithApp(
      <Routes>
        <Route path="/admin/evidence/:section" element={<Clear />} />
      </Routes>,
      { route: '/admin/evidence/overview?from=2026-09-01&to=2026-09-30' },
    );
    fireEvent.click(screen.getByText('clear'));
    expect(screen.getByTestId('s').textContent).toBe('');
  });
});
