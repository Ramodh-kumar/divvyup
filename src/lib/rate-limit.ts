import { and, eq, lt, sql } from 'drizzle-orm';
import type { Db } from './db';
import { error } from './http';
import { events, rateLimits } from './schema';
import { hashToken } from './tokens';

export const LIMITS_CONFIG = {
  /** New lists per IP per hour. */
  createPerHour: 10,
  /** Writes to one list within any 60 second span. */
  writesPerMinute: 120,
} as const;

function tooMany(retryAfter: number): Response {
  const res = error(429, 'Too many requests. Please slow down.');
  res.headers.set('retry-after', String(Math.max(1, retryAfter)));
  return res;
}

/**
 * Limit how fast one list can be written to, without any extra D1 writes: every write bumps the
 * list version and logs one event, so if the event `limit` versions ago is under a minute old,
 * there were `limit` writes in under a minute.
 */
export async function checkWriteRate(db: Db, listId: string, currentVersion: number): Promise<Response | null> {
  const back = currentVersion - LIMITS_CONFIG.writesPerMinute;
  if (back < 1) return null;
  const row = await db
    .select({ at: events.at })
    .from(events)
    .where(and(eq(events.listId, listId), eq(events.version, back)))
    .limit(1);
  if (!row[0]) return null;
  const age = Math.floor(Date.now() / 1000) - row[0].at;
  return age < 60 ? tooMany(60 - age) : null;
}

/** Count one hit in the current fixed window and report whether it is over the limit. */
async function hit(db: Db, key: string, windowSeconds: number, limit: number): Promise<number | null> {
  const now = Math.floor(Date.now() / 1000);
  const window = now - (now % windowSeconds);
  const [row] = await db
    .insert(rateLimits)
    .values({ key, window, count: 1 })
    .onConflictDoUpdate({ target: [rateLimits.key, rateLimits.window], set: { count: sql`${rateLimits.count} + 1` } })
    .returning({ count: rateLimits.count });
  // Old windows are useless; sweep them occasionally instead of needing a scheduled job.
  if (Math.random() < 0.02) await db.delete(rateLimits).where(lt(rateLimits.window, now - 2 * 86400));
  return row.count > limit ? window + windowSeconds - now : null;
}

/**
 * Limit list creation per client IP. Cloudflare always sets CF-Connecting-IP in production; with no
 * header (local dev) the check is skipped. IPs are hashed so raw addresses are never stored.
 */
export async function checkCreateRate(db: Db, request: Request): Promise<Response | null> {
  const ip = request.headers.get('cf-connecting-ip');
  if (!ip) return null;
  const retryAfter = await hit(db, `create:${(await hashToken(ip)).slice(0, 32)}`, 3600, LIMITS_CONFIG.createPerHour);
  return retryAfter === null ? null : tooMany(retryAfter);
}
