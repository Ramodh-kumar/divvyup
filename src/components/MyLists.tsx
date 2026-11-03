import { useEffect, useState } from 'react';
import { forgetList, getSavedLists, type SavedList } from '../client/storage';

export default function MyLists() {
  const [lists, setLists] = useState<SavedList[]>([]);
  // localStorage only exists in the browser, so read it after mount.
  useEffect(() => setLists(getSavedLists()), []);
  if (lists.length === 0) return null;

  return (
    <section aria-labelledby="my-lists">
      <h2 id="my-lists" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Your lists on this device
      </h2>
      <ul className="space-y-2">
        {lists.map((l) => (
          <li key={l.token} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white pr-2 dark:border-slate-800 dark:bg-slate-900">
            <a href={`/l/${l.token}`} className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-xl px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800">
              <span className="truncate font-medium">{l.name}</span>
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {l.role === 'edit' ? 'Can edit' : 'View only'}
              </span>
            </a>
            <button
              type="button"
              aria-label={`Remove ${l.name} from this device`}
              title="Remove from this device (the list itself is not deleted)"
              className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
              onClick={() => {
                forgetList(l.token);
                setLists(getSavedLists());
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
