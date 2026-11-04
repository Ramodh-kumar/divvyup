import type { Balances, ChangesResponse, Expense, Member, Settlement, Snapshot, Trash } from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(
  method: string,
  path: string,
  opts: { token?: string; actor?: string | null; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.actor) headers['x-member-id'] = opts.actor;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  } catch {
    throw new ApiError(0, 'You appear to be offline. Check your connection and try again.');
  }
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data);
  return data as T;
}

export interface CreatedList {
  editToken: string;
  viewToken: string;
  members: { id: string; name: string }[];
}

/** `captcha` is a Turnstile token; the server only requires it once Turnstile is configured. */
export const createList = (name: string, members: string[], captcha?: string | null) =>
  request<CreatedList>('POST', '/api/lists', { body: { name, members }, headers: captcha ? { 'x-turnstile-token': captcha } : undefined });

export interface ImportedList {
  editToken: string;
  viewToken: string;
  imported: { members: number; expenses: number; payments: number };
}

/** Send the text of a DivvyUp JSON backup; it always becomes a brand new list. */
export async function importBackup(json: string, captcha?: string | null): Promise<ImportedList> {
  let res: Response;
  try {
    res = await fetch('/api/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(captcha ? { 'x-turnstile-token': captcha } : {}) },
      body: json,
    });
  } catch {
    throw new ApiError(0, 'You appear to be offline. Check your connection and try again.');
  }
  const data = (await res.json().catch(() => null)) as (ImportedList & { error?: string }) | null;
  if (!res.ok || !data) throw new ApiError(res.status, data?.error ?? `Import failed (${res.status})`);
  return data;
}

/** API bound to one list's token. `getActor` supplies the "I am" member for attribution on writes. */
export function createApi(token: string, getActor: () => string | null) {
  const call = <T>(method: string, path: string, body?: unknown) =>
    request<T>(method, path, { token, actor: getActor(), body });
  return {
    snapshot: () => call<Snapshot>('GET', '/api/list'),
    expenses: () => call<{ expenses: Expense[] }>('GET', '/api/expenses').then((r) => r.expenses),
    settlements: () => call<{ settlements: Settlement[] }>('GET', '/api/settlements').then((r) => r.settlements),
    balances: () => call<Balances>('GET', '/api/balances'),
    changes: (since: number) => call<ChangesResponse>('GET', `/api/changes?since=${since}`),
    createExpense: (body: Record<string, unknown>) => call<Expense>('POST', '/api/expenses', body),
    replaceExpense: (id: string, body: Record<string, unknown>) => call<Expense>('PUT', `/api/expenses/${id}`, body),
    deleteExpense: (id: string, revision: number) => call<{ ok: true }>('DELETE', `/api/expenses/${id}?revision=${revision}`),
    trash: () => call<Trash>('GET', '/api/trash'),
    restoreExpense: (id: string) => call<{ ok: true }>('POST', `/api/expenses/${id}/restore`),
    restoreSettlement: (id: string) => call<{ ok: true }>('POST', `/api/settlements/${id}/restore`),
    restoreMember: (id: string) => call<{ ok: true }>('POST', `/api/members/${id}/restore`),
    /** Download a backup. Sent with the Bearer header (not a link), so the token never appears in a URL. */
    exportFile: async (format: 'json' | 'csv'): Promise<{ blob: Blob; filename: string }> => {
      const headers: Record<string, string> = { authorization: `Bearer ${token}` };
      const res = await fetch(`/api/export?format=${format}`, { headers }).catch(() => {
        throw new ApiError(0, 'You appear to be offline. Check your connection and try again.');
      });
      if (!res.ok) throw new ApiError(res.status, ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'Export failed');
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `divvyup.${format}`;
      return { blob: await res.blob(), filename: name };
    },
    addMember: (name: string) => call<Member>('POST', '/api/members', { name }),
    removeMember: (id: string) => call<{ ok: true }>('DELETE', `/api/members/${id}`),
    addSettlement: (s: { fromMemberId: string; toMemberId: string; amountPaise: number; paidOn: string }) =>
      call<Settlement>('POST', '/api/settlements', s),
    deleteSettlement: (id: string) => call<{ ok: true }>('DELETE', `/api/settlements/${id}`),
  };
}

export type Api = ReturnType<typeof createApi>;
