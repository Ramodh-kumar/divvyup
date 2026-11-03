import type { Db } from './db';
import { EXPENSE_LIMITS, validDate } from './expense-input';
import { EXPORT_FORMAT, EXPORT_VERSION, type ExportFile } from './export';
import { DEFAULT_CATEGORIES, LIMITS, MEMBER_COLORS } from './lists';
import { categories, events, expensePayers, expenses, expenseSplits, expenseTags, lists, members, settlements, SPLIT_TYPES, tags } from './schema';
import { generateToken, hashToken, newId } from './tokens';

export const IMPORT_LIMITS = { bytes: 5_000_000, expenses: 2000, settlements: 2000, categories: 50 } as const;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v: unknown): v is number => Number.isSafeInteger(v);
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null);

type Shares = { memberId: string; amountPaise: number }[];

function shares(raw: unknown, memberIds: Set<string>, total: number, what: string): Shares | string {
  if (!Array.isArray(raw) || raw.length === 0) return `${what} is missing`;
  const out: Shares = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!isRecord(r) || typeof r.memberId !== 'string' || !isInt(r.amountPaise) || r.amountPaise <= 0) return `${what} has an invalid entry`;
    if (!memberIds.has(r.memberId)) return `${what} refers to someone who is not in the file`;
    if (seen.has(r.memberId)) return `${what} lists the same person twice`;
    seen.add(r.memberId);
    out.push({ memberId: r.memberId, amountPaise: r.amountPaise });
  }
  return out.reduce((a, s) => a + s.amountPaise, 0) === total ? out : `${what} does not add up to the amount`;
}

/**
 * Validate an untrusted backup file. Everything is checked (sizes, references, that each expense's
 * payers and splits add up to its amount) so a bad file is rejected whole instead of half-imported.
 * Returns the cleaned file, or a message saying what is wrong.
 */
