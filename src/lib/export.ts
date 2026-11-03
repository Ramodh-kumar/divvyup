import type { Db } from './db';
import { loadExpenses, type ExpenseView } from './expenses';
import { getSnapshot } from './lists';
import { paiseToPlain } from './money';
import { loadSettlements, type SettlementView } from './settlements';

export const EXPORT_FORMAT = 'divvyup-export';
export const EXPORT_VERSION = 1;

/** The backup file. Ids are only used to tie records together inside the file; import issues fresh ones. */
export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  list: { name: string; currency: string };
  members: { id: string; name: string; color: string | null }[];
  categories: { id: string; name: string; icon: string | null }[];
  expenses: {
    id: string;
    description: string;
    amountPaise: number;
    splitType: string;
    paidOn: string;
    categoryId: string | null;
    note: string | null;
    tags: string[];
    payers: { memberId: string; amountPaise: number }[];
    splits: { memberId: string; amountPaise: number }[];
  }[];
  settlements: { id: string; fromMemberId: string; toMemberId: string; amountPaise: number; paidOn: string }[];
}

/** Everything live in a list (soft-deleted items are not part of a backup). */
export async function buildExport(db: Db, listId: string): Promise<ExportFile | null> {
  const snapshot = await getSnapshot(db, listId);
  if (!snapshot) return null;
  const [expenses, settlements] = await Promise.all([loadExpenses(db, listId), loadSettlements(db, listId)]);
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    list: { name: snapshot.list.name, currency: snapshot.list.currency },
    members: snapshot.members,
    categories: snapshot.categories,
    expenses: expenses.map((e: ExpenseView) => ({
      id: e.id,
      description: e.description,
      amountPaise: e.amountPaise,
      splitType: e.splitType,
      paidOn: e.paidOn,
      categoryId: e.categoryId,
      note: e.note,
      tags: e.tags,
      payers: e.payers,
      splits: e.splits,
    })),
    settlements: settlements.map((s: SettlementView) => ({
      id: s.id,
      fromMemberId: s.fromMemberId,
      toMemberId: s.toMemberId,
      amountPaise: s.amountPaise,
      paidOn: s.paidOn,
    })),
  };
}

/**
 * One CSV cell. Cells that start with = + - @ are prefixed with an apostrophe so spreadsheets
 * show them as text instead of running them as formulas (CSV injection).
 */
function cell(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A spreadsheet-friendly view: one row per expense or payment, plus a column per person's share. */
export function toCsv(file: ExportFile): string {
  const name = new Map(file.members.map((m) => [m.id, m.name]));
  const category = new Map(file.categories.map((c) => [c.id, c.name]));
  const who = (id: string) => name.get(id) ?? '';

  const header = ['Type', 'Date', 'Description', 'Category', 'Amount (INR)', 'Paid by', 'Tags', 'Note', ...file.members.map((m) => `Share: ${m.name}`)];
  const rows: (string | number)[][] = [];

  for (const e of file.expenses) {
    const owed = new Map(e.splits.map((s) => [s.memberId, s.amountPaise]));
    rows.push([
      'expense',
      e.paidOn,
      e.description,
      e.categoryId ? (category.get(e.categoryId) ?? '') : '',
      paiseToPlain(e.amountPaise),
      e.payers.map((p) => (e.payers.length > 1 ? `${who(p.memberId)} (${paiseToPlain(p.amountPaise)})` : who(p.memberId))).join('; '),
      e.tags.join('; '),
      e.note ?? '',
      ...file.members.map((m) => (owed.has(m.id) ? paiseToPlain(owed.get(m.id)!) : '')),
    ]);
  }
  for (const s of file.settlements) {
    rows.push(['payment', s.paidOn, `${who(s.fromMemberId)} paid ${who(s.toMemberId)}`, '', paiseToPlain(s.amountPaise), who(s.fromMemberId), '', '', ...file.members.map(() => '')]);
  }

  // BOM so Excel opens it as UTF-8 (otherwise names and the rupee sign get garbled).
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** A safe file name stem from the list name, e.g. "Goa Trip 2026" -> "goa-trip-2026". */
export function fileStem(listName: string): string {
  const slug = listName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `divvyup-${slug || 'list'}`;
}
