import { and, eq, isNull, sql } from 'drizzle-orm';
import { recordChange } from './changes';
import type { Db } from './db';
import { LIMITS, MEMBER_COLORS } from './lists';
import { members } from './schema';
import { newId } from './tokens';

export type Failure = { status: number; message: string };
export type MemberView = { id: string; name: string; color: string | null };

const COLOR = /^#[0-9a-f]{6}$/i;

export function parseName(value: unknown): string | Failure {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > LIMITS.memberName) {
    return { status: 400, message: `Name must be 1-${LIMITS.memberName} characters` };
  }
  return name;
}

export function parseColor(value: unknown): string | null | Failure {
  if (value === null) return null;
  if (typeof value === 'string' && COLOR.test(value)) return value.toLowerCase();
  return { status: 400, message: 'color must be a hex value like #3b82f6' };
}

async function activeMembers(db: Db, listId: string) {
  return db.select().from(members).where(and(eq(members.listId, listId), isNull(members.deletedAt)));
}

const view = (m: { id: string; name: string; color: string | null }): MemberView => ({
  id: m.id,
  name: m.name,
  color: m.color,
});

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export async function addMember(db: Db, listId: string, actor: string | null, name: string): Promise<MemberView | Failure> {
  const current = await activeMembers(db, listId);
  if (current.length >= LIMITS.members) return { status: 409, message: `A list can have at most ${LIMITS.members} members` };
  if (current.some((m) => sameName(m.name, name))) return { status: 409, message: 'A member with that name already exists' };

  const row = { id: newId(), listId, name, color: MEMBER_COLORS[current.length % MEMBER_COLORS.length] };
  await db.batch([
    db.insert(members).values(row),
    ...recordChange(db, { listId, entity: 'member', entityId: row.id, action: 'create', actorMemberId: actor, after: view(row) }),
  ]);
  return view(row);
}

export async function updateMember(
  db: Db,
  listId: string,
  actor: string | null,
  id: string,
  patch: { name?: string; color?: string | null },
): Promise<MemberView | Failure> {
  const current = await activeMembers(db, listId);
  const existing = current.find((m) => m.id === id);
  if (!existing) return { status: 404, message: 'Member not found' };
  if (patch.name !== undefined && current.some((m) => m.id !== id && sameName(m.name, patch.name!))) {
    return { status: 409, message: 'A member with that name already exists' };
  }

  const next = { ...existing, ...patch };
  await db.batch([
    db.update(members).set({ name: next.name, color: next.color }).where(and(eq(members.id, id), eq(members.listId, listId))),
    ...recordChange(db, { listId, entity: 'member', entityId: id, action: 'update', actorMemberId: actor, before: view(existing), after: view(next) }),
  ]);
  return view(next);
}

/** Number of live expenses and settlements that still involve this member. */
async function usageCount(db: Db, id: string): Promise<number> {
  const row = await db.get<{ n: number }>(sql`select (
    (select count(*) from expense_payers p join expenses e on e.id = p.expense_id where p.member_id = ${id} and e.deleted_at is null) +
    (select count(*) from expense_splits s join expenses e on e.id = s.expense_id where s.member_id = ${id} and e.deleted_at is null) +
    (select count(*) from settlements t where (t.from_member_id = ${id} or t.to_member_id = ${id}) and t.deleted_at is null)
  ) as n`);
  return row?.n ?? 0;
}

/** Soft delete. Refused while the member still appears in expenses or settlements, since that would corrupt balances. */
export async function removeMember(db: Db, listId: string, actor: string | null, id: string): Promise<true | Failure> {
  const existing = (await activeMembers(db, listId)).find((m) => m.id === id);
  if (!existing) return { status: 404, message: 'Member not found' };
  if ((await usageCount(db, id)) > 0) {
    return { status: 409, message: 'This member is part of existing expenses or settlements. Remove those first.' };
  }
  await db.batch([
    db.update(members).set({ deletedAt: sql`(unixepoch())` }).where(and(eq(members.id, id), eq(members.listId, listId))),
    ...recordChange(db, { listId, entity: 'member', entityId: id, action: 'delete', actorMemberId: actor, before: view(existing) }),
  ]);
  return true;
}
