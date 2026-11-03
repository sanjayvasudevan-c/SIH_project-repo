import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { Route, Routes, useNavigate, useLocation } from 'react-router-dom';
import { renderWithApp } from '../../../test/render';
import { DateRange, isRealDate, useRange } from './DateRange';

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

describe('DateRange accessibility and validation', () => {
  it('is a labelled group and links the clock label to both inputs', () => {
    renderWithApp(<DateRange onChange={() => {}} clockLabel={CLOCK} label="Audit dates" />);
    expect(screen.getByRole('group', { name: 'Audit dates' })).toBeInTheDocument();
    const clock = screen.getByText(CLOCK);
    expect(screen.getByLabelText('From')).toHaveAttribute('aria-describedby', clock.id);
    expect(screen.getByLabelText('To')).toHaveAttribute('aria-describedby', clock.id);
  });
  it('an invalid inherited range shows a visible alert', () => {
    renderWithApp(<DateRange onChange={() => {}} clockLabel={CLOCK} invalid />);
    expect(screen.getByRole('alert')).toHaveTextContent("The link's date range was not valid and has been ignored.");
  });
  it('an impossible date is reported, not silently dropped', () => {
    const onChange = vi.fn();
    renderWithApp(<DateRange onChange={onChange} clockLabel={CLOCK} />);
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-02-30' } });
    expect(onChange).not.toHaveBeenCalled();
  });
  it('isRealDate', () => {
    expect(isRealDate('2026-02-28')).toBe(true);
    expect(isRealDate('2024-02-29')).toBe(true);
    for (const s of ['2026-02-30', '2026-13-01', 'garbage', '2026-1-1', '', '2026-12-01T00:00']) expect(isRealDate(s)).toBe(false);
  });
});

function RangeProbe() {
  const { range, invalid } = useRange();
  return (
    <span data-testid="r">{`${range.from ?? ''}|${range.to ?? ''}|${invalid}`}</span>
  );
}

describe('useRange validates the URL', () => {
  const at = (q: string) =>
    renderWithApp(
      <Routes>
        <Route path="/admin/evidence/:section" element={<RangeProbe />} />
      </Routes>,
      { route: `/admin/evidence/overview${q}` },
    );
  it.each([
    ['garbage', '?from=2026-12-01&to=garbage', '||true'],
    ['impossible date', '?from=2026-02-30', '||true'],
    ['inverted', '?from=2026-12-01&to=2026-01-01', '||true'],
    ['valid', '?from=2026-01-01&to=2026-12-01', '2026-01-01|2026-12-01|false'],
    ['from only', '?from=2026-01-01', '2026-01-01||false'],
    ['to only', '?to=2026-01-01', '|2026-01-01|false'],
    ['none', '', '||false'],
  ])('%s', (_n, q, expected) => {
    at(q);
    expect(screen.getByTestId('r').textContent).toBe(expected);
  });
});

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
