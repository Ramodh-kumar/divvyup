export interface SplitShare {
  memberId: string;
  amountPaise: number;
}

export class SplitError extends Error {}

function assertTotal(totalPaise: number) {
  if (!Number.isSafeInteger(totalPaise) || totalPaise <= 0) {
    throw new SplitError('Amount must be a positive whole number of paise');
  }
}

function assertUniqueMembers(ids: string[]) {
  if (ids.length === 0) throw new SplitError('At least one member is required');
  if (new Set(ids).size !== ids.length) throw new SplitError('Duplicate member in split');
}

/**
 * Split `total` proportionally to integer `weights` using the largest-remainder method.
 * The result always sums to exactly `total`. Leftover paise go to the largest fractional
 * remainders; ties go to the lower index, so the outcome is deterministic.
 */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw new SplitError('Weights must add up to more than zero');
  const base = weights.map((w) => Math.floor((total * w) / sum));
  let leftover = total - base.reduce((a, b) => a + b, 0);
  const order = weights
    .map((w, i) => ({ i, rem: (total * w) % sum }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const { i } of order) {
    if (leftover === 0) break;
    base[i] += 1;
    leftover -= 1;
  }
  return base;
}

// Inputs are sorted by memberId so the result does not depend on the order passed in.
function sorted<T extends { memberId: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0));
}

export function splitEqual(totalPaise: number, memberIds: string[]): SplitShare[] {
  assertTotal(totalPaise);
  assertUniqueMembers(memberIds);
  const members = sorted(memberIds.map((memberId) => ({ memberId })));
  const amounts = allocate(totalPaise, members.map(() => 1));
  return members.map((m, i) => ({ memberId: m.memberId, amountPaise: amounts[i] }));
}

export function splitExact(totalPaise: number, entries: SplitShare[]): SplitShare[] {
  assertTotal(totalPaise);
  assertUniqueMembers(entries.map((e) => e.memberId));
  if (entries.some((e) => !Number.isSafeInteger(e.amountPaise) || e.amountPaise < 0)) {
    throw new SplitError('Amounts must be non-negative whole paise');
  }
  const sum = entries.reduce((a, e) => a + e.amountPaise, 0);
  if (sum !== totalPaise) throw new SplitError(`Amounts add up to ${sum}, expected ${totalPaise}`);
  return sorted(entries).map((e) => ({ ...e }));
}

/** Percentages may have up to 2 decimals and must add up to exactly 100. */
export function splitPercent(
  totalPaise: number,
  entries: { memberId: string; percent: number }[],
): SplitShare[] {
  assertTotal(totalPaise);
  assertUniqueMembers(entries.map((e) => e.memberId));
  const ordered = sorted(entries);
  const hundredths = ordered.map((e) => Math.round(e.percent * 100));
  if (hundredths.some((h) => h < 0)) throw new SplitError('Percentages cannot be negative');
  if (hundredths.reduce((a, b) => a + b, 0) !== 10000) {
    throw new SplitError('Percentages must add up to 100');
  }
  const amounts = allocate(totalPaise, hundredths);
  return ordered.map((e, i) => ({ memberId: e.memberId, amountPaise: amounts[i] }));
}

/** Shares are whole numbers (e.g. 2 nights vs 1 night); a member with 0 shares owes nothing. */
export function splitShares(
  totalPaise: number,
  entries: { memberId: string; shares: number }[],
): SplitShare[] {
  assertTotal(totalPaise);
  assertUniqueMembers(entries.map((e) => e.memberId));
  if (entries.some((e) => !Number.isInteger(e.shares) || e.shares < 0)) {
    throw new SplitError('Shares must be non-negative whole numbers');
  }
  const ordered = sorted(entries);
  const amounts = allocate(totalPaise, ordered.map((e) => e.shares));
  return ordered.map((e, i) => ({ memberId: e.memberId, amountPaise: amounts[i] }));
}
