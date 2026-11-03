import { describe, expect, it } from 'vitest';
import { describeChanges } from './activity';
import type { Change, Member } from './types';

const members: Member[] = [
  { id: 'a', name: 'Asha', color: null },
  { id: 'r', name: 'Ravi', color: null },
];
const change = (over: Partial<Change>): Change => ({ version: 2, entity: 'expense', entityId: 'x', action: 'create', actorMemberId: 'r', at: 0, ...over });

describe('describeChanges', () => {
  it('describes a single change by someone else', () => {
    expect(describeChanges([change({})], members, 'a')).toBe('Ravi added an expense');
    expect(describeChanges([change({ action: 'update' })], members, 'a')).toBe('Ravi edited an expense');
    expect(describeChanges([change({ entity: 'settlement', action: 'delete' })], members, 'a')).toBe('Ravi removed a payment');
  });
  it('ignores my own changes', () => {
    expect(describeChanges([change({ actorMemberId: 'a' })], members, 'a')).toBeNull();
    expect(describeChanges([], members, 'a')).toBeNull();
  });
  it('summarises several changes', () => {
    expect(describeChanges([change({}), change({ version: 3 })], members, 'a')).toBe('Ravi made 2 changes');
    expect(describeChanges([change({}), change({ actorMemberId: 'a' }), change({ actorMemberId: null })], members, null)).toBe('3 people made 3 changes');
  });
  it('handles unknown or missing actors', () => {
    expect(describeChanges([change({ actorMemberId: null })], members, 'a')).toBe('Someone added an expense');
    expect(describeChanges([change({ actorMemberId: 'gone' })], members, 'a')).toBe('Someone added an expense');
  });
});
