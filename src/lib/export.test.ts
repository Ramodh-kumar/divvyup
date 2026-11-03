import { describe, expect, it } from 'vitest';
import { fileStem, toCsv, type ExportFile } from './export';
import { parseImport } from './import';

const file = (): ExportFile => ({
  format: 'divvyup-export',
  version: 1,
  exportedAt: '2026-11-03T10:00:00.000Z',
  list: { name: 'Goa Trip', currency: 'INR' },
  members: [
    { id: 'a', name: 'Asha', color: '#ef4444' },
    { id: 'r', name: 'Ravi', color: null },
  ],
  categories: [{ id: 'c1', name: 'Food', icon: '🍽️' }],
  expenses: [
    {
      id: 'e1', description: 'Dinner, "beach" shack', amountPaise: 123450, splitType: 'equal', paidOn: '2026-11-02', categoryId: 'c1', note: null, tags: ['goa', 'trip'],
      payers: [{ memberId: 'a', amountPaise: 123450 }],
      splits: [{ memberId: 'a', amountPaise: 61725 }, { memberId: 'r', amountPaise: 61725 }],
    },
  ],
  settlements: [{ id: 's1', fromMemberId: 'r', toMemberId: 'a', amountPaise: 5000, paidOn: '2026-11-03' }],
});

describe('toCsv', () => {
  it('writes a header, an expense row with per-person shares, and a payment row', () => {
    const lines = toCsv(file()).replace('﻿', '').trim().split('\r\n');
    expect(lines[0]).toBe('Type,Date,Description,Category,Amount (INR),Paid by,Tags,Note,Share: Asha,Share: Ravi');
    expect(lines[1]).toBe('expense,2026-11-02,"Dinner, ""beach"" shack",Food,1234.50,Asha,goa; trip,,617.25,617.25');
    expect(lines[2]).toBe('payment,2026-11-03,Ravi paid Asha,,50.00,Ravi,,,,');
  });
  it('starts with a BOM so Excel reads UTF-8', () => {
    expect(toCsv(file()).charCodeAt(0)).toBe(0xfeff);
  });
  it('defuses spreadsheet formulas', () => {
    const f = file();
    f.expenses[0].description = '=HYPERLINK("http://evil")';
    f.expenses[0].note = '@SUM(A1)';
    const csv = toCsv(f);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain(`'@SUM(A1)`);
  });
});

describe('fileStem', () => {
  it('makes safe file names', () => {
    expect(fileStem('Goa Trip 2026!')).toBe('divvyup-goa-trip-2026');
    expect(fileStem('../../etc/passwd')).toBe('divvyup-etc-passwd');
    expect(fileStem('🎉')).toBe('divvyup-list');
  });
});

describe('parseImport', () => {
  const bad = (mutate: (f: any) => void) => {
    const f: any = JSON.parse(JSON.stringify(file()));
    mutate(f);
    const r = parseImport(f);
    if (typeof r !== 'string') throw new Error('expected rejection');
    return r;
  };

  it('accepts a valid export (round trip through JSON)', () => {
    const r = parseImport(JSON.parse(JSON.stringify(file())));
    expect(typeof r).toBe('object');
    if (typeof r === 'string') return;
    expect(r.expenses[0].tags).toEqual(['goa', 'trip']);
    expect(r.members.map((m) => m.name)).toEqual(['Asha', 'Ravi']);
  });

  it('rejects non-backups and unknown versions', () => {
    expect(parseImport({})).toMatch(/not a DivvyUp backup/);
    expect(parseImport(null)).toMatch(/not a DivvyUp backup/);
    expect(parseImport([])).toMatch(/not a DivvyUp backup/);
    expect(bad((f) => (f.version = 2))).toMatch(/version 2/);
    expect(bad((f) => (f.list.currency = 'USD'))).toMatch(/INR/);
  });

  it('rejects broken money', () => {
    expect(bad((f) => (f.expenses[0].amountPaise = 100))).toMatch(/does not add up/);
    expect(bad((f) => (f.expenses[0].amountPaise = -5))).toMatch(/invalid amount/);
    expect(bad((f) => (f.expenses[0].splits[0].amountPaise = 1))).toMatch(/the split does not add up/);
    expect(bad((f) => (f.settlements[0].amountPaise = 0))).toMatch(/invalid amount/);
  });

  it('rejects dangling references and duplicates', () => {
    expect(bad((f) => (f.expenses[0].payers[0].memberId = 'zzz'))).toMatch(/not in the file/);
    expect(bad((f) => (f.expenses[0].categoryId = 'nope'))).toMatch(/unknown category/);
    expect(bad((f) => (f.settlements[0].toMemberId = 'r'))).toMatch(/invalid people/);
    expect(bad((f) => (f.members[1].name = 'asha'))).toMatch(/appears twice/);
    expect(bad((f) => (f.expenses[0].splits[1].memberId = 'a'))).toMatch(/twice/);
  });

  it('rejects bad dates, split types and oversized lists', () => {
    expect(bad((f) => (f.expenses[0].paidOn = '2026-02-30'))).toMatch(/invalid date/);
    expect(bad((f) => (f.expenses[0].splitType = 'weird'))).toMatch(/split type/);
    expect(bad((f) => (f.expenses = Array.from({ length: 2001 }, (_, i) => ({ ...f.expenses[0], id: `x${i}` }))))).toMatch(/at most 2000/);
  });
});
