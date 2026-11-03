import type { APIRoute } from 'astro';
import { actorFrom, authenticate } from '../../../lib/auth';
import { getDb } from '../../../lib/db';
import { fail, json } from '../../../lib/http';
import { deleteSettlement } from '../../../lib/settlements';

// DELETE /api/settlements/:id  (soft delete)
export const DELETE: APIRoute = async ({ request, params }) => {
  const db = getDb();
  const access = await authenticate(db, request, 'edit');
  if (access instanceof Response) return access;

  const actor = await actorFrom(db, request, access.list.id);
  const result = await deleteSettlement(db, access.list.id, actor, params.id!);
  return result === true ? json({ ok: true }) : fail(result);
};
