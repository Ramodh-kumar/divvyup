import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// All money columns are integer paise (INR minor units). Timestamps are unix epoch seconds.
const now = sql`(unixepoch())`;

export const lists = sqliteTable('lists', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  currency: text('currency').notNull().default('INR'),
  // SHA-256 hex of the secret tokens; the raw tokens are only ever in the share URL.
  editTokenHash: text('edit_token_hash').notNull().unique(),
  viewTokenHash: text('view_token_hash').unique(),
  // Bumped on every write; clients poll for changes since a version.
  version: integer('version').notNull().default(0),
  createdAt: integer('created_at').notNull().default(now),
  lastActiveAt: integer('last_active_at').notNull().default(now),
  archivedAt: integer('archived_at'),
  deletedAt: integer('deleted_at'),
});

export const members = sqliteTable(
  'members',
  {
    id: text('id').primaryKey(),
    listId: text('list_id').notNull().references(() => lists.id),
    name: text('name').notNull(),
    color: text('color'),
    createdAt: integer('created_at').notNull().default(now),
    deletedAt: integer('deleted_at'),
  },
  (t) => [index('members_list_idx').on(t.listId)],
);

export const categories = sqliteTable(
  'categories',
  {
    id: text('id').primaryKey(),
    listId: text('list_id').notNull().references(() => lists.id),
    name: text('name').notNull(),
    icon: text('icon'),
    deletedAt: integer('deleted_at'),
  },
  (t) => [index('categories_list_idx').on(t.listId)],
);

export const tags = sqliteTable(
  'tags',
  {
    id: text('id').primaryKey(),
    listId: text('list_id').notNull().references(() => lists.id),
    name: text('name').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [index('tags_list_idx').on(t.listId)],
);

export const SPLIT_TYPES = ['equal', 'exact', 'percent', 'shares'] as const;
export type SplitType = (typeof SPLIT_TYPES)[number];

export const expenses = sqliteTable(
  'expenses',
  {
    id: text('id').primaryKey(),
    listId: text('list_id').notNull().references(() => lists.id),
    description: text('description').notNull(),
    amountPaise: integer('amount_paise').notNull(),
    // Metadata only, used to re-open the editor; resolved amounts live in expense_splits.
    splitType: text('split_type', { enum: SPLIT_TYPES }).notNull().default('equal'),
    paidOn: text('paid_on').notNull(), // YYYY-MM-DD
    categoryId: text('category_id').references(() => categories.id),
    note: text('note'),
    // Optimistic concurrency: an edit must send the revision it started from.
    revision: integer('revision').notNull().default(1),
    createdBy: text('created_by').references(() => members.id),
    updatedBy: text('updated_by').references(() => members.id),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
    deletedAt: integer('deleted_at'),
  },
  (t) => [index('expenses_list_date_idx').on(t.listId, t.paidOn)],
);

// Who paid (supports multiple payers). Sum must equal expenses.amount_paise.
export const expensePayers = sqliteTable(
  'expense_payers',
  {
    expenseId: text('expense_id').notNull().references(() => expenses.id),
    memberId: text('member_id').notNull().references(() => members.id),
    amountPaise: integer('amount_paise').notNull(),
  },
  (t) => [primaryKey({ columns: [t.expenseId, t.memberId] })],
);

// Who owes (resolved amounts after rounding). Sum must equal expenses.amount_paise.
export const expenseSplits = sqliteTable(
  'expense_splits',
  {
    expenseId: text('expense_id').notNull().references(() => expenses.id),
    memberId: text('member_id').notNull().references(() => members.id),
    amountPaise: integer('amount_paise').notNull(),
  },
  (t) => [primaryKey({ columns: [t.expenseId, t.memberId] })],
);

export const expenseTags = sqliteTable(
  'expense_tags',
  {
    expenseId: text('expense_id').notNull().references(() => expenses.id),
    tagId: text('tag_id').notNull().references(() => tags.id),
  },
  (t) => [primaryKey({ columns: [t.expenseId, t.tagId] })],
);

// A recorded payment from one member to another that reduces what is owed.
export const settlements = sqliteTable(
  'settlements',
  {
    id: text('id').primaryKey(),
    listId: text('list_id').notNull().references(() => lists.id),
    fromMemberId: text('from_member_id').notNull().references(() => members.id),
    toMemberId: text('to_member_id').notNull().references(() => members.id),
    amountPaise: integer('amount_paise').notNull(),
    paidOn: text('paid_on').notNull(),
    createdBy: text('created_by').references(() => members.id),
    createdAt: integer('created_at').notNull().default(now),
    deletedAt: integer('deleted_at'),
  },
  (t) => [index('settlements_list_idx').on(t.listId)],
);

// Fixed-window counters for abuse limits. `key` is "<scope>:<hashed ip>"; `window` is the window start (unix seconds).
export const rateLimits = sqliteTable(
  'rate_limits',
  {
    key: text('key').notNull(),
    window: integer('window').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.window] })],
);

// Append-only audit log: powers the activity feed, undo and the changes feed.
export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    listId: text('list_id').notNull().references(() => lists.id),
    version: integer('version').notNull(), // list version after this change
    entity: text('entity').notNull(), // expense | member | settlement | category | tag | list
    entityId: text('entity_id').notNull(),
    action: text('action').notNull(), // create | update | delete | restore
    actorMemberId: text('actor_member_id').references(() => members.id),
    beforeJson: text('before_json'),
    afterJson: text('after_json'),
    at: integer('at').notNull().default(now),
  },
  (t) => [index('events_list_version_idx').on(t.listId, t.version)],
);
