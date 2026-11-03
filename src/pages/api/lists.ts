import type { APIRoute } from 'astro';
import { getDb } from '../../lib/db';
import { error, json, readJson } from '../../lib/http';
import { createList, parseCreateList } from '../../lib/lists';
import { checkCreateRate } from '../../lib/rate-limit';

// POST /api/lists  { name, members?: string[] }
// Returns the secret edit/view tokens once. Only their hashes are stored.
export const POST: APIRoute = async ({ request }) => {
  const db = getDb();
  const limited = await checkCreateRate(db, request);
  if (limited) return limited;

  const body = await readJson(request);
  if (!body) return error(400, 'Expected a JSON object');
  const input = parseCreateList(body);
  if (typeof input === 'string') return error(400, input);

  const result = await createList(db, input);
  return json(
    {
      editToken: result.editToken,
      viewToken: result.viewToken,
      editPath: `/l/${result.editToken}`,
      viewPath: `/l/${result.viewToken}`,
      members: result.members,
    },
    201,
  );
};
