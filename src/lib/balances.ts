import type { SplitShare } from './splits';

export interface ExpenseLedger {
  payers: SplitShare[];
  splits: SplitShare[];
}

export interface SettlementEntry {
  fromMemberId: string;
  toMemberId: string;
  amountPaise: number;
}

export interface Transfer {
  from: string;
  to: string;
  amountPaise: number;
}

/**
 * Net balance per member in paise: paid - owed, adjusted by recorded settlements.
 * Positive = the group owes them; negative = they owe the group. All balances sum to 0.
 * Callers pass only non-deleted expenses and settlements.
 */
export function computeBalances(
  memberIds: string[],
  expenses: ExpenseLedger[],
  settlements: SettlementEntry[] = [],
): Record<string, number> {
  const net: Record<string, number> = Object.fromEntries(memberIds.map((id) => [id, 0]));
  const add = (id: string, delta: number) => {
    net[id] = (net[id] ?? 0) + delta;
  };
  for (const e of expenses) {
    for (const p of e.payers) add(p.memberId, p.amountPaise);
    for (const s of e.splits) add(s.memberId, -s.amountPaise);
  }
  // The payer of a settlement has handed over money, so they owe less; the receiver is owed less.
  for (const s of settlements) {
    add(s.fromMemberId, s.amountPaise);
    add(s.toMemberId, -s.amountPaise);
  }
  return net;
}

/**
 * Greedy minimum-transactions settle-up: repeatedly match the largest debtor with the
 * largest creditor. Ties break on member id so the output is deterministic.
 */
export function suggestSettlements(balances: Record<string, number>): Transfer[] {
  const byAmountThenId = (a: [string, number], b: [string, number]) =>
    b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  const creditors = Object.entries(balances).filter(([, v]) => v > 0).sort(byAmountThenId);
  const debtors = Object.entries(balances)
    .filter(([, v]) => v < 0)
    .map(([id, v]) => [id, -v] as [string, number])
    .sort(byAmountThenId);

  const transfers: Transfer[] = [];
  while (creditors.length && debtors.length) {
    const [creditorId, credit] = creditors[0];
    const [debtorId, debt] = debtors[0];
    const amount = Math.min(credit, debt);
    transfers.push({ from: debtorId, to: creditorId, amountPaise: amount });
    creditors[0][1] -= amount;
    debtors[0][1] -= amount;
    if (creditors[0][1] === 0) creditors.shift();
    if (debtors[0][1] === 0) debtors.shift();
    creditors.sort(byAmountThenId);
    debtors.sort(byAmountThenId);
  }
  return transfers;
}
