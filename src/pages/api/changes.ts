import type { APIRoute } from 'astro';
import { and, asc, eq, gt } from 'drizzle-orm';
import { authenticate } from '../../lib/auth';
import { getDb } from '../../lib/db';
import { error, json } from '../../lib/http';
import { events } from '../../lib/schema';

const PAGE = 200;

// GET /api/changes?since=<version>
// Clients poll this with the last version they saw. If nothing changed it is a single cheap response.
// `events` lists what changed (newest last); if `hasMore` is true the client is too far behind and
// should refetch everything instead of replaying.
export const GET: APIRoute = async ({ request, url }) => {
  const db = getDb();
  const access = await authenticate(db, request);
  if (access instanceof Response) return access;

  const since = Number(url.searchParams.get('since'));
  if (!Number.isSafeInteger(since) || since < 0) return error(400, 'since must be a whole number');

  const version = access.list.version;
  if (since >= version) return json({ version, changed: false, events: [], hasMore: false });

  const rows = await db
    .select({
      version: events.version,
      entity: events.entity,
      entityId: events.entityId,
      action: events.action,
      actorMemberId: events.actorMemberId,
      at: events.at,
    })
    .from(events)
    .where(and(eq(events.listId, access.list.id), gt(events.version, since)))
    .orderBy(asc(events.version))
    .limit(PAGE + 1);

  return json({ version, changed: true, events: rows.slice(0, PAGE), hasMore: rows.length > PAGE });
};
