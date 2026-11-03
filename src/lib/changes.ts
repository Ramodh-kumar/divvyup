import { eq, sql } from 'drizzle-orm';
import type { Db } from './db';
import { events, lists } from './schema';

export interface ChangeEvent {
  listId: string;
  entity: 'list' | 'member' | 'expense' | 'settlement' | 'category' | 'tag';
  entityId: string;
  action: 'create' | 'update' | 'delete' | 'restore';
  actorMemberId?: string | null;
  before?: unknown;
  after?: unknown;
}

/**
 * The two statements every write must append to its D1 batch: bump the list version, then log
 * an event stamped with that new version. D1 runs a batch as one transaction, and the version is
 * read inside the batch, so concurrent writers never share a version number.
 */
export function recordChange(db: Db, change: ChangeEvent) {
  return [
    db
      .update(lists)
      .set({ version: sql`${lists.version} + 1`, lastActiveAt: sql`(unixepoch())` })
      .where(eq(lists.id, change.listId)),
    db.insert(events).values({
      listId: change.listId,
      version: sql`(select version from lists where id = ${change.listId})`,
      entity: change.entity,
      entityId: change.entityId,
      action: change.action,
      actorMemberId: change.actorMemberId ?? null,
      beforeJson: change.before === undefined ? null : JSON.stringify(change.before),
      afterJson: change.after === undefined ? null : JSON.stringify(change.after),
    }),
  ] as const;
}
