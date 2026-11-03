import { describe, expect, it } from 'vitest';
import { SplitError, allocate, splitEqual, splitExact, splitPercent, splitShares } from './splits';

const sum = (xs: { amountPaise: number }[]) => xs.reduce((a, x) => a + x.amountPaise, 0);

describe('allocate', () => {
  it('always sums to the total', () => {
    for (let total = 1; total <= 200; total++) {
      for (const weights of [[1, 1, 1], [1, 2, 3], [5, 0, 7, 1], [3333, 3333, 3334]]) {
        expect(allocate(total, weights).reduce((a, b) => a + b, 0)).toBe(total);
      }
    }
  });
  it('gives leftovers to the largest remainders, lowest index on ties', () => {
    expect(allocate(1000, [1, 1, 1])).toEqual([334, 333, 333]);
    expect(allocate(2, [1, 1, 1])).toEqual([1, 1, 0]);
  });
  it('rejects zero total weight', () => {
    expect(() => allocate(100, [0, 0])).toThrow(SplitError);
  });
});

describe('splitEqual', () => {
  it('splits 10.00 three ways with the extra paisa on the first member by id', () => {
    const r = splitEqual(1000, ['c', 'a', 'b']);
    expect(r).toEqual([
      { memberId: 'a', amountPaise: 334 },
      { memberId: 'b', amountPaise: 333 },
      { memberId: 'c', amountPaise: 333 },
    ]);
  });
  it('is independent of input order', () => {
    expect(splitEqual(1001, ['x', 'y', 'z'])).toEqual(splitEqual(1001, ['z', 'x', 'y']));
  });
  it('rejects bad input', () => {
    expect(() => splitEqual(0, ['a'])).toThrow(SplitError);
    expect(() => splitEqual(100, [])).toThrow(SplitError);
    expect(() => splitEqual(100, ['a', 'a'])).toThrow(SplitError);
    expect(() => splitEqual(10.5, ['a'])).toThrow(SplitError);
  });
});

describe('splitExact', () => {
  it('accepts amounts that match the total', () => {
    const r = splitExact(1000, [
      { memberId: 'b', amountPaise: 400 },
      { memberId: 'a', amountPaise: 600 },
    ]);
    expect(sum(r)).toBe(1000);
    expect(r[0].memberId).toBe('a');
  });
  it('rejects mismatched or negative amounts', () => {
    expect(() => splitExact(1000, [{ memberId: 'a', amountPaise: 999 }])).toThrow(SplitError);
    expect(() =>
      splitExact(1000, [
        { memberId: 'a', amountPaise: 1100 },
        { memberId: 'b', amountPaise: -100 },
      ]),
    ).toThrow(SplitError);
  });
});

describe('splitPercent', () => {
  it('splits by percentage and sums exactly', () => {
    const r = splitPercent(10001, [
      { memberId: 'a', percent: 33.33 },
      { memberId: 'b', percent: 33.33 },
      { memberId: 'c', percent: 33.34 },
    ]);
    expect(sum(r)).toBe(10001);
  });
  it('requires 100 percent', () => {
    expect(() =>
      splitPercent(1000, [
        { memberId: 'a', percent: 50 },
        { memberId: 'b', percent: 40 },
      ]),
    ).toThrow(SplitError);
  });
});

describe('splitShares', () => {
  it('splits proportionally and gives zero-share members nothing', () => {
    const r = splitShares(900, [
      { memberId: 'a', shares: 2 },
      { memberId: 'b', shares: 1 },
      { memberId: 'c', shares: 0 },
    ]);
    expect(r).toEqual([
      { memberId: 'a', amountPaise: 600 },
      { memberId: 'b', amountPaise: 300 },
      { memberId: 'c', amountPaise: 0 },
    ]);
  });
  it('rejects fractional shares and all-zero shares', () => {
    expect(() => splitShares(100, [{ memberId: 'a', shares: 1.5 }])).toThrow(SplitError);
    expect(() => splitShares(100, [{ memberId: 'a', shares: 0 }])).toThrow(SplitError);
  });
});
