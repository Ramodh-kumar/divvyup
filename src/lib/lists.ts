import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from './db';
import { categories, events, lists, members } from './schema';
import { generateToken, hashToken, newId } from './tokens';

export const DEFAULT_CATEGORIES: { name: string; icon: string }[] = [
  { name: 'Food', icon: '🍽️' },
  { name: 'Groceries', icon: '🛒' },
  { name: 'Transport', icon: '🚕' },
  { name: 'Travel', icon: '✈️' },
  { name: 'Stay', icon: '🏨' },
  { name: 'Entertainment', icon: '🎬' },
  { name: 'Bills', icon: '💡' },
  { name: 'Shopping', icon: '🛍️' },
  { name: 'Other', icon: '📦' },
];

export const MEMBER_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

export const LIMITS = { listName: 80, memberName: 40, members: 50 } as const;

export interface CreateListInput {
  name: string;
  memberNames: string[];
}

/** Validate and normalise create-list input. Returns an error message or the clean input. */
export function parseCreateList(body: Record<string, unknown>): CreateListInput | string {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > LIMITS.listName) return `List name must be 1-${LIMITS.listName} characters`;

  const raw = body.members ?? [];
  if (!Array.isArray(raw) || raw.some((m) => typeof m !== 'string')) return 'members must be a list of names';
  const memberNames = (raw as string[]).map((m) => m.trim()).filter(Boolean);
  if (memberNames.length > LIMITS.members) return `At most ${LIMITS.members} members`;
  if (memberNames.some((m) => m.length > LIMITS.memberName)) return `Member names must be at most ${LIMITS.memberName} characters`;
  const lower = memberNames.map((m) => m.toLowerCase());
  if (new Set(lower).size !== lower.length) return 'Member names must be unique';

  return { name, memberNames };
}

/** Create a list with seeded categories and members. Returns the raw tokens (shown to the user once). */
export async function createList(db: Db, input: CreateListInput) {
  const listId = newId();
  const editToken = generateToken();
  const viewToken = generateToken();
  const [editTokenHash, viewTokenHash] = await Promise.all([hashToken(editToken), hashToken(viewToken)]);

  const memberRows = input.memberNames.map((name, i) => ({
    id: newId(),
    listId,
    name,
    color: MEMBER_COLORS[i % MEMBER_COLORS.length],
  }));

  await db.batch([
    db.insert(lists).values({ id: listId, name: input.name, editTokenHash, viewTokenHash, version: 1 }),
    db.insert(categories).values(DEFAULT_CATEGORIES.map((c) => ({ id: newId(), listId, ...c }))),
    ...(memberRows.length ? [db.insert(members).values(memberRows)] : []),
    db.insert(events).values({
      listId,
      version: 1,
      entity: 'list',
      entityId: listId,
      action: 'create',
      afterJson: JSON.stringify({ name: input.name }),
    }),
  ]);

  return { listId, editToken, viewToken, members: memberRows.map(({ id, name }) => ({ id, name })) };
}

/** Everything the client needs to render a list, minus secrets. */
export async function getSnapshot(db: Db, listId: string) {
  const list = await db.query.lists.findFirst({ where: eq(lists.id, listId) });
  if (!list) return null;
  const [memberRows, categoryRows] = await Promise.all([
    db.select().from(members).where(and(eq(members.listId, listId), isNull(members.deletedAt))).orderBy(sql`rowid`),
    db.select().from(categories).where(and(eq(categories.listId, listId), isNull(categories.deletedAt))),
  ]);
  return {
    list: {
      id: list.id,
      name: list.name,
      currency: list.currency,
      version: list.version,
      createdAt: list.createdAt,
      archivedAt: list.archivedAt,
    },
    members: memberRows.map(({ id, name, color }) => ({ id, name, color })),
    categories: categoryRows.map(({ id, name, icon }) => ({ id, name, icon })),
  };
}
