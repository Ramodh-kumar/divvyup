import { describe, expect, it } from 'vitest';
import { formatINR, parseRupees } from './money';

describe('parseRupees', () => {
  it('parses plain and decimal amounts', () => {
    expect(parseRupees('100')).toBe(10000);
    expect(parseRupees('99.5')).toBe(9950);
    expect(parseRupees('0.05')).toBe(5);
    expect(parseRupees('1,23,456.78')).toBe(12345678);
    expect(parseRupees('₹ 250')).toBe(25000);
  });
  it('rejects bad input', () => {
    for (const bad of ['', 'abc', '1.234', '-5', '1.', '.5', '1e3']) {
      expect(parseRupees(bad)).toBeNull();
    }
  });
});

describe('formatINR', () => {
  it('uses Indian digit grouping', () => {
    expect(formatINR(0)).toBe('₹0.00');
    expect(formatINR(5)).toBe('₹0.05');
    expect(formatINR(99900)).toBe('₹999.00');
    expect(formatINR(100000)).toBe('₹1,000.00');
    expect(formatINR(12345678)).toBe('₹1,23,456.78');
    expect(formatINR(1000000000)).toBe('₹1,00,00,000.00');
  });
  it('handles negatives and no symbol', () => {
    expect(formatINR(-12345)).toBe('-₹123.45');
    expect(formatINR(12345, { symbol: false })).toBe('123.45');
  });
});
