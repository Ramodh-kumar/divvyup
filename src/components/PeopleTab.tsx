import { useState } from 'react';
import { ApiError, type Api } from '../client/api';
import type { Member } from '../client/types';
import { Avatar, btnPrimary, card, ErrorNote, input } from './ui';

interface Props {
  members: Member[];
  me: string | null;
  canEdit: boolean;
  api: Api;
  onChanged: () => Promise<void>;
}

export default function PeopleTab({ members, me, canEdit, api, onChanged }: Props) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Returns true if the action succeeded, so callers can clear inputs only then. */
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onChanged();
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <ErrorNote message={error} />
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
        {members.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-600 dark:text-slate-400">No one here yet. Add the first person below.</li>}
        {members.map((m) => (
          <li key={m.id} className="flex items-center gap-3 px-4 py-3">
            <Avatar member={m} />
            <span className="flex-1 font-medium">
              {m.name}
              {m.id === me && <span className="ml-2 text-xs font-normal text-slate-500">you</span>}
            </span>
            {canEdit && (
              <button
                type="button"
                className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-rose-600 disabled:opacity-50 dark:hover:bg-slate-800"
                disabled={busy}
                aria-label={`Remove ${m.name}`}
                onClick={() => {
                  if (confirm(`Remove ${m.name} from this list?`)) run(() => api.removeMember(m.id));
                }}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>

      {canEdit && (
        <form
          className={`${card} flex gap-2`}
          onSubmit={(e) => {
            e.preventDefault();
            const n = name.trim();
            if (n) run(() => api.addMember(n)).then((ok) => ok && setName(''));
          }}
        >
          <label htmlFor="new-person" className="sr-only">
            Name
          </label>
          <input id="new-person" className={input} placeholder="Add a person" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className={btnPrimary} disabled={busy || !name.trim()}>
            Add
          </button>
        </form>
      )}
    </div>
  );
}
