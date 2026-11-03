import { formatINR } from '../lib/money';
import { formatDate } from '../client/format';
import type { Category, Expense, Member } from '../client/types';
import { card } from './ui';

interface Props {
  expenses: Expense[];
  members: Member[];
  categories: Category[];
  me: string | null;
}

const sumFor = (rows: { memberId: string; amountPaise: number }[], id: string) =>
  rows.filter((r) => r.memberId === id).reduce((a, r) => a + r.amountPaise, 0);

/** What this expense means for one person: positive = they are owed, negative = they owe. */
function myEffect(e: Expense, me: string): number {
  return sumFor(e.payers, me) - sumFor(e.splits, me);
}

export default function ExpensesTab({ expenses, members, categories, me }: Props) {
  const name = (id: string) => (id === me ? 'You' : members.find((m) => m.id === id)?.name ?? 'Someone');
  const category = (id: string | null) => categories.find((c) => c.id === id);

  if (expenses.length === 0) {
    return (
      <div className={`${card} text-center`}>
        <p className="text-lg font-semibold">No expenses yet</p>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Add the first one to start tracking who owes what.</p>
      </div>
    );
  }

  // Expenses arrive newest first, so grouping preserves that order.
  const byDate = new Map<string, Expense[]>();
  for (const e of expenses) byDate.set(e.paidOn, [...(byDate.get(e.paidOn) ?? []), e]);

  return (
    <div className="space-y-6">
      {[...byDate.entries()].map(([date, items]) => (
        <section key={date} aria-label={formatDate(date)}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{formatDate(date)}</h3>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
            {items.map((e) => {
              const effect = me ? myEffect(e, me) : 0;
              const cat = category(e.categoryId);
              return (
                <li key={e.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-lg dark:bg-slate-800" aria-hidden="true">
                    {cat?.icon ?? '🧾'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{e.description}</p>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                      {e.payers.map((p) => name(p.memberId)).join(' & ')} paid {formatINR(e.amountPaise)}
                      {e.tags.length > 0 && ` · ${e.tags.map((t) => `#${t}`).join(' ')}`}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {me && effect !== 0 ? (
                      <>
                        <p className={`text-sm font-semibold ${effect > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                          {formatINR(Math.abs(effect))}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{effect > 0 ? 'you lent' : 'you owe'}</p>
                      </>
                    ) : (
                      <p className="text-xs text-slate-400">{me ? 'not involved' : ''}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
