import type { Change, Member } from './types';

const NOUN: Record<string, string> = {
  expense: 'an expense',
  settlement: 'a payment',
  member: 'a person',
  category: 'a category',
  tag: 'a tag',
  list: 'the list',
};

const VERB: Record<string, string> = {
  create: 'added',
  update: 'edited',
  delete: 'removed',
  restore: 'restored',
};

/**
 * Turn other people's changes into one short sentence for a toast, e.g. "Ravi edited an expense".
 * Changes made by `me` are skipped: this device already shows them. Returns null if nothing is left.
 */
export function describeChanges(changes: Change[], members: Member[], me: string | null): string | null {
  const others = changes.filter((c) => !me || c.actorMemberId !== me);
  if (others.length === 0) return null;

  const name = (id: string | null) => members.find((m) => m.id === id)?.name ?? 'Someone';
  const actors = [...new Set(others.map((c) => name(c.actorMemberId)))];
  const who = actors.length === 1 ? actors[0] : `${actors.length} people`;

  if (others.length === 1) {
    const c = others[0];
    return `${who} ${VERB[c.action] ?? 'changed'} ${NOUN[c.entity] ?? 'something'}`;
  }
  return `${who} made ${others.length} changes`;
}
