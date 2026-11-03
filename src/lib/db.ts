import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export function getDb() {
  return drizzle((env as unknown as { DB: D1Database }).DB, { schema });
}

export type Db = ReturnType<typeof getDb>;
