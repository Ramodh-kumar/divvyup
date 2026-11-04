import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, createApi } from './api';
import type { Balances, Change, Expense, Settlement, Snapshot } from './types';

export interface ListData {
  snapshot: Snapshot;
  expenses: Expense[];
  settlements: Settlement[];
  balances: Balances;
}

export type Status = 'loading' | 'ready' | 'notfound' | 'error';

/**
 * How often to ask the server "anything new?" while the tab is visible. An idle poll is one cheap request,
 * but the free Cloudflare plan allows 100,000 Worker requests a day, so a quiet list backs off:
 * fast right after activity or when you come back to the tab, then slower the longer nothing changes.
 */
export const POLL_MS = 8_000;
const MAX_BACKOFF_MS = 60_000;

/** Delay before the next poll given how many polls in a row found nothing new. */
export function pollDelay(quietPolls: number): number {
  if (quietPolls < 10) return POLL_MS; // ~80s of fast polling after activity
  if (quietPolls < 30) return 15_000; // then ~5 min at 15s
  return 30_000; // then settle at 30s
}

/**
 * Loads everything a list screen needs and keeps it fresh.
 * - `reload` refetches all of it (called after every write).
 * - While the tab is visible it polls /api/changes; if the list version moved it reloads and calls
 *   `onRemoteChange` with what changed. Polling pauses in background tabs and resumes on focus/reconnect.
 */
export function useListData(token: string, getActor: () => string | null, onRemoteChange?: (changes: Change[]) => void) {
  // getActor reads a ref, so the api object can stay stable for the life of the token.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const api = useMemo(() => createApi(token, getActor), [token]);
  const [data, setData] = useState<ListData | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);

  const version = useRef(0); // last list version we have applied
  const started = useRef(0); // sequence number of the newest reload we began
  const remoteCb = useRef(onRemoteChange);
  remoteCb.current = onRemoteChange;

  const reload = useCallback(async () => {
    const mine = ++started.current;
    try {
      const [snapshot, expenses, settlements, balances] = await Promise.all([
        api.snapshot(),
        api.expenses(),
        api.settlements(),
        api.balances(),
      ]);
      // A newer reload started while this one was in flight; its result wins, so drop this one.
      if (mine !== started.current) return;
      version.current = snapshot.list.version;
      setData({ snapshot, expenses, settlements, balances });
      setStatus('ready');
      setError(null);
      setOnline(true);
    } catch (e) {
      if (mine !== started.current) return;
      if (e instanceof ApiError && (e.status === 404 || e.status === 401)) setStatus('notfound');
      else {
        setStatus((s) => (s === 'ready' ? 'ready' : 'error'));
        setError(e instanceof Error ? e.message : 'Could not load this list');
        if (e instanceof ApiError && e.status === 0) setOnline(false);
      }
    }
  }, [api]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (status !== 'ready') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = POLL_MS;
    let quiet = 0; // consecutive polls that found nothing new
    let stopped = false;
    let inFlight = false;

    const schedule = () => {
      clearTimeout(timer);
      if (!stopped && !document.hidden) timer = setTimeout(tick, delay);
    };

    async function tick() {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const r = await api.changes(version.current);
        setOnline(true);
        if (r.changed) {
          quiet = 0;
          await reload();
          remoteCb.current?.(r.events);
        } else {
          quiet++;
        }
        delay = pollDelay(quiet);
      } catch (e) {
        if (e instanceof ApiError && (e.status === 404 || e.status === 401)) {
          setStatus('notfound');
          return;
        }
        setOnline(false);
        delay = Math.min(delay * 2, MAX_BACKOFF_MS);
      } finally {
        inFlight = false;
        schedule();
      }
    }

    // Catch up right away when the user comes back to the tab or the network returns.
    const wake = () => {
      if (document.hidden) return;
      clearTimeout(timer);
      quiet = 0;
      delay = POLL_MS;
      tick();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    schedule();

    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
    };
  }, [status, api, reload]);

  return { api, data, status, error, online, reload };
}
