import type { ReactNode } from 'react';
import type { ArtifactsResponse } from '../../../../api/types';
import { Badge } from '../../../../components/ui';
import { formatDate } from '../../../../lib/format';
import { FaultRecallBars, ModeBars } from '../chartsMl';
import { fmtInt } from '../format';
import { Panel, panelState } from '../Panel';
import { ScrollHint } from '../ScrollHint';
import { useEvidence } from '../useEvidence';
import { deriveConfusion, f1, faultName, HYBRID, parseMetrics, round3 } from './mlModel';

const RETRY_MESSAGE = 'These figures could not be loaded.';
const NOT_AVAILABLE = 'Not available: the model evaluation file (formcheck/metrics.json) is absent or could not be read, so there are no figures to show. Nothing is shown as zero; the result is not verified.';
const FILE = 'formcheck/metrics.json';

const Synthetic = ({ children }: { children?: ReactNode }) => (
  <p className="mb-3 rounded border border-warning/40 px-3 py-2 text-sm text-secondary">
    <strong className="font-semibold text-primary">Synthetic data.</strong> {children ?? 'These figures come from generated forms, not from real AICTE applications.'}
  </p>
);
const Stored = () => <Badge tone="accent">Measured (stored)</Badge>;
const Derived = () => <Badge tone="neutral">Derived</Badge>;

function Figure({ label, value, extra, badge, formula }: { label: string; value: string; extra?: string; badge: ReactNode; formula?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-3">
      <dt className="text-sm font-medium text-secondary">{label}</dt>
      <dd className="tnum text-2xl font-semibold">
        {value}
        {extra ? <span className="ml-2 text-sm font-normal text-secondary">{extra}</span> : null}
      </dd>
      <div>{badge}</div>
      {formula ? <p className="text-xs text-secondary">{formula}</p> : null}
    </div>
  );
}

