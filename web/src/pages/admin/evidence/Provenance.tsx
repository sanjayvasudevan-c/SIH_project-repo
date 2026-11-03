import type { ReactElement } from 'react';
import { Calculator, ClipboardCheck, Clock, FlaskConical, Gauge, HelpCircle, Radio, Ruler, Target } from 'lucide-react';
import type { Provenance } from '../../../api/types';
import { Badge, type Tone } from '../../../components/ui';

const ICON = { size: 12, strokeWidth: 2, 'aria-hidden': true } as const;

const CHIPS: Record<Provenance, { label: string; tone: Tone; icon: ReactElement }> = {
  MEASURED: { label: 'Measured', tone: 'accent', icon: <Ruler {...ICON} /> },
  DERIVED: { label: 'Derived', tone: 'accent', icon: <Calculator {...ICON} /> },
  SYNTHETIC: { label: 'Synthetic data', tone: 'warning', icon: <FlaskConical {...ICON} /> },
  TARGET: { label: 'Target — not a measurement', tone: 'warning', icon: <Target {...ICON} /> },
  LIVE_DEMO: { label: 'Live demo data', tone: 'neutral', icon: <Radio {...ICON} /> },
  TEST_RUN: { label: 'Test run', tone: 'neutral', icon: <ClipboardCheck {...ICON} /> },
  BENCHMARK: { label: 'Benchmark (synthetic dataset)', tone: 'warning', icon: <Gauge {...ICON} /> },
  SIMULATED: { label: 'Simulated clock', tone: 'warning', icon: <Clock {...ICON} /> },
};

/** Where a figure comes from: always an icon and words, never colour alone. `null` means undeclared. */
export function ProvenanceChip({ provenance }: { provenance: Provenance | null }) {
  // null, undefined (a key the API omitted) and unknown strings are all "not declared": never a crash, never a guess.
  if (provenance == null || !Object.prototype.hasOwnProperty.call(CHIPS, provenance)) return <Badge tone="neutral" icon={<HelpCircle {...ICON} />}>Source not declared</Badge>;
  const c = CHIPS[provenance];
  return (
    <Badge tone={c.tone} icon={c.icon}>
      {c.label}
    </Badge>
  );
}
