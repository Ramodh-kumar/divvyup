import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, createApi } from './api';
import type { Balances, Expense, Settlement, Snapshot } from './types';

export interface ListData {
  snapshot: Snapshot;
  expenses: Expense[];
  settlements: Settlement[];
  balances: Balances;
}

export type Status = 'loading' | 'ready' | 'notfound' | 'error';

/** Loads everything a list screen needs. `reload` refetches all of it (used after every write). */
export function useListData(token: string, getActor: () => string | null) {
  // getActor reads a ref, so the api object can stay stable for the life of the token.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const api = useMemo(() => createApi(token, getActor), [token]);
  const [data, setData] = useState<ListData | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [snapshot, expenses, settlements, balances] = await Promise.all([
        api.snapshot(),
        api.expenses(),
        api.settlements(),
        api.balances(),
      ]);
      setData({ snapshot, expenses, settlements, balances });
      setStatus('ready');
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 401)) setStatus('notfound');
      else {
        setStatus((s) => (s === 'ready' ? 'ready' : 'error'));
        setError(e instanceof Error ? e.message : 'Could not load this list');
      }
    }
  }, [api]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { api, data, status, error, reload };
}
