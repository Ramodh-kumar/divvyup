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
              // Who this person pays, or who pays them, from the suggested settle-up transfers.
              const hints = [
                ...balances.transfers.filter((t) => t.from === m.id).map((t) => `${m.id === me ? 'Pay' : 'Pays'} ${whom(t.to)} ${formatINR(t.amountPaise)}`),
                ...balances.transfers.filter((t) => t.to === m.id).map((t) => `Gets ${formatINR(t.amountPaise)} from ${name(t.from)}`),
              ];
              return (
                <li key={m.id} className="flex items-center gap-3">
                  <Avatar member={m} />
                  <span className="flex-1">
                    <span className="block font-medium">{m.id === me ? `${m.name} (you)` : m.name}</span>
                    {hints.map((h) => (
                      <span key={h} className="block text-xs text-slate-500 dark:text-slate-400">
                        {h}
                      </span>
                    ))}
                  </span>
                  <span className={`text-sm font-semibold tabular-nums ${v > 0 ? 'text-emerald-600 dark:text-emerald-400' : v < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'}`}>
                    {v === 0 ? 'settled up' : v > 0 ? `gets back ${formatINR(v)}` : `owes ${formatINR(-v)}`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className={card} aria-labelledby="settle-h">
        <h3 id="settle-h" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Settle up
        </h3>
        {settled ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">{balances.totalSpentPaise === 0 && settlements.length === 0 ? 'Nothing to settle yet.' : 'Everyone is settled up. 🎉'}</p>
        ) : (
          <ul className="space-y-3">
            {balances.transfers.map((t) => {
              const key = `${t.from}>${t.to}`;
              return (
                <li key={key} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm">
                    <strong>{name(t.from)}</strong> {verb(t.from)} <strong>{whom(t.to)}</strong> <strong className="tabular-nums">{formatINR(t.amountPaise)}</strong>
                  </span>
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
