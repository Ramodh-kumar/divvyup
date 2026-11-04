import { drizzle } from 'drizzle-orm/d1';
import { getEnv } from './env';
import * as schema from './schema';

export function getDb() {
  return drizzle(getEnv().DB, { schema });
}

export type Db = ReturnType<typeof getDb>;
