/** "2026-11-03" -> "3 Nov 2026". Parsed as a plain date so time zones cannot shift it. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Today's date in the user's own time zone as YYYY-MM-DD. */
export const today = () => new Date().toLocaleDateString('en-CA');

/** "3 days ago", from a unix timestamp in seconds. */
export function timeAgo(unixSeconds: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor(now / 1000) - unixSeconds);
  if (s < 60) return 'just now';
  const units: [number, string][] = [[86400, 'day'], [3600, 'hour'], [60, 'minute']];
  for (const [size, name] of units) {
    if (s >= size) {
      const n = Math.floor(s / size);
      return `${n} ${name}${n === 1 ? '' : 's'} ago`;
    }
  }
  return 'just now';
}

/** Save a Blob as a file, using a temporary link. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const listUrl =(token: string) => `${location.origin}/l/${token}`;

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
