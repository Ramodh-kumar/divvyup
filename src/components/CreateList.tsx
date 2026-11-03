import { useState } from 'react';
import { ApiError, createList, type CreatedList } from '../client/api';
import { saveList } from '../client/storage';
import ShareLinks from './ShareLinks';
import { btnPrimary, btnSecondary, card, ErrorNote, input } from './ui';

export default function CreateList() {
  const [name, setName] = useState('');
  const [people, setPeople] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; data: CreatedList } | null>(null);

  const addPerson = (raw: string) => {
    const n = raw.trim();
    if (!n) return;
    if (people.some((p) => p.toLowerCase() === n.toLowerCase())) {
      setError(`${n} is already added`);
      return;
    }
    setError(null);
    setPeople([...people, n]);
    setDraft('');
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const all = draft.trim() ? [...people, draft.trim()] : people;
    setBusy(true);
    setError(null);
    try {
      const data = await createList(name.trim(), all);
      saveList({ token: data.editToken, name: name.trim(), role: 'edit', viewToken: data.viewToken });
      setCreated({ name: name.trim(), data });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (created) return <ShareLinks title={`“${created.name}” is ready`} editToken={created.data.editToken} viewToken={created.data.viewToken} />;

  return (
    <form onSubmit={submit} className={`${card} space-y-5`}>
      <div>
        <label htmlFor="list-name" className="mb-1.5 block text-sm font-semibold">
          What are you splitting?
        </label>
        <input id="list-name" className={input} placeholder="Goa trip, Flat expenses, Office lunch…" value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} />
      </div>

      <div>
        <label htmlFor="person" className="mb-1.5 block text-sm font-semibold">
          Who is in it?
        </label>
        <div className="flex gap-2">
          <input
            id="person"
            className={input}
            placeholder="Type a name and press Enter"
            value={draft}
            maxLength={40}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addPerson(draft);
              }
            }}
          />
          <button type="button" className={btnSecondary} onClick={() => addPerson(draft)} disabled={!draft.trim()}>
            Add
          </button>
        </div>
        {people.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {people.map((p) => (
              <li key={p} className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 py-1 pl-3 pr-1.5 text-sm text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">
                {p}
                <button type="button" aria-label={`Remove ${p}`} onClick={() => setPeople(people.filter((x) => x !== p))} className="rounded-full px-1.5 text-indigo-500 hover:bg-indigo-100 dark:hover:bg-indigo-900">
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">You can add more people later.</p>
      </div>

      <ErrorNote message={error} />
      <button type="submit" className={`${btnPrimary} w-full`} disabled={busy || !name.trim()}>
        {busy ? 'Creating…' : 'Create list'}
      </button>
    </form>
  );
}
