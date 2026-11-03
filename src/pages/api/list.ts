import type { APIRoute } from 'astro';
import { authenticate } from '../../lib/auth';
import { getDb } from '../../lib/db';
import { error, json } from '../../lib/http';
import { getSnapshot } from '../../lib/lists';

// GET /api/list  (Authorization: Bearer <token>)  -> list, members, categories and the caller's role
export const GET: APIRoute = async ({ request }) => {
  const db = getDb();
  const access = await authenticate(db, request);
  if (access instanceof Response) return access;

  const snapshot = await getSnapshot(db, access.list.id);
  if (!snapshot) return error(404, 'List not found');
  return json({ ...snapshot, role: access.role });
};
