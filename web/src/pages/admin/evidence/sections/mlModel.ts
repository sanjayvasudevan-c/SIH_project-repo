// Reads formcheck/metrics.json as served by /evidence/artifacts. Everything is validated: anything that is not
// what the evaluation script writes reads as "not available", never as zeros.

export const HYBRID = 'Hybrid (rules or model)';
export interface Rates {
  precision: number;
  recall: number;
  false_alarm_rate: number;
}
export interface Metrics {
  model: string;
  threshold: number;
  datasets: { train: number; testNormal: number; testFaulty: number };
  modes: Record<string, Rates>;
  perFault: Record<string, Record<string, number>>;
  generatedAt: string;
  commit: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isRate = (v: unknown): v is number => isNum(v) && v >= 0 && v <= 1;
const isCount = (v: unknown): v is number => isNum(v) && Number.isInteger(v) && v > 0;

export function parseMetrics(json: unknown): Metrics | null {
  if (!isObj(json) || !isObj(json.datasets) || !isObj(json.modes) || !isObj(json.perFault)) return null;
  const { train, testNormal, testFaulty } = json.datasets;
  if (!isCount(train) || !isCount(testNormal) || !isCount(testFaulty)) return null;
  if (typeof json.model !== 'string' || !isNum(json.threshold) || typeof json.generatedAt !== 'string' || Number.isNaN(new Date(json.generatedAt).getTime())) return null;
  const modes: Record<string, Rates> = {};
  for (const [name, r] of Object.entries(json.modes)) {
    if (!isObj(r) || !isRate(r.precision) || !isRate(r.recall) || !isRate(r.false_alarm_rate)) return null;
    modes[name] = { precision: r.precision, recall: r.recall, false_alarm_rate: r.false_alarm_rate };
  }
  if (!modes[HYBRID]) return null;
  const perFault: Record<string, Record<string, number>> = {};
  for (const [fault, byMode] of Object.entries(json.perFault)) {
    if (!isObj(byMode)) return null;
    perFault[fault] = {};
    for (const [mode, v] of Object.entries(byMode)) {
      if (!isRate(v)) return null;
      perFault[fault]![mode] = v;
    }
    if (perFault[fault]![HYBRID] === undefined) return null;
  }
  if (Object.keys(perFault).length === 0) return null;
  return { model: json.model, threshold: json.threshold, datasets: { train, testNormal, testFaulty }, modes, perFault, generatedAt: json.generatedAt, commit: typeof json.commit === 'string' ? json.commit : null };
}

export interface Confusion {
  tp: number;
  fn: number;
  fp: number;
  tn: number;
  precision: number;
}

const whole = (x: number) => Math.abs(x - Math.round(x)) < 1e-6;

/**
 * The hybrid mode's confusion matrix from the stored rates and test-set sizes. Exact only when the rates times the sizes
 * are whole numbers (three decimals over 1,000 samples always are); otherwise there is no exact matrix and null is returned.
 */
export function deriveConfusion(m: Metrics): Confusion | null {
  const h = m.modes[HYBRID]!;
  const tpRaw = h.recall * m.datasets.testFaulty;
  const fpRaw = h.false_alarm_rate * m.datasets.testNormal;
  if (!whole(tpRaw) || !whole(fpRaw)) return null;
  const tp = Math.round(tpRaw);
  const fp = Math.round(fpRaw);
  const c = { tp, fn: m.datasets.testFaulty - tp, fp, tn: m.datasets.testNormal - fp };
  return { ...c, precision: tp + fp === 0 ? 0 : tp / (tp + fp) };
}

/** Rounded to three decimals, as the stored figures are. */
export const round3 = (v: number) => Number(v.toFixed(3));
export const f1 = (p: number, r: number) => (p + r === 0 ? null : round3((2 * p * r) / (p + r)));

export const FAULT_NAMES: Record<string, string> = {
  unit_error: 'Unit error on land area',
  builtup_over: 'Built-up larger than plot',
  faculty_short: 'Faculty shortage',
  expired_lease: 'Expired lease',
  bulk_missing: 'Bulk fill with missing documents',
};
export const faultName = (k: string) => FAULT_NAMES[k] ?? k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
