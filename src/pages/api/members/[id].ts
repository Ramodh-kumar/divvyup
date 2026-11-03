import type { APIRoute } from 'astro';
import { actorFrom, authenticate } from '../../../lib/auth';
import { getDb } from '../../../lib/db';
import { error, json, readJson } from '../../../lib/http';
import { parseColor, parseName, removeMember, updateMember } from '../../../lib/members';

// PATCH /api/members/:id  { name?, color? }
export const PATCH: APIRoute = async ({ request, params }) => {
  const db = getDb();
  const access = await authenticate(db, request, 'edit');
  if (access instanceof Response) return access;

  const body = await readJson(request);
  if (!body) return error(400, 'Expected a JSON object');
  const patch: { name?: string; color?: string | null } = {};
  if ('name' in body) {
    const name = parseName(body.name);
    if (typeof name !== 'string') return error(name.status, name.message);
    patch.name = name;
  }
  if ('color' in body) {
    const color = parseColor(body.color);
    if (color !== null && typeof color !== 'string') return error(color.status, color.message);
    patch.color = color;
  }
  if (Object.keys(patch).length === 0) return error(400, 'Nothing to update');

  const actor = await actorFrom(db, request, access.list.id);
  const result = await updateMember(db, access.list.id, actor, params.id!, patch);
  return 'status' in result ? error(result.status, result.message) : json(result);
};

// DELETE /api/members/:id  (soft delete; refused while the member is in expenses or settlements)
export const DELETE: APIRoute = async ({ request, params }) => {
  const db = getDb();
  const access = await authenticate(db, request, 'edit');
  if (access instanceof Response) return access;

  const actor = await actorFrom(db, request, access.list.id);
  const result = await removeMember(db, access.list.id, actor, params.id!);
  return result === true ? json({ ok: true }) : error(result.status, result.message);
};
