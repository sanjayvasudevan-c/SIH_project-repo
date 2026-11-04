import { describe, expect, it } from 'vitest';
import { fmtInt, fmtMs, fmtPct } from './format';

describe('evidence formatting: missing is not zero', () => {
  it('fmtInt', () => {
    expect(fmtInt(null)).toBe('Unavailable');
    expect(fmtInt(undefined)).toBe('Unavailable');
    expect(fmtInt(0)).toBe('0');
    expect(fmtInt(1234567)).toBe('12,34,567');
  });
  it('non-finite numbers are missing, not values', () => {
    for (const v of [Infinity, -Infinity, NaN]) {
      expect(fmtInt(v)).toBe('Unavailable');
      expect(fmtPct(v)).toBe('Unavailable');
      expect(fmtMs(v)).toBe('Unavailable');
    }
  });
  it('never renders a negative zero', () => {
    expect(fmtPct(-0.001)).toBe('0%');
    expect(fmtPct(-0)).toBe('0%');
    expect(fmtInt(-0.2)).toBe('0');
  });
  it('fmtPct takes a fraction', () => {
    expect(fmtPct(null)).toBe('Unavailable');
    expect(fmtPct(0)).toBe('0%');
    expect(fmtPct(0.256)).toBe('26%');
    expect(fmtPct(0.256, 1)).toBe('25.6%');
  });
  it('fmtMs', () => {
    expect(fmtMs(null)).toBe('Unavailable');
    expect(fmtMs(0)).toBe('0 ms');
    expect(fmtMs(412)).toBe('412 ms');
    expect(fmtMs(2500)).toBe('2.5 s');
  });
});
