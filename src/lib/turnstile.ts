import { getEnv } from './env';
import { error } from './http';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type Verdict = 'ok' | 'failed' | 'unavailable';

/**
 * Ask Cloudflare whether a Turnstile token is genuine. Tokens are single use and expire after a few
 * minutes, so every call needs a fresh one. `fetchFn` is injectable so this can be unit tested offline.
 */
export async function verifyTurnstileToken(
  secret: string,
  token: string,
  ip: string | null,
  fetchFn: typeof fetch = fetch,
): Promise<Verdict> {
  const form = new URLSearchParams({ secret, response: token });
  if (ip) form.set('remoteip', ip);
  try {
    const res = await fetchFn(VERIFY_URL, { method: 'POST', body: form });
    if (!res.ok) return 'unavailable';
    const data = (await res.json()) as { success?: boolean };
    return data.success === true ? 'ok' : 'failed';
  } catch {
    return 'unavailable';
  }
}

/**
 * Guard for endpoints that create lists. If TURNSTILE_SECRET is not configured the check is off (so the
 * app works before Turnstile is set up and in local dev); once it is set, a valid token is required in
 * the `x-turnstile-token` header. Returns an error response to send, or null to carry on.
 */
export async function checkTurnstile(request: Request, fetchFn: typeof fetch = fetch): Promise<Response | null> {
  const secret = getEnv().TURNSTILE_SECRET;
  if (!secret) return null;

  const token = request.headers.get('x-turnstile-token');
  if (!token) return error(400, 'Please complete the security check and try again.');

  const verdict = await verifyTurnstileToken(secret, token, request.headers.get('cf-connecting-ip'), fetchFn);
  if (verdict === 'failed') return error(403, 'The security check failed. Please try again.');
  if (verdict === 'unavailable') return error(503, 'Could not run the security check right now. Please try again in a moment.');
  return null;
}
