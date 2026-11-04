import { env } from 'cloudflare:workers';

/** Bindings and variables configured in wrangler.jsonc, the dashboard, or `.dev.vars` locally. */
export interface AppEnv {
  DB: D1Database;
  /** Turnstile secret key (set with `wrangler secret put`). When absent, the CAPTCHA check is off. */
  TURNSTILE_SECRET?: string;
  /** Turnstile public site key, shown to the browser. When absent, no widget is rendered. */
  TURNSTILE_SITE_KEY?: string;
}

export const getEnv = () => env as unknown as AppEnv;
