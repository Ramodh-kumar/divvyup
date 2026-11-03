import type { APIRoute } from 'astro';
import { authenticate } from '../../lib/auth';
import { getDb } from '../../lib/db';
import { buildExport, fileStem, toCsv } from '../../lib/export';
import { error } from '../../lib/http';

// GET /api/export?format=json|csv  -> a file download of everything live in the list.
// Works with a view-only link too: reading is all it takes to take a copy.
export const GET: APIRoute = async ({ request, url }) => {
  const db = getDb();
  const access = await authenticate(db, request);
  if (access instanceof Response) return access;

  const format = url.searchParams.get('format') ?? 'json';
  if (format !== 'json' && format !== 'csv') return error(400, 'format must be json or csv');

  const file = await buildExport(db, access.list.id);
  if (!file) return error(404, 'List not found');

  const stem = `${fileStem(file.list.name)}-${file.exportedAt.slice(0, 10)}`;
  const body = format === 'json' ? JSON.stringify(file, null, 2) : toCsv(file);
  return new Response(body, {
    headers: {
      'content-type': format === 'json' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${stem}.${format}"`,
      'cache-control': 'no-store',
    },
  });
};
