import { useEffect, useRef, useState } from 'react';
import { describeChanges } from '../client/activity';
import { copyText, listUrl } from '../client/format';
import { getMe, saveList, setMe as storeMe } from '../client/storage';
import type { Expense, Member } from '../client/types';
import { useListData } from '../client/useListData';
import { formatINR } from '../lib/money';
import BalancesTab from './BalancesTab';
import ExpenseForm from './ExpenseForm';
import ExpensesTab from './ExpensesTab';
import MoreTab from './MoreTab';
import PeopleTab from './PeopleTab';
import { Avatar, btnPrimary, btnSecondary, card } from './ui';

type Tab = 'expenses' | 'balances' | 'people' | 'more';
const TABS: { id: Tab; label: string }[] = [
  { id: 'expenses', label: 'Expenses' },
  { id: 'balances', label: 'Balances' },
  { id: 'people', label: 'People' },
  { id: 'more', label: 'More' },
];

export default function ListApp({ token }: { token: string }) {
  const meRef = useRef<string | null>(null);
  const [me, setMeState] = useState<string | null>(null);
  const [skippedPicker, setSkippedPicker] = useState(false);
  // The tab lives in the URL hash (#balances) so it survives reloads and can be linked to.
  const [tab, setTabState] = useState<Tab>(() => {
    const h = location.hash.slice(1);
    return TABS.some((t) => t.id === h) ? (h as Tab) : 'expenses';
  });
  const setTab = (t: Tab) => {
    setTabState(t);
    history.replaceState(null, '', `#${t}`);
  };
  const [copied, setCopied] = useState(false);
  // null = closed, 'new' = adding, an Expense = editing it. `formKey` remounts the form so it starts fresh each time.
  const [formFor, setFormFor] = useState<'new' | Expense | null>(null);
  const [formKey, setFormKey] = useState(0);
  const openForm = (target: 'new' | Expense) => {
    setFormKey((k) => k + 1);
    setFormFor(target);
  };
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const membersRef = useRef<Member[]>([]);

  const { api, data, status, error, online, reload } = useListData(
    token,
    () => meRef.current,
    (changes) => {
      const message = describeChanges(changes, membersRef.current, meRef.current);
      if (!message) return;
      setToast(message);
      clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 5000);
    },
  );
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const listId = data?.snapshot.list.id;
  const listName = data?.snapshot.list.name;
  const role = data?.snapshot.role;
  const members = data?.snapshot.members;
  if (members) membersRef.current = members;

  // Restore "I am" once we know the list, and forget it if that person has since been removed.
  useEffect(() => {
    if (!listId || !members) return;
    const stored = getMe(listId);
    const valid = stored && members.some((m) => m.id === stored) ? stored : null;
    meRef.current = valid;
    setMeState(valid);
  }, [listId, members]);

  // Remember this list on the device so it shows up on the home page.
  useEffect(() => {
    if (listName && role) saveList({ token, name: listName, role });
  }, [token, listName, role]);

  function chooseMe(id: string | null) {
    if (!listId) return;
    meRef.current = id;
    setMeState(id);
    storeMe(listId, id);
  }

  if (status === 'loading') return <p className="py-12 text-center text-slate-500" role="status">Loading…</p>;

  if (status === 'notfound') {
    return (
      <div className={`${card} space-y-3 text-center`}>
        <h1 className="text-xl font-bold">List not found</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">This link is wrong or incomplete. Check you copied the whole link, or ask whoever shared it to send it again.</p>
        <a href="/" className={btnSecondary}>
          Back to home
        </a>
      </div>
    );
  }

  if (status === 'error' || !data) {
    return (
      <div className={`${card} space-y-3 text-center`} role="alert">
        <h1 className="text-xl font-bold">Couldn’t load this list</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">{error}</p>
        <button type="button" className={btnPrimary} onClick={reload}>
          Try again
        </button>
      </div>
    );
  }

  const { snapshot, expenses, settlements, balances } = data;
  const canEdit = snapshot.role === 'edit';
  const meMember = snapshot.members.find((m) => m.id === me);
  const showPicker = canEdit && !me && !skippedPicker && snapshot.members.length > 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight">{snapshot.list.name}</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {snapshot.members.length} {snapshot.members.length === 1 ? 'person' : 'people'} · {formatINR(balances.totalSpentPaise)} spent
          </p>
        </div>
        <button
          type="button"
          className={btnSecondary}
          onClick={async () => {
            setCopied(await copyText(listUrl(token)));
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? 'Link copied' : 'Copy link'}
        </button>
      </div>

      {!canEdit && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">You’re viewing this list read-only.</p>
      )}

      {canEdit && meMember && (
        <p className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
          <Avatar member={meMember} size={22} /> You are {meMember.name}.
          <button type="button" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => chooseMe(null)}>
            Change
          </button>
        </p>
      )}

      <div role="tablist" aria-label="List sections" className="grid grid-cols-4 gap-1 rounded-xl bg-slate-200/70 p-1 dark:bg-slate-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${tab === t.id ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-100' : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'expenses' && (
          <div className="space-y-4">
            {canEdit &&
              (snapshot.members.length > 0 ? (
                <button type="button" className={`${btnPrimary} w-full`} onClick={() => openForm('new')}>
                  + Add expense
                </button>
              ) : (
                <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">Add people in the People tab before adding expenses.</p>
              ))}
            <ExpensesTab expenses={expenses} members={snapshot.members} categories={snapshot.categories} me={me} onSelect={canEdit ? openForm : undefined} />
          </div>
        )}
        {tab === 'balances' && (
          <BalancesTab balances={balances} settlements={settlements} members={snapshot.members} me={me} canEdit={canEdit} api={api} onChanged={reload} />
        )}
        {tab === 'people' && <PeopleTab members={snapshot.members} me={me} canEdit={canEdit} api={api} onChanged={reload} />}
        {tab === 'more' && <MoreTab api={api} members={snapshot.members} canEdit={canEdit} onChanged={reload} />}
      </div>

      {formFor && (
        <ExpenseForm
          key={formKey}
          members={snapshot.members}
          categories={snapshot.categories}
          me={me}
          api={api}
          expense={formFor === 'new' ? undefined : formFor}
          onClose={() => {
            setFormFor(null);
            reload(); // the user may have closed after a conflict or a deletion elsewhere; show the latest
          }}
          onSaved={async () => {
            await reload();
            setFormFor(null);
          }}
        />
      )}

      {/* Live-sync status: a toast for other people's changes, and a notice while we cannot reach the server. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-4" role="status" aria-live="polite">
        {!online ? (
          <p className="rounded-full bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow-lg">Offline. Retrying…</p>
        ) : toast ? (
          <p className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg dark:bg-slate-100 dark:text-slate-900">{toast}</p>
        ) : null}
      </div>

      {showPicker && (
        <div className="fixed inset-0 z-10 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="who-h">
          <div className={`${card} w-full max-w-sm space-y-4`}>
            <div>
              <h2 id="who-h" className="text-lg font-bold">Who are you?</h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">So your expenses are labelled correctly. We’ll remember this on this device.</p>
            </div>
            <ul className="space-y-2">
              {snapshot.members.map((m) => (
                <li key={m.id}>
                  <button type="button" className={`${btnSecondary} w-full justify-start`} onClick={() => chooseMe(m.id)}>
                    <Avatar member={m} size={24} /> {m.name}
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="w-full text-sm text-slate-500 hover:underline" onClick={() => setSkippedPicker(true)}>
              I’m just looking
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
