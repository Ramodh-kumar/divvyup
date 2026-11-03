import { describe, expect, it } from 'vitest';
import { parseSettlementInput, type ParsedSettlement } from './settlements';

const members = new Set(['a', 'b']);
const base = { fromMemberId: 'a', toMemberId: 'b', amountPaise: 50000, paidOn: '2026-11-03' };
const msg = (body: Record<string, unknown>) => {
  const r = parseSettlementInput(body, members);
  if (!('status' in r)) throw new Error('expected failure');
  return r.message;
};

describe('parseSettlementInput', () => {
  it('accepts a valid settlement', () => {
    expect(parseSettlementInput(base, members) as ParsedSettlement).toEqual(base);
  });
  it('rejects self-payment, strangers, bad amounts and dates', () => {
    expect(msg({ ...base, toMemberId: 'a' })).toMatch(/themselves/);
    expect(msg({ ...base, toMemberId: 'zzz' })).toMatch(/members/);
    expect(msg({ ...base, fromMemberId: undefined })).toMatch(/required/);
    for (const amountPaise of [0, -1, 1.5, '500']) expect(msg({ ...base, amountPaise })).toMatch(/amountPaise/);
    expect(msg({ ...base, paidOn: 'yesterday' })).toMatch(/paidOn/);
  });
});