export function MlSection() {
  const q = useEvidence<ArtifactsResponse>('artifacts');
  const entry = (Array.isArray(q.data?.artifacts) ? q.data.artifacts : []).find((a) => a.name === FILE);
  const m = entry && entry.status === 'READ' ? parseMetrics(entry.data) : null;
  const available = !!m;
  const missing = !!q.data && !available;
  const c = m ? deriveConfusion(m) : null;
  const h = m?.modes[HYBRID];
  const prov = entry?.provenance ?? 'SYNTHETIC';
  const changed = m ? formatDate(m.generatedAt) : '';
  const scope = m ? `Synthetic evaluation set · ${fmtInt(m.datasets.testNormal)} normal + ${fmtInt(m.datasets.testFaulty)} faulty forms · figures last changed ${changed}` : 'Synthetic evaluation set';
  const error = { message: RETRY_MESSAGE, onRetry: () => void q.refetch() };
  const common = { provenance: prov, scope, insufficientMessage: NOT_AVAILABLE, error, state: panelState(q, false, missing) };
  const weak = m ? Object.entries(m.perFault).sort((a, b) => a[1][HYBRID]! - b[1][HYBRID]!) : [];
  const weakest = weak.length > 1 && weak[0]![1][HYBRID]! < weak[1]![1][HYBRID]! ? weak[0] : undefined;
  const pct = (v: number) => `${round3(v * 100)}%`;

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-prose text-base text-secondary">
        Every figure on this tab was measured on <strong>synthetic</strong> forms made by a script. It says how the form check behaves on that data and nothing yet about real applications.
      </p>
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <Panel
          title="Headline metrics (hybrid: rules or model)"
          definition="The hybrid mode flags a form when a rule or the model flags it. Precision, recall and false-alarm rate are the stored results of the evaluation; F1 and the false-negative rate are computed here from them, with the formulas shown."
          {...common}
        >
          <Synthetic />
          {h ? (
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Figure label="Precision" value={String(h.precision)} badge={<Stored />} />
              <Figure label="Recall (overall)" value={String(h.recall)} badge={<Stored />} />
              <Figure label="False-alarm rate" value={String(h.false_alarm_rate)} extra={pct(h.false_alarm_rate)} badge={<Stored />} />
              <Figure label="F1" value={String(f1(h.precision, h.recall) ?? 'Unavailable')} badge={<Derived />} formula="F1 = 2PR/(P+R)" />
              <Figure label="False-negative rate" value={String(round3(1 - h.recall))} extra={pct(1 - h.recall)} badge={<Derived />} formula="FN rate = 1 − recall" />
            </dl>
          ) : null}
        </Panel>

        <Panel
          title="Confusion matrix (hybrid, derived)"
          definition="Counts of forms in the synthetic test sets, derived from the stored recall and false-alarm rate and the test-set sizes. They are not stored in the file."
          {...common}
          state={panelState(q, false, missing || (available && !c))}
          insufficientMessage={missing ? NOT_AVAILABLE : 'Not available: the stored rates do not give whole counts over these test-set sizes, so no exact matrix is shown.'}
        >
          <Synthetic />
          {m && c ? (
            <div className="flex flex-col gap-3">
              <div className="overflow-x-auto">
                <table aria-label="Confusion matrix (derived), synthetic test forms" className="w-full min-w-[20rem] text-left text-sm">
                  <thead>
                    <tr className="border-b">
                      <td className="px-2 py-1" />
                      <th scope="col" className="px-2 py-1 font-medium text-secondary">Flagged by the check</th>
                      <th scope="col" className="px-2 py-1 font-medium text-secondary">Not flagged</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b">
                      <th scope="row" className="px-2 py-2 font-medium text-secondary">Faulty form ({fmtInt(m.datasets.testFaulty)})</th>
                      <td className="tnum px-2 py-2"><span className="text-xl font-semibold">{fmtInt(c.tp)}</span> <span className="text-xs text-secondary">TP, fault caught</span></td>
                      <td className="tnum px-2 py-2"><span className="text-xl font-semibold">{fmtInt(c.fn)}</span> <span className="text-xs text-secondary">FN, fault missed</span></td>
                    </tr>
                    <tr>
                      <th scope="row" className="px-2 py-2 font-medium text-secondary">Normal form ({fmtInt(m.datasets.testNormal)})</th>
                      <td className="tnum px-2 py-2"><span className="text-xl font-semibold">{fmtInt(c.fp)}</span> <span className="text-xs text-secondary">FP, false alarm</span></td>
                      <td className="tnum px-2 py-2"><span className="text-xl font-semibold">{fmtInt(c.tn)}</span> <span className="text-xs text-secondary">TN, correctly passed</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <ScrollHint />
              <p><Derived /></p>
              <ul className="tnum flex flex-col gap-1 text-sm">
                <li>TP = recall × faulty forms = {h!.recall} × {fmtInt(m.datasets.testFaulty)}</li>
                <li>FN = faulty forms − TP</li>
                <li>FP = false-alarm rate × normal forms = {h!.false_alarm_rate} × {fmtInt(m.datasets.testNormal)}</li>
                <li>TN = normal forms − FP</li>
                <li>Check: TP / (TP + FP) = {fmtInt(c.tp)} / {fmtInt(c.tp + c.fp)} = {round3(c.precision)}, the stored precision {h!.precision}</li>
              </ul>
              <p className="text-sm text-secondary">
                The counts are exact, not estimates: the stored rates are given to three decimals, and recall × {fmtInt(m.datasets.testFaulty)} faulty forms and false-alarm rate × {fmtInt(m.datasets.testNormal)} normal forms are both whole numbers, so nothing is lost in rounding.
              </p>
            </div>
          ) : null}
        </Panel>

        <Panel
          title="Baseline comparison (rules only, model only, hybrid)"
          definition="The same synthetic test forms, checked three ways. Precision is the share of flagged forms that were faulty; recall is the share of faulty forms flagged; the false-alarm rate is the share of normal forms flagged. All three are stored results."
          {...common}
        >
          <Synthetic />
          {m ? (
            <>
              <p className="mb-2"><Stored /></p>
              <ModeBars metrics={m} />
            </>
          ) : null}
        </Panel>

        <Panel
          title="Recall by fault type"
          definition="For each kind of fault planted in the synthetic faulty forms, the share the mode flagged. The chart shows the hybrid mode; the table has all three. Stored results."
          {...common}
        >
          <Synthetic />
          {m ? (
            <>
              {weakest ? (
                <p className="mb-2 text-sm">
                  <strong>Weak spot: {faultName(weakest[0]).toLowerCase()}.</strong> The hybrid mode caught only {weakest[1][HYBRID]} ({pct(weakest[1][HYBRID]!)}) of them; the other fault types are caught at {weak[1]![1][HYBRID]} or better. <Stored />
                </p>
              ) : null}
              <FaultRecallBars metrics={m} />
            </>
          ) : null}
        </Panel>

        <div className="lg:col-span-2">
          <Panel
            title="Methodology and limits"
            definition="How the evaluation was run and what it can and cannot show, from the evaluation file and its write-up."
            {...common}
          >
            <Synthetic />
            {m ? (
              <div className="flex max-w-prose flex-col gap-2 text-base">
                <p>
                  Model <code>{m.model}</code>, flag threshold {m.threshold}, the 97th percentile of the training scores. Trained on {fmtInt(m.datasets.train)} synthetic forms and tested on {fmtInt(m.datasets.testNormal)} normal and {fmtInt(m.datasets.testFaulty)} faulty synthetic forms.
                </p>
                <p>
                  Evaluation date: {changed} (<code>generatedAt</code> in the file). This is when the stored figures last changed, not when the evaluation last ran.
                </p>
                <p>The form check is advisory only: it never blocks filing, it asks for a justification.</p>
                <p>Evaluated on synthetic forms; not validated on real AICTE applications.</p>
                <p>The per-form explanation of why a form was flagged is on each case's Form checks panel and is not aggregated here.</p>
                <p className="text-sm text-secondary">
                  Full write-up: <code>formcheck/EVALUATION.md</code> in the repository.{m.commit ? ` Figures stored at commit ${m.commit}.` : ''}
                </p>
              </div>
            ) : null}
          </Panel>
        </div>
      </div>
    </div>
  );
}
