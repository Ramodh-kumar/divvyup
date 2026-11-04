import { useState } from 'react';
import { ApiError, importBackup, type ImportedList } from '../client/api';
import { saveList } from '../client/storage';
import ShareLinks from './ShareLinks';
import Turnstile from './Turnstile';
import { ErrorNote } from './ui';

const MAX_BYTES = 5_000_000;

/** Home-page control: turn a DivvyUp JSON backup back into a list (always a new one). */
export default function ImportBackup({ turnstileSiteKey }: { turnstileSiteKey?: string }) {
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; data: ImportedList } | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.size > MAX_BYTES) {
      setError('This file is too large to be a DivvyUp backup.');
      return;
    }
    setBusy(true);
    try {
      const text = await file.text();
      const data = await importBackup(text, captcha);
      let name = 'Imported list';
      try {
        name = JSON.parse(text).list?.name ?? name;
      } catch {
        // the server already accepted it; the name is only for this device's "your lists"
      }
      saveList({ token: data.editToken, name, role: 'edit', viewToken: data.viewToken });
      setDone({ name, data });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not read that file.');
    } finally {
      setBusy(false);
      setCaptchaReset((n) => n + 1); // single-use token: get a fresh challenge for the next attempt
    }
  }

  if (done) {
    const { expenses, payments } = done.data.imported;
    return (
      <ShareLinks
        title={`“${done.name}” was imported`}
        note={`${expenses} expense${expenses === 1 ? '' : 's'} and ${payments} payment${payments === 1 ? '' : 's'} restored into a new list.`}
        editToken={done.data.editToken}
        viewToken={done.data.viewToken}
      />
    );
  }

  return (
    <section aria-labelledby="import-h" className="text-sm">
      <button type="button" id="import-h" aria-expanded={open} onClick={() => setOpen(!open)} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
        {open ? 'Hide import' : 'Have a backup file? Import it'}
      </button>
      {open && (
        <div className="mt-3 space-y-3 rounded-2xl border border-dashed border-slate-300 p-4 dark:border-slate-700">
          <p className="text-slate-600 dark:text-slate-400">
            Choose a <strong>.json</strong> backup you downloaded from DivvyUp. It becomes a new list with new links; nothing existing is changed.
          </p>
          {turnstileSiteKey && <Turnstile siteKey={turnstileSiteKey} onToken={setCaptcha} resetKey={captchaReset} />}
          <label className="block">
            <span className="sr-only">Backup file</span>
            <input
              type="file"
              accept=".json,application/json"
              disabled={busy || (Boolean(turnstileSiteKey) && !captcha)}
              onChange={(e) => {
                onFile(e.target.files?.[0]);
                e.target.value = '';
              }}
              className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-indigo-500"
            />
          </label>
          {busy && <p role="status">Importing…</p>}
          <ErrorNote message={error} />
        </div>
      )}
    </section>
  );
}
