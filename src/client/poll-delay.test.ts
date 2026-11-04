import { describe, expect, it } from 'vitest';
import { POLL_MS, pollDelay } from './useListData';

describe('pollDelay', () => {
  it('polls fast right after activity, then backs off as the list stays quiet', () => {
    expect(pollDelay(0)).toBe(POLL_MS);
    expect(pollDelay(9)).toBe(POLL_MS);
    expect(pollDelay(10)).toBe(15_000);
    expect(pollDelay(29)).toBe(15_000);
    expect(pollDelay(30)).toBe(30_000);
    expect(pollDelay(10_000)).toBe(30_000);
  });
  it('never gets slower than 30 seconds, so changes still arrive in a reasonable time', () => {
    for (const n of [0, 5, 10, 20, 30, 100, 5000]) expect(pollDelay(n)).toBeLessThanOrEqual(30_000);
  });
});
