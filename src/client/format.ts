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

export const listUrl = (token: string) => `${location.origin}/l/${token}`;

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
