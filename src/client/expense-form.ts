// Pure logic behind the expense form: draft state, live split preview, and building the API payload.
// Kept free of React so it can be unit tested. Mirrors the server's rules so most mistakes are caught early.
import { formatINR, paiseToPlain, parseRupees } from '../lib/money';
import { splitEqual, splitPercent, splitShares } from '../lib/splits';
import type { Expense, Member } from './types';

export type SplitKind = 'equal' | 'exact' | 'percent' | 'shares';

export interface Draft {
  description: string;
  amount: string; // rupees as typed, e.g. "1,250.50"
  paidOn: string;
  categoryId: string; // '' = none
  note: string;
  tags: string; // comma separated
  multiPayer: boolean;
  paidBy: string;
  payerAmounts: Record<string, string>;
  splitType: SplitKind;
  included: Record<string, boolean>; // equal split
  exact: Record<string, string>; // rupees
  percent: Record<string, string>;
  shares: Record<string, string>;
}

const byMember = <T>(members: Member[], value: (m: Member) => T): Record<string, T> =>
  Object.fromEntries(members.map((m) => [m.id, value(m)]));

export const paiseToInput = paiseToPlain;

export function emptyDraft(members: Member[], me: string | null, date: string): Draft {
  return {
    description: '',
    amount: '',
    paidOn: date,
    categoryId: '',
    note: '',
    tags: '',
    multiPayer: false,
    paidBy: me && members.some((m) => m.id === me) ? me : members[0]?.id ?? '',
    payerAmounts: byMember(members, () => ''),
    splitType: 'equal',
    included: byMember(members, () => true),
    exact: byMember(members, () => ''),
    percent: byMember(members, () => ''),
    shares: byMember(members, () => '1'),
  };
}

/**
 * Turn a saved expense back into an editable draft. The server keeps only resolved amounts, so
 * percent/share splits reopen as exact figures (`convertedToExact`) - same money, just editable as amounts.
 */
export function draftFromExpense(e: Expense, members: Member[]): { draft: Draft; convertedToExact: boolean } {
  const base = emptyDraft(members, null, e.paidOn);
  const convertedToExact = e.splitType === 'percent' || e.splitType === 'shares';
  const splitType: SplitKind = e.splitType === 'equal' ? 'equal' : 'exact';
  const owed = new Map(e.splits.map((s) => [s.memberId, s.amountPaise]));
  const paid = new Map(e.payers.map((p) => [p.memberId, p.amountPaise]));
  return {
    convertedToExact,
    draft: {
      ...base,
      description: e.description,
      amount: paiseToInput(e.amountPaise),
      categoryId: e.categoryId ?? '',
      note: e.note ?? '',
      tags: e.tags.join(', '),
      multiPayer: e.payers.length > 1,
      paidBy: e.payers[0]?.memberId ?? base.paidBy,
      payerAmounts: byMember(members, (m) => (paid.has(m.id) ? paiseToInput(paid.get(m.id)!) : '')),
      splitType,
      included: byMember(members, (m) => owed.has(m.id)),
      exact: byMember(members, (m) => (owed.has(m.id) ? paiseToInput(owed.get(m.id)!) : '')),
    },
  };
}

const PERCENT = /^\d+(\.\d{1,2})?$/;

export interface SplitPreview {
  /** What each person would owe, in paise (only people who owe something). */
  amounts: Record<string, number>;
  /** Why the split cannot be saved yet, in plain words. */
  problem: string | null;
}

