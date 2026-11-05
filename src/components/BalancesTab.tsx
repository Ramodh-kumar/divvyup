import { useState } from 'react';
import { ApiError, type Api } from '../client/api';
import { formatDate, today } from '../client/format';
import type { Balances, Member, Settlement } from '../client/types';
import { formatINR } from '../lib/money';
import { Avatar, btnSecondary, card, ErrorNote } from './ui';

interface Props {
  balances: Balances;
  settlements: Settlement[];
  members: Member[];
  me: string | null;
  canEdit: boolean;
  api: Api;
  onChanged: () => Promise<void>;
}

/** Avatar above a name, one end of a "who pays whom" arrow. */
function Person({ member, label }: { member: Member | undefined; label: string }) {
  return (
    <span className="flex w-16 shrink-0 flex-col items-center gap-1 text-center">
      <Avatar member={member ?? { name: label, color: null }} size={40} />
      <span className="w-full truncate text-sm font-semibold">{label}</span>
    </span>
  );
}

export default function BalancesTab({ balances, settlements, members, me, canEdit, api, onChanged }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const byId = new Map(members.map((m) => [m.id, m]));
  const name = (id: string) => (id === me ? 'You' : byId.get(id)?.name ?? 'Someone');
  const whom = (id: string) => (id === me ? 'you' : byId.get(id)?.name ?? 'Someone');
  const verb = (id: string) => (id === me ? 'pay' : 'pays');

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await action();
      await onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  const settled = balances.transfers.length === 0;

  return (
    <div className="space-y-6">
      <ErrorNote message={error} />

      <section className={card} aria-labelledby="settle-h">
        <h3 id="settle-h" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Who pays whom
        </h3>
        {settled ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">{balances.totalSpentPaise === 0 && settlements.length === 0 ? 'Nothing to settle yet.' : 'Everyone is settled up. 🎉'}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {balances.transfers.map((t) => {
              const key = `${t.from}>${t.to}`;
              const from = byId.get(t.from);
              const to = byId.get(t.to);
              return (
                <li key={key} className="flex flex-col gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60" aria-label={`${name(t.from)} ${verb(t.from)} ${whom(t.to)} ${formatINR(t.amountPaise)}`}>
                  <div className="flex items-center gap-2">
                    <Person member={from} label={name(t.from)} />
                    <div className="flex min-w-0 flex-1 flex-col items-center">
                      <span className="text-base font-bold tabular-nums">{formatINR(t.amountPaise)}</span>
                      <span className="flex w-full items-center text-slate-400" aria-hidden="true">
                        <span className="h-0.5 flex-1 rounded bg-current" />
                        <svg viewBox="0 0 10 12" className="-ml-1 h-3 w-2.5 fill-current">
                          <path d="M0 0 L10 6 L0 12 Z" />
                        </svg>
                      </span>
                    </div>
                    <Person member={to} label={name(t.to)} />
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      className={btnSecondary}
                      disabled={busy !== null}
                      onClick={() => {
                        if (confirm(`Record that ${name(t.from)} paid ${name(t.to)} ${formatINR(t.amountPaise)}?`)) {
                          run(key, () => api.addSettlement({ fromMemberId: t.from, toMemberId: t.to, amountPaise: t.amountPaise, paidOn: today() }));
                        }
                      }}
                    >
                      {busy === key ? 'Saving…' : 'Mark as paid'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className={card} aria-labelledby="balances-h">
        <h3 id="balances-h" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Balances
        </h3>
        {members.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">Add people in the People tab first.</p>
        ) : (
          <ul className="space-y-3">
            {members.map((m) => {
              const v = balances.balances[m.id] ?? 0;
              return (
                <li key={m.id} className="flex items-center gap-3">
                  <Avatar member={m} />
                  <span className="flex-1 font-medium">{m.id === me ? `${m.name} (you)` : m.name}</span>
                  <span className={`text-sm font-semibold tabular-nums ${v > 0 ? 'text-emerald-600 dark:text-emerald-400' : v < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'}`}>
                    {v === 0 ? 'settled up' : v > 0 ? `gets back ${formatINR(v)}` : `owes ${formatINR(-v)}`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {settlements.length > 0 && (
        <section aria-labelledby="payments-h">
          <h3 id="payments-h" className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Payments recorded
          </h3>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
            {settlements.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span>
                  <strong>{name(s.fromMemberId)}</strong> paid <strong>{name(s.toMemberId)}</strong> <span className="tabular-nums">{formatINR(s.amountPaise)}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">{formatDate(s.paidOn)}</span>
                </span>
                {canEdit && (
                  <button
                    type="button"
                    className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-rose-600 dark:hover:bg-slate-800"
                    disabled={busy !== null}
                    onClick={() => {
                      if (confirm('Undo this recorded payment?')) run(s.id, () => api.deleteSettlement(s.id));
                    }}
                  >
                    {busy === s.id ? 'Undoing…' : 'Undo'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
