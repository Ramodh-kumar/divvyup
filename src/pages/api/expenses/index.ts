import type { APIRoute } from 'astro';
import { actorFrom, authenticate } from '../../../lib/auth';
import { getDb } from '../../../lib/db';
import { parseExpenseInput } from '../../../lib/expense-input';
import { createExpense, loadContext, loadExpenses } from '../../../lib/expenses';
import { error, fail, json, readJson } from '../../../lib/http';

// GET /api/expenses -> live expenses, newest first
export const GET: APIRoute = async ({ request }) => {
  const db = getDb();
  const access = await authenticate(db, request);
  if (access instanceof Response) return access;
  return json({ expenses: await loadExpenses(db, access.list.id) });
};

// POST /api/expenses
// { description, amountPaise, paidOn, paidBy | payers[], split: { type, memberIds | entries }, categoryId?, note?, tags? }
export const POST: APIRoute = async ({ request }) => {
  const db = getDb();
  const access = await authenticate(db, request, 'edit');
  if (access instanceof Response) return access;

  const body = await readJson(request);
  if (!body) return error(400, 'Expected a JSON object');
  const parsed = parseExpenseInput(body, await loadContext(db, access.list.id));
  if ('status' in parsed) return fail(parsed);

  const actor = await actorFrom(db, request, access.list.id);
  return json(await createExpense(db, access.list.id, actor, parsed), 201);
};
