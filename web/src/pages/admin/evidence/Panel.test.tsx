import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithApp } from '../../../test/render';
import { Kpi, Panel, panelState } from './Panel';

const DEF = 'Share of applications decided within the statutory window. Excludes withdrawn ones.';
const base = { title: 'Applications decided (count)', provenance: 'MEASURED' as const, scope: 'n = 192 applications · all dates', definition: DEF };

describe('Panel', () => {
  it('ready: shows children, scope, chip and the definition verbatim inside a details', () => {
    const { container } = renderWithApp(
      <Panel {...base} state="ready">
        <p>BODY</p>
      </Panel>,
    );
    expect(screen.getByText('BODY')).toBeInTheDocument();
    expect(screen.getByText('n = 192 applications · all dates')).toBeVisible();
    expect(screen.getByText('Measured')).toBeInTheDocument();
    const details = container.querySelector('details')!;
    expect(details).toHaveTextContent('How this is measured');
    expect(details).toHaveTextContent(DEF);
    expect(details.textContent).toContain(DEF);
  });
  it.each([undefined, '', '   '])('ready with definition %j shows the error and not the children', (definition) => {
    renderWithApp(
      <Panel {...base} definition={definition} state="ready">
        <p>BODY</p>
      </Panel>,
    );
    expect(screen.getByText('This measure has no definition and is not shown')).toBeInTheDocument();
    expect(screen.queryByText('BODY')).toBeNull();
  });
  it('insufficient shows its message and never the children', () => {
    renderWithApp(
      <Panel {...base} state="insufficient" insufficientMessage="Needs at least 2 runs.">
        <p>BODY</p>
      </Panel>,
    );
    expect(screen.getByText('Needs at least 2 runs.')).toBeInTheDocument();
    expect(screen.queryByText('BODY')).toBeNull();
  });
  it('empty shows its message and never the children', () => {
    renderWithApp(
      <Panel {...base} state="empty" emptyMessage="No decisions recorded yet.">
        <p>BODY</p>
      </Panel>,
    );
    expect(screen.getByText('No decisions recorded yet.')).toBeInTheDocument();
    expect(screen.queryByText('BODY')).toBeNull();
  });
  it('loading shows no children; error offers retry', () => {
    const onRetry = vi.fn();
    const { rerender } = renderWithApp(
      <Panel {...base} state="loading">
        <p>BODY</p>
      </Panel>,
    );
    expect(screen.queryByText('BODY')).toBeNull();
    rerender(
      <Panel {...base} state="error" error={{ message: 'Boom', onRetry }}>
        <p>BODY</p>
      </Panel>,
    );
    expect(screen.queryByText('BODY')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });
  it('null provenance is labelled, scope stays visible in every state', () => {
    renderWithApp(
      <Panel {...base} provenance={null} state="empty">
        <p>BODY</p>
      </Panel>,
    );
    expect(screen.getByText('Source not declared')).toBeInTheDocument();
    expect(screen.getByText(base.scope)).toBeVisible();
  });
});

describe('Panel scope is enforced like the definition', () => {
  it.each(['', '  '])('ready with scope %j shows the error and not the children', (scope) => {
    renderWithApp(
      <Panel {...base} scope={scope} state="ready">
        <p>BODY</p>
      </Panel>,
    );
    expect(screen.getByText('This measure does not say what it covers and is not shown')).toBeInTheDocument();
    expect(screen.queryByText('BODY')).toBeNull();
  });
  it('the missing-definition error is titled "Not shown", not "could not be loaded"', () => {
    renderWithApp(
      <Panel {...base} definition={undefined} state="ready">
        <p>BODY</p>
      </Panel>,
    );
    expect(screen.getByText('Not shown')).toBeInTheDocument();
    expect(screen.queryByText('This could not be loaded')).toBeNull();
  });
});

describe('panelState', () => {
  const ok = { isPending: false, isError: false };
  it('covers every branch in order', () => {
    expect(panelState({ isPending: true, isError: false }, true, true)).toBe('loading');
    expect(panelState({ isPending: true, isError: true }, false)).toBe('loading');
    expect(panelState({ isPending: false, isError: true }, true, true)).toBe('error');
    expect(panelState(ok, true, true)).toBe('insufficient');
    expect(panelState(ok, false, true)).toBe('insufficient');
    expect(panelState(ok, true)).toBe('empty');
    expect(panelState(ok, false)).toBe('ready');
    expect(panelState(ok, false, false)).toBe('ready');
  });
});

describe('Kpi', () => {
  const kpi = { label: 'Decided', value: '192', provenance: 'MEASURED' as const, scope: 'all dates', definition: DEF };
  it('ready shows value, scope, chip, definition in the same card', () => {
    const { container } = renderWithApp(<Kpi {...kpi} state="ready" hint="of 200" />);
    expect(screen.getByText('192')).toBeInTheDocument();
    expect(screen.getByText('all dates')).toBeVisible();
    expect(screen.getByText('Measured')).toBeInTheDocument();
    expect(screen.getByText('of 200')).toBeInTheDocument();
    expect(container.querySelector('details')).toHaveTextContent(DEF);
  });
  it('ready without a definition shows the error and not the value', () => {
    renderWithApp(<Kpi {...kpi} definition={undefined} state="ready" />);
    expect(screen.getByText('This measure has no definition and is not shown')).toBeInTheDocument();
    expect(screen.queryByText('192')).toBeNull();
  });
  it('insufficient and empty never show the value', () => {
    const { rerender } = renderWithApp(<Kpi {...kpi} state="insufficient" insufficientMessage="Too few runs" />);
    expect(screen.getByText('Too few runs')).toBeInTheDocument();
    expect(screen.queryByText('192')).toBeNull();
    rerender(<Kpi {...kpi} state="empty" emptyMessage="Nothing yet" />);
    expect(screen.getByText('Nothing yet')).toBeInTheDocument();
    expect(screen.queryByText('192')).toBeNull();
  });
  it('loading shows no value', () => {
    renderWithApp(<Kpi {...kpi} state="loading" />);
    expect(screen.queryByText('192')).toBeNull();
  });
  it('emphasis warning colours the value but the value stays text', () => {
    renderWithApp(<Kpi {...kpi} value="NOT_VERIFIED" emphasis="warning" state="ready" />);
    expect(screen.getByText('NOT_VERIFIED')).toHaveClass('text-warning');
  });
  it.each(['', '  '])('ready with scope %j shows the error and not the value', (scope) => {
    renderWithApp(<Kpi {...kpi} scope={scope} state="ready" />);
    expect(screen.getByText('This measure does not say what it covers and is not shown')).toBeInTheDocument();
    expect(screen.queryByText('192')).toBeNull();
  });
  it.each(['', '  '])('ready with definition %j shows the error and not the value', (definition) => {
    renderWithApp(<Kpi {...kpi} definition={definition} state="ready" />);
    expect(screen.getByText('This measure has no definition and is not shown')).toBeInTheDocument();
    expect(screen.queryByText('192')).toBeNull();
  });
  it('error state shows no value and offers retry', () => {
    const onRetry = vi.fn();
    renderWithApp(<Kpi {...kpi} state="error" error={{ message: 'Boom', onRetry }} />);
    expect(screen.queryByText('192')).toBeNull();
    expect(screen.getByText('Boom')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });
});
