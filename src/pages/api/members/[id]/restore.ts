import type { APIRoute } from 'astro';
import { actorFrom, authenticate } from '../../../../lib/auth';
import { getDb } from '../../../../lib/db';
import { fail, json } from '../../../../lib/http';
import { restoreMember } from '../../../../lib/trash';

// POST /api/members/:id/restore
export const POST: APIRoute = async ({ request, params }) => {
  const db = getDb();
  const access = await authenticate(db, request, 'edit');
  if (access instanceof Response) return access;
  const result = await restoreMember(db, access.list.id, await actorFrom(db, request, access.list.id), params.id!);
  return 'status' in result ? fail(result) : json({ ok: true });
};
