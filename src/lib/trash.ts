import { and, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { recordChange } from './changes';
import type { Db } from './db';
import { loadContext, loadExpenses } from './expenses';
import type { Failure } from './http';
import { expensePayers, expenses, expenseSplits, expenseTags, members, settlements } from './schema';
import { loadSettlements } from './settlements';

/** How long deleted expenses and payments can be restored before they are permanently removed. */
export const TRASH_RETENTION_DAYS = 90;

/**
 * Permanently remove expenses and payments deleted more than TRASH_RETENTION_DAYS ago (with their
 * payers/splits/tags). People are kept: they are tiny and other history still points at them.
 * There is no scheduled job on Cloudflare Pages, so this runs when the trash is opened and now and then on writes.
 */
export async function purgeExpired(db: Db, listId: string) {
  const cutoff = Math.floor(Date.now() / 1000) - TRASH_RETENTION_DAYS * 86400;
  const expiredIds = db
    .select({ id: expenses.id })
    .from(expenses)
    .where(and(eq(expenses.listId, listId), lt(expenses.deletedAt, cutoff)));
  await db.batch([
    db.delete(expensePayers).where(inArray(expensePayers.expenseId, expiredIds)),
    db.delete(expenseSplits).where(inArray(expenseSplits.expenseId, expiredIds)),
    db.delete(expenseTags).where(inArray(expenseTags.expenseId, expiredIds)),
    db.delete(expenses).where(and(eq(expenses.listId, listId), lt(expenses.deletedAt, cutoff))),
    db.delete(settlements).where(and(eq(settlements.listId, listId), lt(settlements.deletedAt, cutoff))),
  ]);
}

/** Everything that was deleted and can still be restored, most recently deleted first. */
export async function listTrash(db: Db, listId: string) {
  await purgeExpired(db, listId);
  const [trashedExpenses, trashedSettlements, trashedMembers] = await Promise.all([
    loadExpenses(db, listId, undefined, true),
    loadSettlements(db, listId, true),
    db
      .select({ id: members.id, name: members.name, color: members.color, deletedAt: members.deletedAt })
      .from(members)
      .where(and(eq(members.listId, listId), isNotNull(members.deletedAt))),
  ]);
  const newest = (a: { deletedAt: number | null }, b: { deletedAt: number | null }) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0);
  return {
    retentionDays: TRASH_RETENTION_DAYS,
    expenses: trashedExpenses.sort(newest),
    settlements: trashedSettlements.sort(newest),
    members: trashedMembers.sort(newest),
  };
}

async function namesOf(db: Db, listId: string, ids: string[]): Promise<string> {
  const rows = await db.select({ name: members.name }).from(members).where(and(eq(members.listId, listId), inArray(members.id, ids)));
  return rows.map((r) => r.name).join(', ');
}

/** Bring a deleted expense back. Refused while anyone it involves has been removed from the list. */
export async function restoreExpense(db: Db, listId: string, actor: string | null, id: string): Promise<Failure | { id: string }> {
  const [e] = await loadExpenses(db, listId, id, true);
  if (!e) return { status: 404, message: 'Nothing to restore: this expense is not in the trash' };

  const { memberIds } = await loadContext(db, listId);
  const missing = [...new Set([...e.payers, ...e.splits].map((s) => s.memberId))].filter((m) => !memberIds.has(m));
  if (missing.length) {
    return { status: 409, message: `Restore ${await namesOf(db, listId, missing)} first. They were removed from this list.` };
  }

  await db.batch([
    db
      .update(expenses)
      .set({ deletedAt: null, revision: sql`${expenses.revision} + 1`, updatedBy: actor, updatedAt: sql`(unixepoch())` })
      .where(and(eq(expenses.id, id), eq(expenses.listId, listId), isNotNull(expenses.deletedAt))),
    ...recordChange(db, { listId, entity: 'expense', entityId: id, action: 'restore', actorMemberId: actor, after: { id, description: e.description, amountPaise: e.amountPaise } }),
  ]);
  return { id };
}

export async function restoreSettlement(db: Db, listId: string, actor: string | null, id: string): Promise<Failure | { id: string }> {
  const s = (await loadSettlements(db, listId, true)).find((x) => x.id === id);
  if (!s) return { status: 404, message: 'Nothing to restore: this payment is not in the trash' };

  const { memberIds } = await loadContext(db, listId);
  const missing = [s.fromMemberId, s.toMemberId].filter((m) => !memberIds.has(m));
  if (missing.length) {
    return { status: 409, message: `Restore ${await namesOf(db, listId, missing)} first. They were removed from this list.` };
  }

  await db.batch([
    db.update(settlements).set({ deletedAt: null }).where(and(eq(settlements.id, id), eq(settlements.listId, listId), isNotNull(settlements.deletedAt))),
    ...recordChange(db, { listId, entity: 'settlement', entityId: id, action: 'restore', actorMemberId: actor, after: { id, amountPaise: s.amountPaise } }),
  ]);
  return { id };
}

export async function restoreMember(db: Db, listId: string, actor: string | null, id: string): Promise<Failure | { id: string }> {
  const m = await db.query.members.findFirst({ where: and(eq(members.id, id), eq(members.listId, listId), isNotNull(members.deletedAt)) });
  if (!m) return { status: 404, message: 'Nothing to restore: this person is not in the trash' };

  const active = await db.select({ name: members.name }).from(members).where(and(eq(members.listId, listId), isNull(members.deletedAt)));
  if (active.some((a) => a.name.toLowerCase() === m.name.toLowerCase())) {
    return { status: 409, message: `Someone named ${m.name} is already in this list.` };
  }

  await db.batch([
    db.update(members).set({ deletedAt: null }).where(and(eq(members.id, id), eq(members.listId, listId))),
    ...recordChange(db, { listId, entity: 'member', entityId: id, action: 'restore', actorMemberId: actor, after: { id, name: m.name } }),
  ]);
  return { id };
}
