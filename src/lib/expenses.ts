import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { recordChange } from './changes';
import type { Db } from './db';
import type { ExpenseContext, ParsedExpense } from './expense-input';
import type { Failure } from './http';
import { categories, expensePayers, expenses, expenseSplits, expenseTags, lists, members, tags } from './schema';
import type { SplitShare } from './splits';
import { newId } from './tokens';

export interface ExpenseView {
  id: string;
  description: string;
  amountPaise: number;
  splitType: string;
  paidOn: string;
  categoryId: string | null;
  note: string | null;
  revision: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: number;
  updatedAt: number;
  payers: SplitShare[];
  splits: SplitShare[];
  tags: string[];
}

export async function loadContext(db: Db, listId: string): Promise<ExpenseContext> {
  const [m, c] = await Promise.all([
    db.select({ id: members.id }).from(members).where(and(eq(members.listId, listId), isNull(members.deletedAt))),
    db.select({ id: categories.id }).from(categories).where(and(eq(categories.listId, listId), isNull(categories.deletedAt))),
  ]);
  return { memberIds: new Set(m.map((r) => r.id)), categoryIds: new Set(c.map((r) => r.id)) };
}

/** Live expenses of a list (newest first) with payers, splits and tag names. Optionally just one. */
export async function loadExpenses(db: Db, listId: string, onlyId?: string): Promise<ExpenseView[]> {
  const scope = and(eq(expenses.listId, listId), isNull(expenses.deletedAt), onlyId ? eq(expenses.id, onlyId) : undefined);
  const [rows, payerRows, splitRows, tagRows] = await Promise.all([
    db.select().from(expenses).where(scope).orderBy(desc(expenses.paidOn), sql`rowid desc`),
    db.select({ expenseId: expensePayers.expenseId, memberId: expensePayers.memberId, amountPaise: expensePayers.amountPaise })
      .from(expensePayers).innerJoin(expenses, eq(expenses.id, expensePayers.expenseId)).where(scope),
    db.select({ expenseId: expenseSplits.expenseId, memberId: expenseSplits.memberId, amountPaise: expenseSplits.amountPaise })
      .from(expenseSplits).innerJoin(expenses, eq(expenses.id, expenseSplits.expenseId)).where(scope),
    db.select({ expenseId: expenseTags.expenseId, name: tags.name })
      .from(expenseTags).innerJoin(tags, eq(tags.id, expenseTags.tagId)).innerJoin(expenses, eq(expenses.id, expenseTags.expenseId)).where(scope),
  ]);

  const group = <T extends { expenseId: string }>(xs: T[]) => {
    const map = new Map<string, T[]>();
    for (const x of xs) map.set(x.expenseId, [...(map.get(x.expenseId) ?? []), x]);
    return map;
  };
  const payersBy = group(payerRows);
  const splitsBy = group(splitRows);
  const tagsBy = group(tagRows);

  return rows.map((e) => ({
    id: e.id,
    description: e.description,
    amountPaise: e.amountPaise,
    splitType: e.splitType,
    paidOn: e.paidOn,
    categoryId: e.categoryId,
    note: e.note,
    revision: e.revision,
    createdBy: e.createdBy,
    updatedBy: e.updatedBy,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    payers: (payersBy.get(e.id) ?? []).map(({ memberId, amountPaise }) => ({ memberId, amountPaise })),
    splits: (splitsBy.get(e.id) ?? []).map(({ memberId, amountPaise }) => ({ memberId, amountPaise })),
    tags: (tagsBy.get(e.id) ?? []).map((t) => t.name).sort(),
  }));
}

/** Snapshot stored in the event log, built from the validated input. */
const afterOf = (id: string, p: ParsedExpense) => ({
  id,
  description: p.description,
  amountPaise: p.amountPaise,
  splitType: p.splitType,
  paidOn: p.paidOn,
  categoryId: p.categoryId,
  note: p.note,
  payers: p.payers,
  splits: p.splits,
  tags: p.tagNames,
});

/** Map tag names to ids for this list, planning inserts for names that do not exist yet. */
async function planTags(db: Db, listId: string, names: string[]) {
  const existing = await db.select().from(tags).where(and(eq(tags.listId, listId), isNull(tags.deletedAt)));
  const byLower = new Map(existing.map((t) => [t.name.toLowerCase(), t.id]));
  const created: { id: string; listId: string; name: string }[] = [];
  const ids = names.map((name) => {
    let id = byLower.get(name.toLowerCase());
    if (!id) {
      id = newId();
      created.push({ id, listId, name });
    }
    return id;
  });
  return { ids, created };
}

