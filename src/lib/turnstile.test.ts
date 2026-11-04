import { describe, expect, it, vi } from 'vitest';

// turnstile.ts imports the Cloudflare runtime through env.ts; stub it so the pure logic runs under Node.
vi.mock('./env', () => ({ getEnv: () => ({}) }));
const { verifyTurnstileToken } = await import('./turnstile');

const respond = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response);

describe('verifyTurnstileToken', () => {
  it('accepts a token Cloudflare confirms', async () => {
    const f = respond({ success: true });
    expect(await verifyTurnstileToken('secret', 'tok', '203.0.113.7', f as any)).toBe('ok');
    const [url, init] = f.mock.calls[0] as unknown as [string, { method: string; body: URLSearchParams }];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(init.method).toBe('POST');
    expect(init.body.get('secret')).toBe('secret');
    expect(init.body.get('response')).toBe('tok');
    expect(init.body.get('remoteip')).toBe('203.0.113.7');
  });

  it('omits remoteip when the IP is unknown', async () => {
    const f = respond({ success: true });
    await verifyTurnstileToken('s', 't', null, f as any);
    expect((f.mock.calls[0] as any)[1].body.has('remoteip')).toBe(false);
  });

  it('rejects a token Cloudflare refuses', async () => {
    expect(await verifyTurnstileToken('s', 't', null, respond({ success: false, 'error-codes': ['invalid-input-response'] }) as any)).toBe('failed');
    expect(await verifyTurnstileToken('s', 't', null, respond({}) as any)).toBe('failed');
    expect(await verifyTurnstileToken('s', 't', null, respond({ success: 'true' }) as any)).toBe('failed');
  });

  it('reports "unavailable" (not "failed") when Cloudflare cannot be reached', async () => {
    expect(await verifyTurnstileToken('s', 't', null, vi.fn(async () => { throw new Error('network'); }) as any)).toBe('unavailable');
    expect(await verifyTurnstileToken('s', 't', null, respond({}, false) as any)).toBe('unavailable');
  });
});
