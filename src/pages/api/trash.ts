import type { APIRoute } from 'astro';
import { authenticate } from '../../lib/auth';
import { getDb } from '../../lib/db';
import { json } from '../../lib/http';
import { listTrash } from '../../lib/trash';

// GET /api/trash -> what was deleted and can still be restored (also permanently removes anything past retention)
export const GET: APIRoute = async ({ request }) => {
  const db = getDb();
  const access = await authenticate(db, request, 'edit');
  if (access instanceof Response) return access;
  return json(await listTrash(db, access.list.id));
};
