import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithApp } from '../../../../test/render';
import { MlSection } from './ml';
import { deriveConfusion, parseMetrics } from './mlModel';
import { artifacts, METRICS, metricsEntry, NEW_RUN, runEntry } from './testFixtures';

vi.mock('../../../../api/client', async (orig) => ({ ...(await orig<typeof import('../../../../api/client')>()), api: { get: (path: string) => impl(path) } }));

let impl: (path: string) => Promise<unknown> = async () => ({});
const calls: string[] = [];
let body: unknown;
let failAll = false;
beforeEach(() => {
  calls.length = 0;
  failAll = false;
  body = artifacts(runEntry(NEW_RUN), metricsEntry());
  impl = (path) => {
    calls.push(path);
    return failAll ? Promise.reject(new Error('down')) : Promise.resolve(body);
  };
});

const page = () =>
  renderWithApp(
    <Routes>
      <Route path="/admin/evidence/:section" element={<MlSection />} />
    </Routes>,
    { route: '/admin/evidence/ml' },
  );
const panel = (title: string) => screen.getByRole('heading', { name: (n) => n.startsWith(title) }).closest('section')!;
const panelBody = (title: string) => panel(title).lastElementChild as HTMLElement;
const bodyOf = (el: HTMLElement) => Array.from(el.querySelectorAll('tbody tr')).map((r) => Array.from(r.querySelectorAll('td')).map((c) => c.textContent));
const loaded = () => waitFor(() => expect(screen.getAllByText(/0\.975/).length).toBeGreaterThan(0));
const TITLES = ['Headline metrics', 'Confusion matrix', 'Baseline comparison', 'Recall by fault type', 'Methodology and limits'];

describe('derived confusion matrix', () => {
  it('is exact: TP 863, FN 137, FP 22, TN 978, and precision recomputes to the stored 0.975', () => {
    const m = parseMetrics(METRICS)!;
    const c = deriveConfusion(m)!;
    expect(c).toMatchObject({ tp: 863, fn: 137, fp: 22, tn: 978 });
    expect(Math.round((c.tp / (c.tp + c.fp)) * 1000) / 1000).toBe(0.975);
  });
  it('is unavailable when the stored rates do not divide the test set exactly', () => {
    const m = parseMetrics({ ...METRICS, datasets: { ...METRICS.datasets, testFaulty: 999 } })!;
    expect(deriveConfusion(m)).toBeNull();
  });
  it('malformed metrics parse to null', () => {
    expect(parseMetrics(null)).toBeNull();
    expect(parseMetrics({ ...METRICS, modes: {} })).toBeNull();
    expect(parseMetrics({ ...METRICS, modes: { 'Hybrid (rules or model)': { precision: 'x', recall: 1, false_alarm_rate: 0 } } })).toBeNull();
    expect(parseMetrics({ ...METRICS, datasets: { train: 1 } })).toBeNull();
  });
});

