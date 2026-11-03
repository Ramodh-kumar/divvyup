import { describe, expect, it } from 'vitest';
import { computeBalances, suggestSettlements } from './balances';
import { splitEqual } from './splits';

describe('computeBalances', () => {
  it('derives net balances from payers and splits', () => {
    // A pays 900 for A, B, C -> A is owed 600, B and C owe 300 each.
    const net = computeBalances(
      ['A', 'B', 'C'],
      [{ payers: [{ memberId: 'A', amountPaise: 900 }], splits: splitEqual(900, ['A', 'B', 'C']) }],
    );
    expect(net).toEqual({ A: 600, B: -300, C: -300 });
  });

  it('supports multiple payers', () => {
    const net = computeBalances(
      ['A', 'B'],
      [
        {
          payers: [
            { memberId: 'A', amountPaise: 700 },
            { memberId: 'B', amountPaise: 300 },
          ],
          splits: splitEqual(1000, ['A', 'B']),
        },
      ],
    );
    expect(net).toEqual({ A: 200, B: -200 });
  });

  it('applies settlements', () => {
    const expenses = [
      { payers: [{ memberId: 'A', amountPaise: 900 }], splits: splitEqual(900, ['A', 'B', 'C']) },
    ];
    const net = computeBalances(['A', 'B', 'C'], expenses, [
      { fromMemberId: 'B', toMemberId: 'A', amountPaise: 300 },
    ]);
    expect(net).toEqual({ A: 300, B: 0, C: -300 });
  });

  it('always sums to zero', () => {
    const net = computeBalances(
      ['A', 'B', 'C'],
      [{ payers: [{ memberId: 'B', amountPaise: 1001 }], splits: splitEqual(1001, ['A', 'B', 'C']) }],
      [{ fromMemberId: 'A', toMemberId: 'B', amountPaise: 123 }],
    );
    expect(Object.values(net).reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('suggestSettlements', () => {
  it('returns nothing when everyone is settled', () => {
    expect(suggestSettlements({ A: 0, B: 0 })).toEqual([]);
  });

  it('clears all balances with few transfers', () => {
    const balances = { A: 500, B: 300, C: -400, D: -400 };
    const transfers = suggestSettlements(balances);
    expect(transfers.length).toBeLessThanOrEqual(3);
    const after = { ...balances };
    for (const t of transfers) {
      after[t.from as keyof typeof after] += t.amountPaise;
      after[t.to as keyof typeof after] -= t.amountPaise;
    }
    expect(Object.values(after).every((v) => v === 0)).toBe(true);
  });

  it('is deterministic', () => {
    const b = { A: 100, B: 100, C: -100, D: -100 };
    expect(suggestSettlements(b)).toEqual(suggestSettlements({ ...b }));
    expect(suggestSettlements(b)).toEqual([
      { from: 'C', to: 'A', amountPaise: 100 },
      { from: 'D', to: 'B', amountPaise: 100 },
    ]);
  });
});
