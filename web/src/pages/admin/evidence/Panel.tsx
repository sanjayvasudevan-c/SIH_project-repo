import type { ReactNode } from 'react';
import type { Provenance } from '../../../api/types';
import { EmptyState, ErrorState, Skeleton } from '../../../components/ui';
import { cx } from '../../../lib/format';
import { ProvenanceChip } from './Provenance';

export type PanelState = 'ready' | 'loading' | 'error' | 'empty' | 'insufficient';

export const NO_DEFINITION = 'This measure has no definition and is not shown';

interface ErrorProp {
  message?: string;
  onRetry?: () => void;
}

const hasText = (s: string | undefined): s is string => typeof s === 'string' && s.trim() !== '';

/** The scope line (always visible) and the endpoint's definition, verbatim, in a native <details>. */
function Header({ provenance, scope, definition }: { provenance: Provenance | null; scope: string; definition: string | undefined }) {
  return (
    <>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <ProvenanceChip provenance={provenance} />
        <span className="tnum text-xs text-secondary">{scope}</span>
      </div>
      {hasText(definition) ? (
        <details className="mt-2 text-sm">
          <summary className="hit cursor-pointer text-accent">How this is measured</summary>
          <p className="mt-1 max-w-prose text-secondary">{definition}</p>
        </details>
      ) : null}
    </>
  );
}

/** The state the body is in. Returns null only when the value/children may be shown. */
function Gate({ state, definition, emptyMessage, insufficientMessage, error }: { state: PanelState; definition: string | undefined; emptyMessage?: string; insufficientMessage?: string; error?: ErrorProp }): ReactNode {
  if (state === 'loading') return <Skeleton lines={3} />;
  if (state === 'error') return <ErrorState message={error?.message} onRetry={error?.onRetry} />;
  if (state === 'empty') return <EmptyState message={emptyMessage ?? 'No records in this scope.'} />;
  if (state === 'insufficient') return <EmptyState message={insufficientMessage ?? 'There is not enough data to show this yet.'} />;
  if (!hasText(definition)) return <ErrorState message={NO_DEFINITION} />;
  return null;
}

export function Panel(p: {
  title: string;
  provenance: Provenance | null;
  scope: string;
  definition: string | undefined;
  state: PanelState;
  emptyMessage?: string;
  insufficientMessage?: string;
  error?: ErrorProp;
  children: ReactNode;
}) {
  const gate = Gate(p);
  return (
    <section className="rounded-lg border bg-surface">
      <div className="border-b px-4 py-3">
        <h3 className="text-lg font-semibold">{p.title}</h3>
        <Header provenance={p.provenance} scope={p.scope} definition={p.definition} />
      </div>
      <div className="p-4">{gate ?? p.children}</div>
    </section>
  );
}

/** A headline tile with the same guarantees as Panel: scope visible, definition in the card, no value without one. */
export function Kpi(p: {
  label: string;
  value: string;
  hint?: ReactNode;
  provenance: Provenance | null;
  scope: string;
  definition: string | undefined;
  state: PanelState;
  emphasis?: 'danger' | 'warning';
  emptyMessage?: string;
  insufficientMessage?: string;
  error?: ErrorProp;
}) {
  const gate = Gate(p);
  return (
    <div className="flex flex-col rounded-lg border bg-surface p-4">
      <p className="text-sm font-medium text-secondary">{p.label}</p>
      {gate ? (
        <div className="-mx-4 mt-1">{gate}</div>
      ) : (
        <>
          <p className={cx('tnum mt-1 break-words text-2xl font-semibold', p.emphasis === 'danger' ? 'text-danger' : p.emphasis === 'warning' ? 'text-warning' : 'text-primary')}>{p.value}</p>
          {p.hint ? <p className="mt-1 text-xs text-muted">{p.hint}</p> : null}
        </>
      )}
      <Header provenance={p.provenance} scope={p.scope} definition={p.definition} />
    </div>
  );
}
