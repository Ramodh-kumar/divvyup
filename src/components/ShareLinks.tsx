import { useState } from 'react';
import { copyText, listUrl } from '../client/format';
import { btnPrimary, btnSecondary, card, input } from './ui';

function CopyRow({ label, hint, token }: { label: string; hint: string; token: string }) {
  const [copied, setCopied] = useState(false);
  const url = listUrl(token);
  return (
    <div>
      <p className="text-sm font-semibold">{label}</p>
      <p className="mb-1.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
      <div className="flex gap-2">
        <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className={`${input} font-mono text-xs`} aria-label={label} />
        <button
          type="button"
          className={btnSecondary}
          onClick={async () => {
            setCopied(await copyText(url));
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

/** Shown right after a list is created or imported: the links are the only way back in, so make them hard to miss. */
export default function ShareLinks({ title, note, editToken, viewToken }: { title: string; note?: string; editToken: string; viewToken: string }) {
  return (
    <section className={`${card} space-y-5`} aria-live="polite">
      <div>
        <h2 className="text-xl font-bold">{title}</h2>
        {note && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{note}</p>}
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          There are no accounts, so these links are the only way in. Save the edit link somewhere safe and share it with the people who should add expenses.
        </p>
      </div>
      <CopyRow label="Edit link" hint="Anyone with this link can add and change expenses." token={editToken} />
      <CopyRow label="View-only link" hint="Anyone with this link can look but not change anything." token={viewToken} />
      <a href={`/l/${editToken}`} className={`${btnPrimary} w-full`}>
        Open list
      </a>
    </section>
  );
}
