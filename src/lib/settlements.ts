import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { recordChange } from './changes';
import type { Db } from './db';
import { EXPENSE_LIMITS, validDate } from './expense-input';
import type { Failure } from './http';
import { settlements } from './schema';
import { newId } from './tokens';

export interface SettlementView {
  id: string;
  fromMemberId: string;
  toMemberId: string;
  amountPaise: number;
  paidOn: string;
  createdBy: string | null;
  createdAt: number;
  deletedAt: number | null; // only set for items read from the trash
}

export interface ParsedSettlement {
  fromMemberId: string;
  toMemberId: string;
  amountPaise: number;
  paidOn: string;
}

const bad = (message: string): Failure => ({ status: 400, message });

/** Validate a "from paid to" request. Pure: the valid member ids are passed in. */
export function parseSettlementInput(body: Record<string, unknown>, memberIds: Set<string>): ParsedSettlement | Failure {
  const { fromMemberId, toMemberId, amountPaise, paidOn } = body;
  if (typeof fromMemberId !== 'string' || typeof toMemberId !== 'string') return bad('fromMemberId and toMemberId are required');
  if (!memberIds.has(fromMemberId) || !memberIds.has(toMemberId)) return bad('Both people must be members of this list');
  if (fromMemberId === toMemberId) return bad('A person cannot pay themselves');
  if (!Number.isSafeInteger(amountPaise) || (amountPaise as number) <= 0 || (amountPaise as number) > EXPENSE_LIMITS.maxPaise) {
    return bad('amountPaise must be a positive whole number of paise');
  }
  if (!validDate(paidOn)) return bad('paidOn must be a real date like 2026-11-03');
  return { fromMemberId, toMemberId, amountPaise: amountPaise as number, paidOn };
}

/** Live payments, newest first. With `deleted: true` it reads the trash instead. */
export async function loadSettlements(db: Db, listId: string, deleted = false): Promise<SettlementView[]> {
  const rows = await db
    .select()
    .from(settlements)
    .where(and(eq(settlements.listId, listId), deleted ? isNotNull(settlements.deletedAt) : isNull(settlements.deletedAt)))
    .orderBy(desc(settlements.paidOn), sql`rowid desc`);
  return rows.map(({ id, fromMemberId, toMemberId, amountPaise, paidOn, createdBy, createdAt, deletedAt }) => ({
    id,
    fromMemberId,
    toMemberId,
    amountPaise,
    paidOn,
    createdBy,
    createdAt,
    deletedAt,
  }));
}

export async function createSettlement(db: Db, listId: string, actor: string | null, p: ParsedSettlement): Promise<SettlementView> {
  const id = newId();
  await db.batch([
    db.insert(settlements).values({ id, listId, ...p, createdBy: actor }),
    ...recordChange(db, { listId, entity: 'settlement', entityId: id, action: 'create', actorMemberId: actor, after: { id, ...p } }),
  ]);
  const created = (await loadSettlements(db, listId)).find((s) => s.id === id);
  return created!;
}

/** Settlements are not edited: delete and re-add keeps the history simple and the audit log honest. */
export async function deleteSettlement(db: Db, listId: string, actor: string | null, id: string): Promise<true | Failure> {
  const before = (await loadSettlements(db, listId)).find((s) => s.id === id);
  if (!before) return { status: 404, message: 'Settlement not found' };
  await db.batch([
    db.update(settlements).set({ deletedAt: sql`(unixepoch())` }).where(and(eq(settlements.id, id), eq(settlements.listId, listId))),
    ...recordChange(db, { listId, entity: 'settlement', entityId: id, action: 'delete', actorMemberId: actor, before }),
  ]);
  return true;
}
