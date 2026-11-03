import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Button, DateInput, Field } from '../../../components/ui';

export interface Range {
  from?: string;
  to?: string;
}

/** True only for a real calendar date written YYYY-MM-DD ("2026-02-30" is not one). */
export function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * The date range lives in the URL (?from=&to=) so a view can be shared, and is cleared when the section changes
 * because each section's dates mean something different.
 */
export function useRange(): { range: Range; setRange: (r: Range) => void; invalid: boolean } {
  const [params, setParams] = useSearchParams();
  const { section } = useParams();
  const last = useRef(section);
  const rawFrom = params.get('from') || undefined;
  const rawTo = params.get('to') || undefined;
  // A shared link can carry anything. An end that is not a real date, or a range that runs backwards, is ignored
  // as a whole (never sent to the API) and reported through `invalid`.
  const invalid = (rawFrom !== undefined && !isRealDate(rawFrom)) || (rawTo !== undefined && !isRealDate(rawTo)) || (rawFrom !== undefined && rawTo !== undefined && rawFrom > rawTo);
  const range: Range = invalid ? {} : { from: rawFrom, to: rawTo };

  const write = useCallback(
    (r: Range) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const k of ['from', 'to'] as const) {
            if (r[k]) next.set(k, r[k]!);
            else next.delete(k);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  useEffect(() => {
    if (last.current !== section) {
      last.current = section;
      write({});
    }
  }, [section, write]);

  return { range, setRange: write, invalid };
}

/** From/To inputs for ONE group of panels. States the clock the dates are read against. */
export function DateRange({ from, to, onChange, clockLabel, invalid, label = 'Date range' }: { from?: string; to?: string; onChange: (r: Range) => void; clockLabel: string; invalid?: boolean; label?: string }) {
  const [draft, setDraft] = useState<Range>({ from, to });
  const [error, setError] = useState<string | null>(null);
  const clockId = useId();

  useEffect(() => {
    setDraft({ from, to });
    setError(null);
  }, [from, to]);

  const update = (key: 'from' | 'to', el: HTMLInputElement) => {
    const value = el.value;
    const next = { ...draft, [key]: value || undefined };
    setDraft(next);
    const name = key === 'from' ? '"From"' : '"To"';
    // A half-typed or impossible date reads as empty to the browser; say so rather than silently dropping it.
    if (el.validity?.badInput || (value !== '' && !isRealDate(value))) {
      setError(`The ${name} date is not a real date. The range was not applied.`);
      return;
    }
    if (next.from && next.to && next.from > next.to) {
      setError('The "From" date must not be after the "To" date. The range was not applied.');
      return;
    }
    setError(null);
    onChange(next);
  };

  return (
    <fieldset className="flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="mb-1 text-base font-medium text-primary">{label}</legend>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="From">{({ id }) => <DateInput id={id} aria-describedby={clockId} value={draft.from ?? ''} onChange={(e) => update('from', e.target)} />}</Field>
        <Field label="To">{({ id }) => <DateInput id={id} aria-describedby={clockId} value={draft.to ?? ''} onChange={(e) => update('to', e.target)} />}</Field>
        <Button
          variant="secondary"
          onClick={() => {
            setDraft({});
            setError(null);
            onChange({});
          }}
        >
          Clear
        </Button>
      </div>
      <p id={clockId} className="text-xs text-secondary">
        {clockLabel}
      </p>
      {invalid && !error ? (
        <p role="alert" className="text-sm text-danger">
          The link's date range was not valid and has been ignored.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
