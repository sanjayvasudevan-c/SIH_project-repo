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

/** A list from a response field that may be missing or not a list: anything else is an empty list, never a throw. */
export const list = <T>(v: readonly T[] | null | undefined): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** One decimal when the value is not whole (a median of 5.5 is not 6); a whole value has none. */
export const fmtMedian = (v: number | null | undefined): string => (isMissing(v) ? UNAVAILABLE : Number.isInteger(v) ? formatNumber(v) : formatNumber(Math.round(v * 10) / 10, true));

/** "just now", "4 h ago", "3 days ago" for an age in seconds. */
export function agoSeconds(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return UNAVAILABLE;
  if (s < 0) return 'in the future';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/** The same, for an ISO timestamp relative to `now`. An unreadable time is "Unavailable", never a guess. */
export function ago(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return UNAVAILABLE;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? agoSeconds(Math.round((now - t) / 1000)) : UNAVAILABLE;
}

/** How an engine cycle ended, in words. None of them claims anything about the scheduler process itself. */
export const RUN_STATUS_WORDS: Record<string, string> = { OK: 'Finished', FAILED: 'Failed', RUNNING: 'Started, not finished' };
