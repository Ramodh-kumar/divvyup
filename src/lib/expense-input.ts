import type { Failure } from './http';
import { SplitError, splitEqual, splitExact, splitPercent, splitShares, type SplitShare } from './splits';
import type { SplitType } from './schema';

export const EXPENSE_LIMITS = {
  description: 120,
  note: 500,
  tags: 10,
  tagName: 30,
  maxPaise: 10_000_000_000, // Rs 10 crore
} as const;

export interface ParsedExpense {
  description: string;
  amountPaise: number;
  splitType: SplitType;
  paidOn: string;
  categoryId: string | null;
  note: string | null;
  payers: SplitShare[];
  splits: SplitShare[];
  tagNames: string[];
}

export interface ExpenseContext {
  memberIds: Set<string>;
  categoryIds: Set<string>;
}

const bad = (message: string): Failure => ({ status: 400, message });
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function validDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function parsePayers(body: Record<string, unknown>, amount: number, ctx: ExpenseContext): SplitShare[] | Failure {
  let payers: unknown = body.payers;
  if (payers === undefined && typeof body.paidBy === 'string') {
    payers = [{ memberId: body.paidBy, amountPaise: amount }];
  }
  if (!Array.isArray(payers) || payers.length === 0) return bad('Say who paid (paidBy or payers)');
  const out: SplitShare[] = [];
  for (const p of payers) {
    if (!isRecord(p) || typeof p.memberId !== 'string' || !Number.isSafeInteger(p.amountPaise) || (p.amountPaise as number) <= 0) {
      return bad('Each payer needs a memberId and a positive amountPaise');
    }
    if (!ctx.memberIds.has(p.memberId)) return bad('Payer is not a member of this list');
    out.push({ memberId: p.memberId, amountPaise: p.amountPaise as number });
  }
  if (new Set(out.map((p) => p.memberId)).size !== out.length) return bad('Duplicate payer');
  if (out.reduce((a, p) => a + p.amountPaise, 0) !== amount) return bad('Payer amounts must add up to the expense amount');
  return out;
}

function parseSplit(
  split: unknown,
  amount: number,
  ctx: ExpenseContext,
): { type: SplitType; shares: SplitShare[] } | Failure {
  if (!isRecord(split)) return bad('split is required');
  const type = split.type;
  if (type !== 'equal' && type !== 'exact' && type !== 'percent' && type !== 'shares') {
    return bad('split.type must be equal, exact, percent or shares');
  }
  const rows: unknown = type === 'equal' ? split.memberIds : split.entries;
  if (!Array.isArray(rows) || rows.length === 0) return bad('split needs at least one member');

  const ids = rows.map((r) => (type === 'equal' ? r : isRecord(r) ? r.memberId : undefined));
  if (ids.some((id) => typeof id !== 'string' || !ctx.memberIds.has(id))) return bad('Split includes someone who is not a member of this list');

  try {
    switch (type) {
      case 'equal':
        return { type, shares: splitEqual(amount, ids as string[]) };
      case 'exact':
        return { type, shares: splitExact(amount, rows as SplitShare[]) };
      case 'percent':
        return { type, shares: splitPercent(amount, rows as { memberId: string; percent: number }[]) };
      case 'shares':
        return { type, shares: splitShares(amount, rows as { memberId: string; shares: number }[]) };
    }
  } catch (e) {
    if (e instanceof SplitError) return bad(e.message);
    throw e;
  }
}

function parseTags(value: unknown): string[] | Failure {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((t) => typeof t !== 'string')) return bad('tags must be a list of names');
  const names: string[] = [];
  for (const raw of value as string[]) {
    const t = raw.trim();
    if (!t) continue;
    if (t.length > EXPENSE_LIMITS.tagName) return bad(`Tags must be at most ${EXPENSE_LIMITS.tagName} characters`);
    if (!names.some((n) => n.toLowerCase() === t.toLowerCase())) names.push(t);
  }
  return names.length > EXPENSE_LIMITS.tags ? bad(`At most ${EXPENSE_LIMITS.tags} tags`) : names;
}

/** Validate a create/replace expense request. Pure: member and category ids are passed in. */
export function parseExpenseInput(body: Record<string, unknown>, ctx: ExpenseContext): ParsedExpense | Failure {
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (!description || description.length > EXPENSE_LIMITS.description) {
    return bad(`Description must be 1-${EXPENSE_LIMITS.description} characters`);
  }

  const amount = body.amountPaise;
  if (!Number.isSafeInteger(amount) || (amount as number) <= 0 || (amount as number) > EXPENSE_LIMITS.maxPaise) {
    return bad('amountPaise must be a positive whole number of paise');
  }
  const amountPaise = amount as number;

  if (!validDate(body.paidOn)) return bad('paidOn must be a real date like 2026-11-03');

  let categoryId: string | null = null;
  if (body.categoryId !== undefined && body.categoryId !== null) {
    if (typeof body.categoryId !== 'string' || !ctx.categoryIds.has(body.categoryId)) return bad('Unknown category');
    categoryId = body.categoryId;
  }

  let note: string | null = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== 'string' || body.note.length > EXPENSE_LIMITS.note) return bad(`Note must be at most ${EXPENSE_LIMITS.note} characters`);
    note = body.note.trim() || null;
  }

  const payers = parsePayers(body, amountPaise, ctx);
  if ('status' in payers) return payers;
  const split = parseSplit(body.split, amountPaise, ctx);
  if ('status' in split) return split;
  const tagNames = parseTags(body.tags);
  if ('status' in tagNames) return tagNames;

  return {
    description,
    amountPaise,
    splitType: split.type,
    paidOn: body.paidOn,
    categoryId,
    note,
    payers,
    // Members who owe nothing (0 shares / exact 0) are not stored.
    splits: split.shares.filter((s) => s.amountPaise > 0),
    tagNames,
  };
}
