import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp } from '../../../test/render';
import { ProvenanceChip } from './Provenance';
import type { Provenance } from '../../../api/types';

const LABELS: [Provenance, string][] = [
  ['MEASURED', 'Measured'],
  ['DERIVED', 'Derived'],
  ['SYNTHETIC', 'Synthetic data'],
  ['TARGET', 'Target — not a measurement'],
  ['LIVE_DEMO', 'Live demo data'],
  ['TEST_RUN', 'Test run'],
  ['BENCHMARK', 'Benchmark (synthetic dataset)'],
  ['SIMULATED', 'Simulated clock'],
];

describe('ProvenanceChip', () => {
  it.each(LABELS)('%s reads %s as text with an icon', (p, label) => {
    const { container } = renderWithApp(<ProvenanceChip provenance={p} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
  });
  it.each([undefined, 'GARBAGE', '', 'toString'])('an undeclared key (%j) reads "Source not declared" and does not throw', (v) => {
    const { container } = renderWithApp(<ProvenanceChip provenance={v as unknown as Provenance} />);
    expect(screen.getByText('Source not declared')).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
  });
  it('null is "Source not declared", never a guess', () => {
    const { container } = renderWithApp(<ProvenanceChip provenance={null} />);
    expect(screen.getByText('Source not declared')).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
