import { and, eq, isNull, or } from 'drizzle-orm';
import type { Db } from './db';
import { error } from './http';
import { checkWriteRate } from './rate-limit';
import { lists, members } from './schema';
import { hashToken } from './tokens';

export type Role = 'edit' | 'view';
export type ListRow = typeof lists.$inferSelect;
export interface Access {
  list: ListRow;
  role: Role;
}

/** Resolve a raw token to its list and role. Returns null for unknown, deleted or archived lists. */
export async function resolveToken(db: Db, token: string): Promise<Access | null> {
  const hash = await hashToken(token);
  const list = await db.query.lists.findFirst({
    where: and(or(eq(lists.editTokenHash, hash), eq(lists.viewTokenHash, hash)), isNull(lists.deletedAt)),
  });
  if (!list) return null;
  return { list, role: list.editTokenHash === hash ? 'edit' : 'view' };
}

/**
 * The member a device says it is acting as (`X-Member-Id`), used only for attribution.
 * Trust-based: it is validated to belong to the list but is not a security boundary.
 */
export async function actorFrom(db: Db, request: Request, listId: string): Promise<string | null> {
  const id = request.headers.get('x-member-id');
  if (!id) return null;
  const member = await db.query.members.findFirst({
    where: and(eq(members.id, id), eq(members.listId, listId), isNull(members.deletedAt)),
  });
  return member ? member.id : null;
}

/**
 * Authenticate an API request from `Authorization: Bearer <token>`.
 * Tokens go in a header, not the URL, so they stay out of access logs.
 */
export async function authenticate(
  db: Db,
  request: Request,
  need: Role = 'view',
): Promise<Access | Response> {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return error(401, 'Missing token');
  const access = await resolveToken(db, token);
  // Same response for unknown and malformed tokens so tokens cannot be probed.
  if (!access) return error(404, 'List not found');
  if (need === 'edit') {
    if (access.role !== 'edit') return error(403, 'This link is read-only');
    const limited = await checkWriteRate(db, access.list.id, access.list.version);
    if (limited) return limited;
  }
  return access;
}
