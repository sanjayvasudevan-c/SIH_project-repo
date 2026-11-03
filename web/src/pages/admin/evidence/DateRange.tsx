import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Button, DateInput, Field } from '../../../components/ui';

export interface Range {
  from?: string;
  to?: string;
}

/**
 * The date range lives in the URL (?from=&to=) so a view can be shared, and is cleared when the section changes
 * because each section's dates mean something different.
 */
export function useRange(): { range: Range; setRange: (r: Range) => void } {
  const [params, setParams] = useSearchParams();
  const { section } = useParams();
  const last = useRef(section);
  const from = params.get('from') || undefined;
  const to = params.get('to') || undefined;

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

  return { range: { from, to }, setRange: write };
}

/** From/To inputs for ONE group of panels. States the clock the dates are read against. */
export function DateRange({ from, to, onChange, clockLabel }: { from?: string; to?: string; onChange: (r: Range) => void; clockLabel: string }) {
  const [draft, setDraft] = useState<Range>({ from, to });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft({ from, to });
    setError(null);
  }, [from, to]);

  const update = (key: 'from' | 'to', value: string) => {
    const next = { ...draft, [key]: value || undefined };
    setDraft(next);
    if (next.from && next.to && next.from > next.to) {
      setError('The "From" date must not be after the "To" date. The range was not applied.');
      return;
    }
    setError(null);
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="From">
          {({ id }) => <DateInput id={id} value={draft.from ?? ''} onChange={(e) => update('from', e.target.value)} />}
        </Field>
        <Field label="To">{({ id }) => <DateInput id={id} value={draft.to ?? ''} onChange={(e) => update('to', e.target.value)} />}</Field>
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
      <p className="text-xs text-secondary">{clockLabel}</p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
