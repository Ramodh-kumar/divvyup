import type { Balances, Expense, Member, Settlement, Snapshot } from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, opts: { token?: string; actor?: string | null; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
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

export const createList = (name: string, members: string[]) =>
  request<CreatedList>('POST', '/api/lists', { body: { name, members } });

/** API bound to one list's token. `getActor` supplies the "I am" member for attribution on writes. */
export function createApi(token: string, getActor: () => string | null) {
  const call = <T>(method: string, path: string, body?: unknown) =>
    request<T>(method, path, { token, actor: getActor(), body });
  return {
    snapshot: () => call<Snapshot>('GET', '/api/list'),
    expenses: () => call<{ expenses: Expense[] }>('GET', '/api/expenses').then((r) => r.expenses),
    settlements: () => call<{ settlements: Settlement[] }>('GET', '/api/settlements').then((r) => r.settlements),
    balances: () => call<Balances>('GET', '/api/balances'),
    createExpense: (body: Record<string, unknown>) => call<Expense>('POST', '/api/expenses', body),
    replaceExpense: (id: string, body: Record<string, unknown>) => call<Expense>('PUT', `/api/expenses/${id}`, body),
    deleteExpense: (id: string, revision: number) => call<{ ok: true }>('DELETE', `/api/expenses/${id}?revision=${revision}`),
    addMember: (name: string) => call<Member>('POST', '/api/members', { name }),
    removeMember: (id: string) => call<{ ok: true }>('DELETE', `/api/members/${id}`),
    addSettlement: (s: { fromMemberId: string; toMemberId: string; amountPaise: number; paidOn: string }) =>
      call<Settlement>('POST', '/api/settlements', s),
    deleteSettlement: (id: string) => call<{ ok: true }>('DELETE', `/api/settlements/${id}`),
  };
}

export type Api = ReturnType<typeof createApi>;
