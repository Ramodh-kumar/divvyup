import type { APIRoute } from 'astro';
import { getDb } from '../../lib/db';
import { error, json } from '../../lib/http';
import { IMPORT_LIMITS, importList, parseImport } from '../../lib/import';
import { checkCreateRate } from '../../lib/rate-limit';
import { checkTurnstile } from '../../lib/turnstile';

// POST /api/import  <a DivvyUp JSON backup>
// Always creates a NEW list (never merges into an existing one) and returns its tokens, like POST /api/lists.
export const POST: APIRoute = async ({ request }) => {
  const db = getDb();
  const limited = await checkCreateRate(db, request);
  if (limited) return limited;
  const unverified = await checkTurnstile(request);
  if (unverified) return unverified;

  const raw = await request.text();
  if (raw.length > IMPORT_LIMITS.bytes) return error(413, 'This file is too large to import.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return error(400, 'This file is not valid JSON.');
  }
  const file = parseImport(parsed);
  if (typeof file === 'string') return error(400, file);

  const result = await importList(db, file);
  return json(
    {
      editToken: result.editToken,
      viewToken: result.viewToken,
      editPath: `/l/${result.editToken}`,
      viewPath: `/l/${result.viewToken}`,
      imported: result.counts,
    },
    201,
  );
};