export function parseImport(raw: unknown): ExportFile | string {
  if (!isRecord(raw) || raw.format !== EXPORT_FORMAT) return 'This is not a DivvyUp backup file.';
  if (raw.version !== EXPORT_VERSION) return `This backup is version ${String(raw.version)}, which this app cannot read.`;

  if (!isRecord(raw.list)) return 'The backup has no list details.';
  const name = text(raw.list.name, LIMITS.listName);
  if (!name) return 'The list name is missing or too long.';
  if (raw.list.currency !== 'INR') return 'Only INR lists can be imported.';

  if (!Array.isArray(raw.members) || raw.members.length > LIMITS.members) return `A list can have at most ${LIMITS.members} people.`;
  const memberList: ExportFile['members'] = [];
  const memberIds = new Set<string>();
  const memberNames = new Set<string>();
  for (const m of raw.members) {
    const mname = isRecord(m) ? text(m.name, LIMITS.memberName) : null;
    if (!isRecord(m) || typeof m.id !== 'string' || !mname || memberIds.has(m.id)) return 'A person in the backup is invalid.';
    if (memberNames.has(mname.toLowerCase())) return `The name "${mname}" appears twice.`;
    const color = typeof m.color === 'string' && /^#[0-9a-f]{6}$/i.test(m.color) ? m.color.toLowerCase() : null;
    memberIds.add(m.id);
    memberNames.add(mname.toLowerCase());
    memberList.push({ id: m.id, name: mname, color });
  }

  if (!Array.isArray(raw.categories) || raw.categories.length > IMPORT_LIMITS.categories) return 'The backup has too many categories.';
  const categoryList: ExportFile['categories'] = [];
  const categoryIds = new Set<string>();
  for (const c of raw.categories) {
    const cname = isRecord(c) ? text(c.name, 40) : null;
    if (!isRecord(c) || typeof c.id !== 'string' || !cname || categoryIds.has(c.id)) return 'A category in the backup is invalid.';
    categoryIds.add(c.id);
    categoryList.push({ id: c.id, name: cname, icon: typeof c.icon === 'string' && c.icon.length <= 8 ? c.icon : null });
  }

  if (!Array.isArray(raw.expenses) || raw.expenses.length > IMPORT_LIMITS.expenses) return `A backup can hold at most ${IMPORT_LIMITS.expenses} expenses.`;
  const expenseList: ExportFile['expenses'] = [];
  const expenseIds = new Set<string>();
  for (const [i, e] of raw.expenses.entries()) {
    const label = `Expense #${i + 1}`;
    if (!isRecord(e) || typeof e.id !== 'string' || expenseIds.has(e.id)) return `${label} is invalid.`;
    expenseIds.add(e.id);
    const description = text(e.description, EXPENSE_LIMITS.description);
    if (!description) return `${label} has no description.`;
    if (!isInt(e.amountPaise) || e.amountPaise <= 0 || e.amountPaise > EXPENSE_LIMITS.maxPaise) return `${label} has an invalid amount.`;
    if (!validDate(e.paidOn)) return `${label} has an invalid date.`;
    if (!(SPLIT_TYPES as readonly unknown[]).includes(e.splitType)) return `${label} has an unknown split type.`;
    if (e.categoryId != null && (typeof e.categoryId !== 'string' || !categoryIds.has(e.categoryId))) return `${label} has an unknown category.`;
    if (e.note != null && (typeof e.note !== 'string' || e.note.length > EXPENSE_LIMITS.note)) return `${label} has an invalid note.`;
    const tagList = e.tags ?? [];
    if (!Array.isArray(tagList) || tagList.length > EXPENSE_LIMITS.tags || tagList.some((t) => !text(t, EXPENSE_LIMITS.tagName))) return `${label} has invalid tags.`;
    const payers = shares(e.payers, memberIds, e.amountPaise, `${label}: who paid`);
    if (typeof payers === 'string') return payers;
    const splits = shares(e.splits, memberIds, e.amountPaise, `${label}: the split`);
    if (typeof splits === 'string') return splits;
    expenseList.push({
      id: e.id,
      description,
      amountPaise: e.amountPaise,
      splitType: e.splitType as string,
      paidOn: e.paidOn,
      categoryId: (e.categoryId as string | null | undefined) ?? null,
      note: typeof e.note === 'string' && e.note.trim() ? e.note.trim() : null,
      tags: (tagList as string[]).map((t) => t.trim()),
      payers,
      splits,
    });
  }

  if (!Array.isArray(raw.settlements) || raw.settlements.length > IMPORT_LIMITS.settlements) return `A backup can hold at most ${IMPORT_LIMITS.settlements} payments.`;
  const settlementList: ExportFile['settlements'] = [];
  for (const [i, s] of raw.settlements.entries()) {
    const label = `Payment #${i + 1}`;
    if (!isRecord(s) || typeof s.id !== 'string') return `${label} is invalid.`;
    if (typeof s.fromMemberId !== 'string' || typeof s.toMemberId !== 'string' || !memberIds.has(s.fromMemberId) || !memberIds.has(s.toMemberId) || s.fromMemberId === s.toMemberId) {
      return `${label} has invalid people.`;
    }
    if (!isInt(s.amountPaise) || s.amountPaise <= 0 || s.amountPaise > EXPENSE_LIMITS.maxPaise) return `${label} has an invalid amount.`;
    if (!validDate(s.paidOn)) return `${label} has an invalid date.`;
    settlementList.push({ id: s.id, fromMemberId: s.fromMemberId, toMemberId: s.toMemberId, amountPaise: s.amountPaise, paidOn: s.paidOn });
  }

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
    list: { name, currency: 'INR' },
    members: memberList,
    categories: categoryList.length ? categoryList : DEFAULT_CATEGORIES.map((c) => ({ id: c.name, ...c })),
    expenses: expenseList,
    settlements: settlementList,
  };
}

/** D1 allows at most 100 bound parameters per statement, so big inserts are split into chunks. */
function chunks<T>(rows: T[], columns: number): T[][] {
  const per = Math.max(1, Math.floor(90 / columns));
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += per) out.push(rows.slice(i, i + per));
  return out;
}