/** Statements that write an expense's payers, splits and tags. Shared by create and replace. */
async function childStatements(db: Db, listId: string, id: string, p: ParsedExpense) {
  const { ids: tagIds, created } = await planTags(db, listId, p.tagNames);
  return [
    db.insert(expensePayers).values(p.payers.map((x) => ({ expenseId: id, ...x }))),
    db.insert(expenseSplits).values(p.splits.map((x) => ({ expenseId: id, ...x }))),
    ...(created.length ? [db.insert(tags).values(created)] : []),
    ...(tagIds.length ? [db.insert(expenseTags).values(tagIds.map((tagId) => ({ expenseId: id, tagId })))] : []),
  ];
}

export async function createExpense(db: Db, listId: string, actor: string | null, p: ParsedExpense): Promise<ExpenseView> {
  const id = newId();
  const children = await childStatements(db, listId, id, p);
  await db.batch([
    db.insert(expenses).values({
      id,
      listId,
      description: p.description,
      amountPaise: p.amountPaise,
      splitType: p.splitType,
      paidOn: p.paidOn,
      categoryId: p.categoryId,
      note: p.note,
      createdBy: actor,
      updatedBy: actor,
    }),
    ...children,
    ...recordChange(db, { listId, entity: 'expense', entityId: id, action: 'create', actorMemberId: actor, after: afterOf(id, p) }),
  ]);
  const [view] = await loadExpenses(db, listId, id);
  return view;
}

/**
 * Fails the whole D1 batch (rolling it back) unless the expense is still at `revision`.
 * Doing the check inside the batch closes the window between "read revision" and "write".
 * abs(min int64) raises "integer overflow" in SQLite, which aborts the transaction.
 */
const revisionGuard = (db: Db, listId: string, id: string, revision: number) =>
  db
    .select({
      // Anchored on the list row (always present) so a missing/deleted expense also aborts: NULL = n is not true.
      ok: sql<number>`case when (select revision from expenses where id = ${id} and deleted_at is null) = ${revision}
        then 1 else abs(-9223372036854775808) end`,
    })
    .from(lists)
    .where(eq(lists.id, listId));

async function conflictOrRethrow(db: Db, listId: string, id: string, revision: number, err: unknown): Promise<Failure> {
  const [now] = await loadExpenses(db, listId, id);
  if (!now) return { status: 404, message: 'Expense not found' };
  if (now.revision !== revision) {
    return { status: 409, message: 'This expense was changed by someone else', current: now };
  }
  throw err;
}

export async function replaceExpense(
  db: Db,
  listId: string,
  actor: string | null,
  id: string,
  revision: number,
  p: ParsedExpense,
): Promise<ExpenseView | Failure> {
  const [before] = await loadExpenses(db, listId, id);
  if (!before) return { status: 404, message: 'Expense not found' };
  if (before.revision !== revision) {
    return { status: 409, message: 'This expense was changed by someone else', current: before };
  }

  const children = await childStatements(db, listId, id, p);
  try {
    await db.batch([
      revisionGuard(db, listId, id, revision),
      db.update(expenses).set({
        description: p.description,
        amountPaise: p.amountPaise,
        splitType: p.splitType,
        paidOn: p.paidOn,
        categoryId: p.categoryId,
        note: p.note,
        revision: sql`${expenses.revision} + 1`,
        updatedBy: actor,
        updatedAt: sql`(unixepoch())`,
      }).where(eq(expenses.id, id)),
      db.delete(expensePayers).where(eq(expensePayers.expenseId, id)),
      db.delete(expenseSplits).where(eq(expenseSplits.expenseId, id)),
      db.delete(expenseTags).where(eq(expenseTags.expenseId, id)),
      ...children,
      ...recordChange(db, { listId, entity: 'expense', entityId: id, action: 'update', actorMemberId: actor, before, after: afterOf(id, p) }),
    ]);
  } catch (err) {
    return conflictOrRethrow(db, listId, id, revision, err);
  }
  const [view] = await loadExpenses(db, listId, id);
  return view;
}

export async function deleteExpense(
  db: Db,
  listId: string,
  actor: string | null,
  id: string,
  revision?: number,
): Promise<true | Failure> {
  const [before] = await loadExpenses(db, listId, id);
  if (!before) return { status: 404, message: 'Expense not found' };
  if (revision !== undefined && before.revision !== revision) {
    return { status: 409, message: 'This expense was changed by someone else', current: before };
  }
  try {
    await db.batch([
      revisionGuard(db, listId, id, before.revision),
      db.update(expenses).set({
        deletedAt: sql`(unixepoch())`,
        revision: sql`${expenses.revision} + 1`,
        updatedBy: actor,
        updatedAt: sql`(unixepoch())`,
      }).where(eq(expenses.id, id)),
      ...recordChange(db, { listId, entity: 'expense', entityId: id, action: 'delete', actorMemberId: actor, before }),
    ]);
  } catch (err) {
    return conflictOrRethrow(db, listId, id, before.revision, err);
  }
  return true;
}
