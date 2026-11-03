import { and, eq, isNull, or } from 'drizzle-orm';
import type { Db } from './db';
import { error } from './http';
import { lists } from './schema';
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
  if (need === 'edit' && access.role !== 'edit') return error(403, 'This link is read-only');
  return access;
}
