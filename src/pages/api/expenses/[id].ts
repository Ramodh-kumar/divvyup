import type { APIRoute } from 'astro';
import { actorFrom, authenticate } from '../../../lib/auth';
import { getDb } from '../../../lib/db';
import { parseExpenseInput } from '../../../lib/expense-input';
import { deleteExpense, loadContext, replaceExpense } from '../../../lib/expenses';
import { error, fail, json, readJson } from '../../../lib/http';

// PUT /api/expenses/:id  same body as POST plus `revision` (the revision the client started from).
// A stale revision returns 409 with the server's current copy in `current`.
export const PUT: APIRoute = async ({ request, params }) => {
  const db = getDb();
  const access = await authenticate(db, request, 'edit');
  if (access instanceof Response) return access;

  const body = await readJson(request);
  if (!body) return error(400, 'Expected a JSON object');
  if (!Number.isSafeInteger(body.revision)) return error(400, 'revision is required');
  const parsed = parseExpenseInput(body, await loadContext(db, access.list.id));
  if ('status' in parsed) return fail(parsed);

  const actor = await actorFrom(db, request, access.list.id);
  const result = await replaceExpense(db, access.list.id, actor, params.id!, body.revision as number, parsed);
  return 'status' in result ? fail(result) : json(result);
};

// DELETE /api/expenses/:id?revision=N   (soft delete; revision optional but recommended)
export const DELETE: APIRoute = async ({ request, params, url }) => {
  const db = getDb();
  const access = await authenticate(db, request, 'edit');
  if (access instanceof Response) return access;

  const rev = url.searchParams.get('revision');
  const revision = rev === null ? undefined : Number(rev);
  if (revision !== undefined && !Number.isSafeInteger(revision)) return error(400, 'revision must be a whole number');

  const actor = await actorFrom(db, request, access.list.id);
  const result = await deleteExpense(db, access.list.id, actor, params.id!, revision);
  return result === true ? json({ ok: true }) : fail(result);
};
