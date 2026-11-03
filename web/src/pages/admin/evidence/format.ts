import { formatNumber } from '../../../lib/format';

/** Missing is not zero: null, undefined, NaN and +/-Infinity read "Unavailable"; a real 0 reads "0". */
const UNAVAILABLE = 'Unavailable';
const isMissing = (v: number | null | undefined): v is null | undefined => v === null || v === undefined || !Number.isFinite(v);

export const fmtInt = (v: number | null | undefined): string => (isMissing(v) ? UNAVAILABLE : formatNumber(Math.round(v) + 0));

/** `v` is a fraction: 0.256 -> "26%" (dp = 0) or "25.6%" (dp = 1). Never "-0%". */
export const fmtPct = (v: number | null | undefined, dp = 0): string => {
  if (isMissing(v)) return UNAVAILABLE;
  const s = (v * 100).toFixed(dp);
  return `${Number(s) === 0 ? s.replace('-', '') : s}%`;
};

/** Milliseconds, as seconds once they pass 1000. */
export const fmtMs = (v: number | null | undefined): string => {
  if (isMissing(v)) return UNAVAILABLE;
  if (v >= 1000) return `${Math.round(v / 100) / 10} s`;
  return `${formatNumber(Math.round(v) + 0)} ms`;
};

export { UNAVAILABLE };
