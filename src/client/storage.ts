// Per-device memory: which lists this browser has opened, and who the user is in each one.
// Links are the only way back into a list, so remembering them here is the "my lists" feature.

const LISTS_KEY = 'divvyup:lists';
const meKey = (listId: string) => `divvyup:me:${listId}`;

export interface SavedList {
  token: string; // the token used to open the list (edit or view)
  name: string;
  role: 'edit' | 'view';
  viewToken?: string; // only known on the device that created the list
  savedAt: number;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be full or blocked (private mode); the app still works, it just forgets.
  }
}

export const getSavedLists = (): SavedList[] => read<SavedList[]>(LISTS_KEY, []).sort((a, b) => b.savedAt - a.savedAt);

export function saveList(entry: Omit<SavedList, 'savedAt'>) {
  const others = getSavedLists().filter((l) => l.token !== entry.token);
  const existing = getSavedLists().find((l) => l.token === entry.token);
  write(LISTS_KEY, [{ ...existing, ...entry, savedAt: Date.now() }, ...others]);
}

export function forgetList(token: string) {
  write(LISTS_KEY, getSavedLists().filter((l) => l.token !== token));
}

export const getMe = (listId: string): string | null => read<string | null>(meKey(listId), null);
export const setMe = (listId: string, memberId: string | null) => write(meKey(listId), memberId);
