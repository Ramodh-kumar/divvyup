import { useCallback, useEffect, useState } from 'react';
import { ApiError, type Api } from '../client/api';
import { downloadBlob, timeAgo } from '../client/format';
import type { Member, Trash } from '../client/types';
import { formatINR } from '../lib/money';
import { btnSecondary, card, ErrorNote } from './ui';

interface Props {
  api: Api;
  members: Member[];
  canEdit: boolean;
  /** Reload the main list after something is restored. */
  onChanged: () => Promise<void>;
}

const message = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');

function Backup({ api }: { api: Api }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(format: 'json' | 'csv') {
    setBusy(format);
    setError(null);
    try {
      const { blob, filename } = await api.exportFile(format);
      downloadBlob(blob, filename);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={`${card} space-y-3`} aria-labelledby="backup-h">
      <h3 id="backup-h" className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Back up your data
      </h3>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        <strong>JSON</strong> is a complete backup you can import back into DivvyUp. <strong>CSV</strong> opens in Excel or Google Sheets.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnSecondary} disabled={busy !== null} onClick={() => download('json')}>
          {busy === 'json' ? 'Preparing…' : 'Download backup (JSON)'}
        </button>
        <button type="button" className={btnSecondary} disabled={busy !== null} onClick={() => download('csv')}>
          {busy === 'csv' ? 'Preparing…' : 'Download spreadsheet (CSV)'}
        </button>
      </div>
      <ErrorNote message={error} />
    </section>
  );
}

function RecentlyDeleted({ api, members, onChanged }: Omit<Props, 'canEdit'>) {
  const [trash, setTrash] = useState<Trash | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTrash(await api.trash());
    } catch (e) {
      setError(message(e));
    }
  }, [api]);
  useEffect(() => {
    load();
  }, [load]);

  async function restore(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await action();
      await onChanged();
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }

  // Deleted people may still be named in deleted expenses, so look names up among them too.
  const name = (id: string) => members.find((m) => m.id === id)?.name ?? trash?.members.find((m) => m.id === id)?.name ?? 'Someone';
  const total = trash ? trash.expenses.length + trash.settlements.length + trash.members.length : 0;

  const Row = ({ id, title, detail, onRestore }: { id: string; title: string; detail: string; onRestore: () => Promise<unknown> }) => (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate font-medium">{title}</p>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">{detail}</p>
      </div>
      <button type="button" className={btnSecondary} disabled={busy !== null} onClick={() => restore(id, onRestore)} aria-label={`Restore ${title}`}>
        {busy === id ? 'Restoring…' : 'Restore'}
      </button>
    </li>
  );

  return (
    <section aria-labelledby="deleted-h" className="space-y-3">
      <div>
        <h3 id="deleted-h" className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Recently deleted
        </h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Deleted expenses and payments can be restored for {trash?.retentionDays ?? 90} days, then they are removed for good.
        </p>
      </div>
      <ErrorNote message={error} />
      {!trash ? (
        !error && <p className="text-sm text-slate-500" role="status">Loading…</p>
      ) : total === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">Nothing deleted recently.</p>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
          {trash.expenses.map((e) => (
            <Row key={e.id} id={e.id} title={e.description} detail={`Expense · ${formatINR(e.amountPaise)} · deleted ${timeAgo(e.deletedAt ?? 0)}`} onRestore={() => api.restoreExpense(e.id)} />
          ))}
          {trash.settlements.map((s) => (
            <Row key={s.id} id={s.id} title={`${name(s.fromMemberId)} paid ${name(s.toMemberId)}`} detail={`Payment · ${formatINR(s.amountPaise)} · deleted ${timeAgo(s.deletedAt ?? 0)}`} onRestore={() => api.restoreSettlement(s.id)} />
          ))}
          {trash.members.map((m) => (
            <Row key={m.id} id={m.id} title={m.name} detail={`Person · removed ${timeAgo(m.deletedAt)}`} onRestore={() => api.restoreMember(m.id)} />
          ))}
        </ul>
      )}
    </section>
  );
}

export default function MoreTab({ api, members, canEdit, onChanged }: Props) {
  return (
    <div className="space-y-6">
      <Backup api={api} />
      {canEdit && <RecentlyDeleted api={api} members={members} onChanged={onChanged} />}
    </div>
  );
}
