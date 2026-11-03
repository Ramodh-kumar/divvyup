import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, type Api } from '../client/api';
import { buildPayload, draftFromExpense, emptyDraft, previewSplit, resolvePayers, type Draft, type SplitKind } from '../client/expense-form';
import { today } from '../client/format';
import type { Category, Expense, Member } from '../client/types';
import { formatINR, parseRupees } from '../lib/money';
import { Avatar, btnPrimary, btnSecondary, ErrorNote, input } from './ui';

interface Props {
  members: Member[];
  categories: Category[];
  me: string | null;
  api: Api;
  /** Present when editing an existing expense. */
  expense?: Expense;
  /** Called after any successful change; the parent reloads and closes the form. */
  onSaved: () => Promise<void>;
  onClose: () => void;
}

const SPLITS: { id: SplitKind; label: string }[] = [
  { id: 'equal', label: 'Equally' },
  { id: 'exact', label: 'Amounts' },
  { id: 'percent', label: 'Percent' },
  { id: 'shares', label: 'Shares' },
];

const label = 'mb-1.5 block text-sm font-semibold';

export default function ExpenseForm({ members, categories, me, api, expense, onSaved, onClose }: Props) {
  const initial = useMemo(
    () => (expense ? draftFromExpense(expense, members) : { draft: emptyDraft(members, me, today()), convertedToExact: false }),
    // The form is created fresh for each open, so the starting point is computed once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [draft, setDraft] = useState<Draft>(initial.draft);
  const [base, setBase] = useState<Expense | undefined>(expense); // the version we are editing; its revision guards the save
  const [notice, setNotice] = useState<string | null>(initial.convertedToExact ? 'This split was entered as percentages or shares, so it is shown here as exact amounts. The money is unchanged.' : null);
  const [conflict, setConflict] = useState<Expense | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showMore, setShowMore] = useState(Boolean(expense?.note || expense?.tags.length));
  const firstField = useRef<HTMLInputElement>(null);
  const conflictRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expense) firstField.current?.focus();
  }, [expense]);

  // The form scrolls, so a rejected save or a conflict could appear out of sight; bring it into view.
  useEffect(() => {
    if (conflict) conflictRef.current?.scrollIntoView({ block: 'nearest' });
  }, [conflict]);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'nearest' });
  }, [error]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setIn = (key: 'payerAmounts' | 'included' | 'exact' | 'percent' | 'shares', id: string, value: string | boolean) =>
    setDraft((d) => ({ ...d, [key]: { ...d[key], [id]: value } }));

  const total = parseRupees(draft.amount);
  const preview = previewSplit(draft, members, total);
  const payerCheck = total ? resolvePayers(draft, members, total) : null;
  const name = (id: string) => members.find((m) => m.id === id)?.name ?? 'Someone';

  async function save(revision?: number) {
    const built = buildPayload(draft, members);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (base) await api.replaceExpense(base.id, { ...built.body, revision: revision ?? base.revision });
      else await api.createExpense(built.body);
      await onSaved();
    } catch (e) {
      handleFailure(e);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!base || !confirm(`Delete “${base.description}”? Balances will update for everyone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteExpense(base.id, base.revision);
      await onSaved();
    } catch (e) {
      handleFailure(e);
    } finally {
      setBusy(false);
    }
  }

  function handleFailure(e: unknown) {
    if (e instanceof ApiError && e.status === 409 && base) {
      setConflict((e.body as { current?: Expense } | undefined)?.current ?? null);
      setError(null);
    } else if (e instanceof ApiError && e.status === 404 && base) {
      setError('Someone already deleted this expense. Close this window to see the latest list.');
    } else {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    }
  }

  const adopt = (theirs: Expense) => {
    const { draft: d, convertedToExact } = draftFromExpense(theirs, members);
    setDraft(d);
    setBase(theirs);
    setConflict(null);
    setNotice(convertedToExact ? 'Showing their version. Their split was entered as percentages or shares, so it appears as exact amounts.' : 'Showing their version. Change what you need and save again.');
  };

  const amountCell = (id: string) => (preview.amounts[id] ? formatINR(preview.amounts[id]) : '—');

  return (
    <div
      className="fixed inset-0 z-20 flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="expense-form-h"
      onKeyDown={(e) => e.key === 'Escape' && !busy && onClose()}
    >
      <form
        className="flex max-h-[95dvh] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-xl dark:bg-slate-900 sm:rounded-2xl"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <h2 id="expense-form-h" className="text-lg font-bold">
            {base ? 'Edit expense' : 'Add expense'}
          </h2>
          <button type="button" aria-label="Close" className="rounded-lg px-2 py-1 text-xl leading-none text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onClose} disabled={busy}>
            ×
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto px-5 py-4">
          {conflict && (
            <div ref={conflictRef} role="alert" className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
              <p>
                <strong>{conflict.updatedBy ? name(conflict.updatedBy) : 'Someone'}</strong> changed this expense while you were editing it. It is now <strong>{conflict.description}</strong>, {formatINR(conflict.amountPaise)}.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btnSecondary} onClick={() => adopt(conflict)}>
                  Use their version
                </button>
                <button type="button" className={btnSecondary} onClick={() => save(conflict.revision)} disabled={busy}>
                  Save mine instead
                </button>
              </div>
            </div>
          )}
          {notice && <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800 dark:bg-sky-950/40 dark:text-sky-200">{notice}</p>}

          <div>
            <label htmlFor="exp-desc" className={label}>
              What was it for?
            </label>
            <input id="exp-desc" ref={firstField} className={input} placeholder="Dinner, Taxi, Groceries…" value={draft.description} maxLength={120} onChange={(e) => set('description', e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="exp-amount" className={label}>
                Amount
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-500">₹</span>
                <input id="exp-amount" className={`${input} pl-7`} inputMode="decimal" placeholder="0.00" value={draft.amount} onChange={(e) => set('amount', e.target.value)} />
              </div>
            </div>
            <div>
              <label htmlFor="exp-date" className={label}>
                Date
              </label>
              <input id="exp-date" type="date" className={input} value={draft.paidOn} onChange={(e) => set('paidOn', e.target.value)} />
            </div>
          </div>

          <div>
            <label htmlFor="exp-cat" className={label}>
              Category
            </label>
            <select id="exp-cat" className={input} value={draft.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon ? `${c.icon} ` : ''}
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <fieldset>
            <div className="mb-1.5 flex items-center justify-between">
              <legend className="text-sm font-semibold">Paid by</legend>
              <button type="button" className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => set('multiPayer', !draft.multiPayer)}>
                {draft.multiPayer ? 'One person paid' : 'Several people paid'}
              </button>
            </div>
            {!draft.multiPayer ? (
              <select aria-label="Paid by" className={input} value={draft.paidBy} onChange={(e) => set('paidBy', e.target.value)}>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.id === me ? ' (you)' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <ul className="space-y-2">
                {members.map((m) => (
                  <li key={m.id} className="flex items-center gap-3">
                    <Avatar member={m} size={28} />
                    <span className="flex-1 text-sm">{m.name}</span>
                    <input aria-label={`${m.name} paid`} className={`${input} w-28 text-right`} inputMode="decimal" placeholder="0" value={draft.payerAmounts[m.id] ?? ''} onChange={(e) => setIn('payerAmounts', m.id, e.target.value)} />
                  </li>
                ))}
              </ul>
            )}
            {draft.multiPayer && payerCheck && 'problem' in payerCheck && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{payerCheck.problem}</p>}
          </fieldset>

          <fieldset>
            <legend className="mb-1.5 text-sm font-semibold">Split</legend>
            <div role="tablist" aria-label="How to split" className="mb-3 grid grid-cols-4 gap-1 rounded-xl bg-slate-200/70 p-1 dark:bg-slate-800">
              {SPLITS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={draft.splitType === s.id}
                  onClick={() => set('splitType', s.id)}
                  className={`rounded-lg px-2 py-1.5 text-xs font-semibold transition ${draft.splitType === s.id ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-100' : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <ul className="space-y-2">
              {members.map((m) => (
                <li key={m.id} className="flex items-center gap-3">
                  {draft.splitType === 'equal' ? (
                    <label className="flex flex-1 cursor-pointer items-center gap-3">
                      <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={draft.included[m.id] ?? false} onChange={(e) => setIn('included', m.id, e.target.checked)} />
                      <Avatar member={m} size={28} />
                      <span className="text-sm">{m.name}</span>
                    </label>
                  ) : (
                    <>
                      <Avatar member={m} size={28} />
                      <span className="flex-1 text-sm">{m.name}</span>
                      <input
                        aria-label={`${m.name}: ${draft.splitType === 'exact' ? 'amount' : draft.splitType === 'percent' ? 'percent' : 'shares'}`}
                        className={`${input} w-24 text-right`}
                        inputMode="decimal"
                        placeholder={draft.splitType === 'shares' ? '0' : '—'}
                        value={draft[draft.splitType][m.id] ?? ''}
                        onChange={(e) => setIn(draft.splitType as 'exact' | 'percent' | 'shares', m.id, e.target.value)}
                      />
                      <span className="w-4 text-xs text-slate-500">{draft.splitType === 'percent' ? '%' : ''}</span>
                    </>
                  )}
                  {(draft.splitType !== 'exact' || preview.amounts[m.id]) && <span className="w-24 text-right text-sm tabular-nums text-slate-600 dark:text-slate-400">{amountCell(m.id)}</span>}
                </li>
              ))}
            </ul>
            {preview.problem && total ? <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{preview.problem}</p> : null}
          </fieldset>

          <div>
            <button type="button" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400" aria-expanded={showMore} onClick={() => setShowMore(!showMore)}>
              {showMore ? 'Hide' : 'Add'} tags and note
            </button>
            {showMore && (
              <div className="mt-3 space-y-3">
                <div>
                  <label htmlFor="exp-tags" className={label}>
                    Tags <span className="font-normal text-slate-500">(comma separated)</span>
                  </label>
                  <input id="exp-tags" className={input} placeholder="goa, trip" value={draft.tags} onChange={(e) => set('tags', e.target.value)} />
                </div>
                <div>
                  <label htmlFor="exp-note" className={label}>
                    Note
                  </label>
                  <textarea id="exp-note" rows={2} className={input} maxLength={500} value={draft.note} onChange={(e) => set('note', e.target.value)} />
                </div>
              </div>
            )}
          </div>

          <div ref={errorRef}>
            <ErrorNote message={error} />
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
          {base && (
            <button type="button" className="rounded-lg px-3 py-2.5 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:hover:bg-rose-950/40" onClick={remove} disabled={busy}>
              Delete
            </button>
          )}
          <button type="button" className={`${btnSecondary} ml-auto`} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary} disabled={busy}>
            {busy ? 'Saving…' : base ? 'Save changes' : 'Add expense'}
          </button>
        </div>
      </form>
    </div>
  );
}
