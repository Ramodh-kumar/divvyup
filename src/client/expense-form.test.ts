import { describe, expect, it } from 'vitest';
import { buildPayload, draftFromExpense, emptyDraft, paiseToInput, previewSplit, type Draft } from './expense-form';
import type { Expense, Member } from './types';

const members: Member[] = [
  { id: 'a', name: 'Asha', color: null },
  { id: 'b', name: 'Ravi', color: null },
  { id: 'c', name: 'Meera', color: null },
];

const draft = (patch: Partial<Draft> = {}): Draft => ({
  ...emptyDraft(members, 'a', '2026-11-03'),
  description: 'Dinner',
  amount: '900',
  ...patch,
});

const body = (d: Draft) => {
  const r = buildPayload(d, members);
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.body as any;
};
const err = (d: Draft) => {
  const r = buildPayload(d, members);
  if (r.ok) throw new Error('expected failure');
  return r.error;
};

describe('paiseToInput', () => {
  it('formats with integer math', () => {
    expect(paiseToInput(123450)).toBe('1234.50');
    expect(paiseToInput(5)).toBe('0.05');
    expect(paiseToInput(100)).toBe('1.00');
  });
});

describe('buildPayload', () => {
  it('builds an equal split paid by one person, defaulting to "me"', () => {
    const b = body(draft({ tags: ' Goa, #trip ,, ', note: '  hi ' }));
    expect(b.amountPaise).toBe(90000);
    expect(b.payers).toEqual([{ memberId: 'a', amountPaise: 90000 }]);
    expect(b.split).toEqual({ type: 'equal', memberIds: ['a', 'b', 'c'] });
    expect(b.tags).toEqual(['Goa', 'trip']);
    expect(b.note).toBe('hi');
    expect(b.categoryId).toBeNull();
  });

  it('respects who is included in an equal split', () => {
    expect(body(draft({ included: { a: true, b: false, c: true } })).split.memberIds).toEqual(['a', 'c']);
    expect(err(draft({ included: { a: false, b: false, c: false } }))).toMatch(/at least one person/);
  });

  it('builds exact splits and reports what is left', () => {
    const exact = { a: '500', b: '250.50', c: '' };
    expect(err(draft({ splitType: 'exact', exact }))).toMatch(/₹149\.50 still to assign/);
    expect(err(draft({ splitType: 'exact', exact: { ...exact, c: '200' } }))).toMatch(/₹50\.50 too much/);
    const b = body(draft({ splitType: 'exact', exact: { a: '500', b: '250.50', c: '149.50' } }));
    expect(b.split.entries).toEqual([
      { memberId: 'a', amountPaise: 50000 },
      { memberId: 'b', amountPaise: 25050 },
      { memberId: 'c', amountPaise: 14950 },
    ]);
  });

  it('builds percent splits', () => {
    expect(err(draft({ splitType: 'percent', percent: { a: '50', b: '30', c: '' } }))).toMatch(/80%/);
    const b = body(draft({ splitType: 'percent', percent: { a: '50', b: '30', c: '20' } }));
    expect(b.split.entries).toHaveLength(3);
  });

  it('builds share splits', () => {
    const b = body(draft({ splitType: 'shares', shares: { a: '2', b: '1', c: '0' } }));
    expect(b.split).toEqual({ type: 'shares', entries: [{ memberId: 'a', shares: 2 }, { memberId: 'b', shares: 1 }, { memberId: 'c', shares: 0 }] });
    expect(err(draft({ splitType: 'shares', shares: { a: '0', b: '0', c: '0' } }))).toMatch(/at least one person a share/);
    expect(err(draft({ splitType: 'shares', shares: { a: '1.5', b: '1', c: '1' } }))).toMatch(/whole numbers/);
  });

  it('supports multiple payers that must add up', () => {
    const multi = { multiPayer: true, payerAmounts: { a: '600', b: '200', c: '' } };
    expect(err(draft(multi))).toMatch(/₹100\.00 of what was paid is unaccounted/);
    const b = body(draft({ ...multi, payerAmounts: { a: '600', b: '300', c: '' } }));
    expect(b.payers).toEqual([{ memberId: 'a', amountPaise: 60000 }, { memberId: 'b', amountPaise: 30000 }]);
  });

  it('rejects missing or invalid basics', () => {
    expect(err(draft({ description: '  ' }))).toMatch(/description/i);
    expect(err(draft({ amount: '' }))).toMatch(/amount/i);
    expect(err(draft({ amount: '12.345' }))).toMatch(/amount/i);
    expect(err(draft({ amount: '0' }))).toMatch(/amount/i);
    expect(err(draft({ paidOn: '' }))).toMatch(/date/i);
    expect(err(draft({ paidBy: '' }))).toMatch(/who paid/i);
  });
});

describe('previewSplit', () => {
  it('shows per-person amounts before the form is complete', () => {
    const p = previewSplit(draft(), members, 100000);
    expect(p.amounts).toEqual({ a: 33334, b: 33333, c: 33333 });
    expect(previewSplit(draft(), members, null).amounts).toEqual({});
  });
});

describe('draftFromExpense', () => {
  const expense = (over: Partial<Expense>): Expense => ({
    id: 'e1', description: 'Villa', amountPaise: 100000, splitType: 'equal', paidOn: '2026-11-01', categoryId: 'cat', note: null,
    revision: 3, createdBy: null, updatedBy: null, createdAt: 0, updatedAt: 0,
    payers: [{ memberId: 'b', amountPaise: 100000 }],
    splits: [{ memberId: 'a', amountPaise: 50000 }, { memberId: 'b', amountPaise: 50000 }],
    tags: ['goa'], ...over,
  });

  it('round-trips an equal expense', () => {
    const { draft: d, convertedToExact } = draftFromExpense(expense({}), members);
    expect(convertedToExact).toBe(false);
    expect(d.amount).toBe('1000.00');
    expect(d.paidBy).toBe('b');
    expect(d.included).toEqual({ a: true, b: true, c: false });
    expect(body(d).split).toEqual({ type: 'equal', memberIds: ['a', 'b'] });
    expect(d.tags).toBe('goa');
  });

  it('reopens percent/share splits as exact amounts that still add up', () => {
    const e = expense({ splitType: 'shares', splits: [{ memberId: 'a', amountPaise: 66667 }, { memberId: 'b', amountPaise: 33333 }] });
    const { draft: d, convertedToExact } = draftFromExpense(e, members);
    expect(convertedToExact).toBe(true);
    expect(d.splitType).toBe('exact');
    expect(body(d).split.entries).toEqual([{ memberId: 'a', amountPaise: 66667 }, { memberId: 'b', amountPaise: 33333 }]);
  });

  it('restores multiple payers', () => {
    const e = expense({ payers: [{ memberId: 'a', amountPaise: 70000 }, { memberId: 'c', amountPaise: 30000 }] });
    const { draft: d } = draftFromExpense(e, members);
    expect(d.multiPayer).toBe(true);
    expect(body(d).payers).toEqual([{ memberId: 'a', amountPaise: 70000 }, { memberId: 'c', amountPaise: 30000 }]);
  });
});
