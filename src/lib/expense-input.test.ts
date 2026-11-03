import { describe, expect, it } from 'vitest';
import { parseExpenseInput, type ParsedExpense } from './expense-input';

const ctx = { memberIds: new Set(['a', 'b', 'c']), categoryIds: new Set(['food']) };
const base = {
  description: ' Dinner ',
  amountPaise: 90000,
  paidOn: '2026-11-03',
  paidBy: 'a',
  split: { type: 'equal', memberIds: ['a', 'b', 'c'] },
};

const ok = (body: Record<string, unknown>) => {
  const r = parseExpenseInput(body, ctx);
  if ('status' in r) throw new Error(`expected success, got: ${r.message}`);
  return r as ParsedExpense;
};
const msg = (body: Record<string, unknown>) => {
  const r = parseExpenseInput(body, ctx);
  if (!('status' in r)) throw new Error('expected failure');
  return r.message;
};

describe('parseExpenseInput', () => {
  it('accepts a simple equal split and normalises fields', () => {
    const r = ok({ ...base, categoryId: 'food', note: '  fun  ', tags: ['Goa', 'goa', ' trip '] });
    expect(r.description).toBe('Dinner');
    expect(r.payers).toEqual([{ memberId: 'a', amountPaise: 90000 }]);
    expect(r.splits.map((s) => s.amountPaise)).toEqual([30000, 30000, 30000]);
    expect(r.categoryId).toBe('food');
    expect(r.note).toBe('fun');
    expect(r.tagNames).toEqual(['Goa', 'trip']);
  });

  it('supports multiple payers that add up', () => {
    const r = ok({ ...base, paidBy: undefined, payers: [{ memberId: 'a', amountPaise: 50000 }, { memberId: 'b', amountPaise: 40000 }] });
    expect(r.payers).toHaveLength(2);
    expect(msg({ ...base, paidBy: undefined, payers: [{ memberId: 'a', amountPaise: 50000 }] })).toMatch(/add up/);
  });

  it('supports exact, percent and shares splits', () => {
    expect(ok({ ...base, split: { type: 'exact', entries: [{ memberId: 'a', amountPaise: 60000 }, { memberId: 'b', amountPaise: 30000 }] } }).splitType).toBe('exact');
    const pct = ok({ ...base, split: { type: 'percent', entries: [{ memberId: 'a', percent: 50 }, { memberId: 'b', percent: 50 }] } });
    expect(pct.splits.map((s) => s.amountPaise)).toEqual([45000, 45000]);
    const sh = ok({ ...base, split: { type: 'shares', entries: [{ memberId: 'a', shares: 2 }, { memberId: 'b', shares: 1 }, { memberId: 'c', shares: 0 }] } });
    expect(sh.splits).toEqual([{ memberId: 'a', amountPaise: 60000 }, { memberId: 'b', amountPaise: 30000 }]); // zero owed is dropped
  });

  it('rejects bad amounts and dates', () => {
    for (const amountPaise of [0, -5, 10.5, '900', 20_000_000_000]) expect(msg({ ...base, amountPaise })).toMatch(/amountPaise/);
    expect(msg({ ...base, paidOn: '2026-02-30' })).toMatch(/paidOn/);
    expect(msg({ ...base, paidOn: '03/11/2026' })).toMatch(/paidOn/);
    expect(msg({ ...base, description: '   ' })).toMatch(/Description/);
  });

  it('rejects people and categories outside the list', () => {
    expect(msg({ ...base, paidBy: 'zzz' })).toMatch(/not a member/);
    expect(msg({ ...base, split: { type: 'equal', memberIds: ['a', 'zzz'] } })).toMatch(/not a member/);
    expect(msg({ ...base, categoryId: 'nope' })).toMatch(/category/i);
  });

  it('rejects invalid splits with a clear message', () => {
    expect(msg({ ...base, split: { type: 'exact', entries: [{ memberId: 'a', amountPaise: 1 }] } })).toMatch(/add up/);
    expect(msg({ ...base, split: { type: 'percent', entries: [{ memberId: 'a', percent: 60 }] } })).toMatch(/100/);
    expect(msg({ ...base, split: { type: 'weird', memberIds: ['a'] } })).toMatch(/split.type/);
    expect(msg({ ...base, split: undefined })).toMatch(/split/);
    expect(msg({ ...base, split: { type: 'equal', memberIds: [] } })).toMatch(/at least one/);
  });
});
