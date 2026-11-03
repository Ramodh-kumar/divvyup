import { describe, expect, it } from 'vitest';
import { formatDate, timeAgo } from './format';

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
const ago = (seconds: number) => timeAgo(Math.floor(NOW / 1000) - seconds, NOW);

describe('timeAgo', () => {
  it('words recent times', () => {
    expect(ago(5)).toBe('just now');
    expect(ago(59)).toBe('just now');
    expect(ago(60)).toBe('1 minute ago');
    expect(ago(5 * 60)).toBe('5 minutes ago');
    expect(ago(3600)).toBe('1 hour ago');
    expect(ago(7 * 3600)).toBe('7 hours ago');
    expect(ago(86400)).toBe('1 day ago');
    expect(ago(45 * 86400)).toBe('45 days ago');
  });
  it('never goes negative for clock skew', () => {
    expect(timeAgo(Math.floor(NOW / 1000) + 500, NOW)).toBe('just now');
  });
});

describe('formatDate', () => {
  it('formats a plain date without time zone drift', () => {
    expect(formatDate('2026-11-03')).toBe('3 Nov 2026');
    expect(formatDate('2026-01-01')).toBe('1 Jan 2026');
  });
});
