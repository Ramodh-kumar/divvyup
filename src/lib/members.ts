import { and, eq, isNull, sql } from 'drizzle-orm';
import { recordChange } from './changes';
import type { Db } from './db';
import type { Failure } from './http';
import { LIMITS, MEMBER_COLORS } from './lists';
import { members } from './schema';
import { newId } from './tokens';

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

/** Live expenses and payments that still involve this member, as short labels (descriptions / "Payment on <date>"). */
async function usageLabels(db: Db, id: string): Promise<string[]> {
  const rows = await db.all<{ label: string }>(sql`
    select e.description as label, e.paid_on as d from expenses e
      where e.deleted_at is null and (
        exists (select 1 from expense_payers p where p.expense_id = e.id and p.member_id = ${id}) or
        exists (select 1 from expense_splits s where s.expense_id = e.id and s.member_id = ${id}))
    union all
    select 'Payment on ' || t.paid_on as label, t.paid_on as d from settlements t
      where t.deleted_at is null and (t.from_member_id = ${id} or t.to_member_id = ${id})
    order by d desc`);
  return rows.map((r) => r.label);
}

/** Soft delete. Refused while the member still appears in expenses or settlements, since that would corrupt balances. */
export async function removeMember(db: Db, listId: string, actor: string | null, id: string): Promise<true | Failure> {
  const existing = (await activeMembers(db, listId)).find((m) => m.id === id);
  if (!existing) return { status: 404, message: 'Member not found' };
  const used = await usageLabels(db, id);
  if (used.length > 0) {
    const shown = used.slice(0, 5).join(', ');
    const more = used.length > 5 ? ` and ${used.length - 5} more` : '';
    return {
      status: 409,
      message: `${existing.name} can't be removed yet: they are part of ${shown}${more}. Delete or edit ${used.length === 1 ? 'it' : 'those'} first (deleted items go to More > Recently deleted).`,
    };
  }
  await db.batch([
    db.update(members).set({ deletedAt: sql`(unixepoch())` }).where(and(eq(members.id, id), eq(members.listId, listId))),
    ...recordChange(db, { listId, entity: 'member', entityId: id, action: 'delete', actorMemberId: actor, before: view(existing) }),
  ]);
  return true;
}
