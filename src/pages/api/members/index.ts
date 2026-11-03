import type { APIRoute } from 'astro';
import { actorFrom, authenticate } from '../../../lib/auth';
import { getDb } from '../../../lib/db';
import { error, json, readJson } from '../../../lib/http';
import { addMember, parseName } from '../../../lib/members';

// POST /api/members  { name }
export const POST: APIRoute = async ({ request }) => {
  const db = getDb();
  const access = await authenticate(db, request, 'edit');
  if (access instanceof Response) return access;

  const body = await readJson(request);
  if (!body) return error(400, 'Expected a JSON object');
  const name = parseName(body.name);
  if (typeof name !== 'string') return error(name.status, name.message);

  const actor = await actorFrom(db, request, access.list.id);
  const result = await addMember(db, access.list.id, actor, name);
  return 'status' in result ? error(result.status, result.message) : json(result, 201);
};