/** Live preview of who owes what. `total` is null while the amount is blank or invalid. */
export function previewSplit(d: Draft, members: Member[], total: number | null): SplitPreview {
  const ids = members.map((m) => m.id);
  const ok = (rows: { memberId: string; amountPaise: number }[]): SplitPreview => ({
    amounts: Object.fromEntries(rows.filter((r) => r.amountPaise > 0).map((r) => [r.memberId, r.amountPaise])),
    problem: null,
  });

  switch (d.splitType) {
    case 'equal': {
      const chosen = ids.filter((id) => d.included[id]);
      if (chosen.length === 0) return { amounts: {}, problem: 'Pick at least one person to split between' };
      return total ? ok(splitEqual(total, chosen)) : { amounts: {}, problem: null };
    }
    case 'exact': {
      const amounts: Record<string, number> = {};
      for (const id of ids) {
        const raw = d.exact[id]?.trim();
        if (!raw) continue;
        const p = parseRupees(raw);
        if (p === null) return { amounts: {}, problem: 'Enter amounts like 250 or 250.50' };
        if (p > 0) amounts[id] = p;
      }
      if (!total) return { amounts, problem: null };
      const diff = total - Object.values(amounts).reduce((a, b) => a + b, 0);
      if (diff > 0) return { amounts, problem: `${formatINR(diff)} still to assign` };
      if (diff < 0) return { amounts, problem: `${formatINR(-diff)} too much` };
      return { amounts, problem: null };
    }
    case 'percent': {
      const entries: { memberId: string; percent: number }[] = [];
      for (const id of ids) {
        const raw = d.percent[id]?.trim();
        if (!raw) continue;
        if (!PERCENT.test(raw)) return { amounts: {}, problem: 'Enter percentages like 40 or 33.33' };
        entries.push({ memberId: id, percent: Number(raw) });
      }
      const hundredths = entries.reduce((a, e) => a + Math.round(e.percent * 100), 0);
      if (hundredths !== 10000) {
        return { amounts: {}, problem: `Percentages add up to ${hundredths / 100}%, they need to make 100%` };
      }
      return total ? ok(splitPercent(total, entries)) : { amounts: {}, problem: null };
    }
    case 'shares': {
      const entries: { memberId: string; shares: number }[] = [];
      for (const id of ids) {
        const raw = d.shares[id]?.trim() || '0';
        if (!/^\d{1,4}$/.test(raw)) return { amounts: {}, problem: 'Shares must be whole numbers like 1 or 2' };
        entries.push({ memberId: id, shares: Number(raw) });
      }
      if (entries.every((e) => e.shares === 0)) return { amounts: {}, problem: 'Give at least one person a share' };
      return total ? ok(splitShares(total, entries)) : { amounts: {}, problem: null };
    }
  }
}

/** Multi-payer check: returns the payers, or a reason they are not ready. */
export function resolvePayers(d: Draft, members: Member[], total: number): { payers: { memberId: string; amountPaise: number }[] } | { problem: string } {
  if (!d.multiPayer) {
    return d.paidBy ? { payers: [{ memberId: d.paidBy, amountPaise: total }] } : { problem: 'Choose who paid' };
  }
  const payers: { memberId: string; amountPaise: number }[] = [];
  for (const m of members) {
    const raw = d.payerAmounts[m.id]?.trim();
    if (!raw) continue;
    const p = parseRupees(raw);
    if (p === null) return { problem: 'Enter amounts like 250 or 250.50' };
    if (p > 0) payers.push({ memberId: m.id, amountPaise: p });
  }
  if (payers.length === 0) return { problem: 'Enter how much each person paid' };
  const diff = total - payers.reduce((a, p) => a + p.amountPaise, 0);
  if (diff > 0) return { problem: `${formatINR(diff)} of what was paid is unaccounted for` };
  if (diff < 0) return { problem: `Payments add up to ${formatINR(-diff)} more than the total` };
  return { payers };
}

export type Built = { ok: true; body: Record<string, unknown> } | { ok: false; error: string };

/** Validate the draft and build the request body for POST/PUT /api/expenses. */
export function buildPayload(d: Draft, members: Member[]): Built {
  const description = d.description.trim();
  if (!description) return { ok: false, error: 'Add a description, like “Dinner”' };

  const amountPaise = parseRupees(d.amount);
  if (amountPaise === null || amountPaise <= 0) return { ok: false, error: 'Enter the amount, like 1250 or 1250.50' };
  if (!d.paidOn) return { ok: false, error: 'Pick the date' };

  const paid = resolvePayers(d, members, amountPaise);
  if ('problem' in paid) return { ok: false, error: paid.problem };

  const preview = previewSplit(d, members, amountPaise);
  if (preview.problem) return { ok: false, error: preview.problem };

  const ids = members.map((m) => m.id);
  let split: Record<string, unknown>;
  switch (d.splitType) {
    case 'equal':
      split = { type: 'equal', memberIds: ids.filter((id) => d.included[id]) };
      break;
    case 'exact':
      split = { type: 'exact', entries: Object.entries(preview.amounts).map(([memberId, amountPaise]) => ({ memberId, amountPaise })) };
      break;
    case 'percent':
      split = { type: 'percent', entries: ids.filter((id) => d.percent[id]?.trim()).map((id) => ({ memberId: id, percent: Number(d.percent[id]) })) };
      break;
    case 'shares':
      split = { type: 'shares', entries: ids.map((id) => ({ memberId: id, shares: Number(d.shares[id]?.trim() || '0') })) };
      break;
  }

  return {
    ok: true,
    body: {
      description,
      amountPaise,
      paidOn: d.paidOn,
      categoryId: d.categoryId || null,
      note: d.note.trim() || null,
      tags: d.tags.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean),
      payers: paid.payers,
      split,
    },
  };
}
