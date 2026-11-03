import type { APIRoute } from 'astro';
import { actorFrom, authenticate } from '../../../lib/auth';
import { getDb } from '../../../lib/db';
import { loadContext } from '../../../lib/expenses';
import { error, fail, json, readJson } from '../../../lib/http';
import { createSettlement, loadSettlements, parseSettlementInput } from '../../../lib/settlements';

// GET /api/settlements
export const GET: APIRoute = async ({ request }) => {
  const db = getDb();
  const access = await authenticate(db, request);
  if (access instanceof Response) return access;
  return json({ settlements: await loadSettlements(db, access.list.id) });
};

// POST /api/settlements  { fromMemberId, toMemberId, amountPaise, paidOn }   ("from paid to")
export const POST: APIRoute = async ({ request }) => {
  const db = getDb();
  const access = await authenticate(db, request, 'edit');
  if (access instanceof Response) return access;

  const body = await readJson(request);
  if (!body) return error(400, 'Expected a JSON object');
  const { memberIds } = await loadContext(db, access.list.id);
  const parsed = parseSettlementInput(body, memberIds);
  if ('status' in parsed) return fail(parsed);

  const actor = await actorFrom(db, request, access.list.id);
  return json(await createSettlement(db, access.list.id, actor, parsed), 201);
};