/** Create a brand new list from a validated backup, atomically. Returns the new list's secret tokens. */
export async function importList(db: Db, file: ExportFile) {
  const listId = newId();
  const editToken = generateToken();
  const viewToken = generateToken();
  const [editTokenHash, viewTokenHash] = await Promise.all([hashToken(editToken), hashToken(viewToken)]);

  const memberMap = new Map(file.members.map((m) => [m.id, newId()]));
  const categoryMap = new Map(file.categories.map((c) => [c.id, newId()]));
  const tagMap = new Map<string, { id: string; name: string }>();
  for (const e of file.expenses) {
    for (const t of e.tags) if (!tagMap.has(t.toLowerCase())) tagMap.set(t.toLowerCase(), { id: newId(), name: t });
  }

  const memberRows = file.members.map((m, i) => ({ id: memberMap.get(m.id)!, listId, name: m.name, color: m.color ?? MEMBER_COLORS[i % MEMBER_COLORS.length] }));
  const categoryRows = file.categories.map((c) => ({ id: categoryMap.get(c.id)!, listId, name: c.name, icon: c.icon }));
  const tagRows = [...tagMap.values()].map((t) => ({ id: t.id, listId, name: t.name }));

  // The list shows newest first by date, then by insertion order, so insert oldest first.
  const ordered = [...file.expenses].reverse();
  const expenseIdMap = new Map(ordered.map((e) => [e.id, newId()]));
  const expenseRows = ordered.map((e) => ({
    id: expenseIdMap.get(e.id)!,
    listId,
    description: e.description,
    amountPaise: e.amountPaise,
    splitType: e.splitType as (typeof SPLIT_TYPES)[number],
    paidOn: e.paidOn,
    categoryId: e.categoryId ? categoryMap.get(e.categoryId)! : null,
    note: e.note,
  }));
  const payerRows = ordered.flatMap((e) => e.payers.map((p) => ({ expenseId: expenseIdMap.get(e.id)!, memberId: memberMap.get(p.memberId)!, amountPaise: p.amountPaise })));
  const splitRows = ordered.flatMap((e) => e.splits.map((s) => ({ expenseId: expenseIdMap.get(e.id)!, memberId: memberMap.get(s.memberId)!, amountPaise: s.amountPaise })));
  const tagLinkRows = ordered.flatMap((e) => e.tags.map((t) => ({ expenseId: expenseIdMap.get(e.id)!, tagId: tagMap.get(t.toLowerCase())!.id })));
  const settlementRows = [...file.settlements].reverse().map((s) => ({
    id: newId(),
    listId,
    fromMemberId: memberMap.get(s.fromMemberId)!,
    toMemberId: memberMap.get(s.toMemberId)!,
    amountPaise: s.amountPaise,
    paidOn: s.paidOn,
  }));

  await db.batch([
    db.insert(lists).values({ id: listId, name: file.list.name, editTokenHash, viewTokenHash, version: 1 }),
    ...chunks(categoryRows, 4).map((c) => db.insert(categories).values(c)),
    ...chunks(memberRows, 5).map((c) => db.insert(members).values(c)),
    ...chunks(tagRows, 4).map((c) => db.insert(tags).values(c)),
    ...chunks(expenseRows, 15).map((c) => db.insert(expenses).values(c)),
    ...chunks(payerRows, 3).map((c) => db.insert(expensePayers).values(c)),
    ...chunks(splitRows, 3).map((c) => db.insert(expenseSplits).values(c)),
    ...chunks(tagLinkRows, 2).map((c) => db.insert(expenseTags).values(c)),
    ...chunks(settlementRows, 8).map((c) => db.insert(settlements).values(c)),
    db.insert(events).values({
      listId,
      version: 1,
      entity: 'list',
      entityId: listId,
      action: 'create',
      afterJson: JSON.stringify({ name: file.list.name, importedExpenses: expenseRows.length, importedPayments: settlementRows.length }),
    }),
  ]);

  return { listId, editToken, viewToken, counts: { members: memberRows.length, expenses: expenseRows.length, payments: settlementRows.length } };
}