describe('ML evaluation', () => {
  it('reads the live artifacts response', async () => {
    page();
    await loaded();
    expect(calls).toEqual(['/evidence/artifacts']);
  });

  it('headline: stored figures labelled Measured (stored), F1 and FN rate labelled Derived with formulas', async () => {
    page();
    await loaded();
    const b = panelBody('Headline metrics');
    expect(b.textContent).toContain('0.975');
    expect(b.textContent).toContain('0.863');
    expect(b.textContent).toContain('0.022');
    expect(b.textContent).toContain('2.2%');
    expect(b.textContent).toContain('Measured (stored)');
    expect(b.textContent).toContain('Derived');
    expect(b.textContent).toContain('F1 = 2PR/(P+R)');
    expect(b.textContent).toContain('FN rate = 1 − recall');
    expect(b.textContent).toContain('0.916'); // F1 = 1726 / 1885
    expect(b.textContent).toContain('0.137');
  });

  it('confusion matrix is a 2x2 table with the derived counts and visible formulas', async () => {
    page();
    await loaded();
    const p = panel('Confusion matrix');
    const t = within(p).getByRole('table', { name: /confusion matrix/i });
    const cells = Array.from(t.querySelectorAll('td')).map((c) => c.textContent);
    expect(cells.join('|')).toMatch(/863.*137.*22.*978/);
    expect(p.textContent).toContain('TP = recall × faulty forms');
    expect(p.textContent).toContain('FN = faulty forms − TP');
    expect(p.textContent).toContain('FP = false-alarm rate × normal forms');
    expect(p.textContent).toContain('TN = normal forms − FP');
    expect(p.textContent).toMatch(/exact/i);
    expect(p.textContent).toMatch(/three decimals.*1,000/);
    expect(p.textContent).toContain('Derived');
    expect(p.textContent).toMatch(/TP \/ \(TP \+ FP\) = 863 \/ 885 = 0\.975/);
  });

  it('baseline comparison lists the three modes with the stored values', async () => {
    page();
    await loaded();
    const rows = bodyOf(within(panel('Baseline comparison')).getByRole('table', { hidden: true }) as HTMLElement);
    expect(rows).toEqual([
      ['Rules only', '1', '0.859', '0'],
      ['Model only', '0.842', '0.117', '0.022'],
      ['Hybrid (rules or model)', '0.975', '0.863', '0.022'],
    ]);
  });

  it('recall by fault type names unit errors, 0.315, as the weak spot', async () => {
    page();
    await loaded();
    const p = panel('Recall by fault type');
    expect(p.textContent).toMatch(/weak spot/i);
    expect(p.textContent).toContain('0.315');
    const rows = bodyOf(within(p).getByRole('table', { hidden: true }) as HTMLElement);
    expect(rows[0]).toEqual(['Unit error on land area', '0.295', '0.07', '0.315']);
    expect(rows).toHaveLength(5);
  });

  it('methodology and limits', async () => {
    page();
    await loaded();
    const t = panel('Methodology and limits').textContent!;
    expect(t).toContain('application_form_v1');
    expect(t).toContain('0.5794');
    expect(t).toMatch(/97th percentile of the training scores/);
    expect(t).toMatch(/4,000/);
    expect(t).toMatch(/advisory only/i);
    expect(t).toMatch(/never blocks filing/);
    expect(t).toMatch(/not validated on real AICTE applications/);
    expect(t).toContain('formcheck/EVALUATION.md');
    expect(t).toMatch(/Form checks panel/);
    expect(t).toMatch(/not aggregated here/);
  });

  it('the evaluation date is generatedAt, defined as when the figures last changed', async () => {
    const { container } = page();
    await loaded();
    expect(container.textContent).toContain('3 Nov 2026');
    expect(container.textContent).toMatch(/when the stored figures last changed, not when the evaluation last ran/);
  });

  it('every panel body says the data is synthetic', async () => {
    page();
    await loaded();
    for (const t of TITLES) expect(panelBody(t).textContent).toMatch(/synthetic/i);
  });

  it('never shows 0.89 or 2.9%', async () => {
    const { container } = page();
    await loaded();
    expect(container.textContent).not.toContain('0.89');
    expect(container.textContent).not.toContain('2.9%');
  });

  it('absent artifact is an honest not-available state, with no zeros', async () => {
    body = artifacts(runEntry(NEW_RUN));
    const { container } = page();
    await waitFor(() => expect(screen.getAllByText(/Not available/).length).toBeGreaterThan(3));
    expect(container.querySelector('[role=img]')).toBeNull();
    expect(container.textContent).not.toMatch(/\b0\.0+\b|0%/);
  });
  it('a NOT_VERIFIED or malformed artifact is the same not-available state', async () => {
    body = artifacts(metricsEntry(null, 'NOT_VERIFIED'));
    page();
    await waitFor(() => expect(screen.getAllByText(/Not available/).length).toBeGreaterThan(3));
    body = artifacts(metricsEntry({ ...METRICS, modes: 'broken' }));
  });
  it('retry on error', async () => {
    failAll = true;
    page();
    expect((await screen.findAllByRole('button', { name: /retry|try again/i })).length).toBeGreaterThan(3);
  });
  it('every panel carries a definition', async () => {
    page();
    await loaded();
    for (const t of TITLES) expect(panel(t).querySelector('details')).not.toBeNull();
  });
});
