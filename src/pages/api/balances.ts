import type { APIRoute } from 'astro';
import { authenticate } from '../../lib/auth';
import { computeBalances, suggestSettlements } from '../../lib/balances';
import { getDb } from '../../lib/db';
import { loadContext, loadExpenses } from '../../lib/expenses';
import { json } from '../../lib/http';
import { loadSettlements } from '../../lib/settlements';

// GET /api/balances -> net paise per member (positive = is owed) and a minimal set of suggested payments
export const GET: APIRoute = async ({ request }) => {
  const db = getDb();
  const access = await authenticate(db, request);
  if (access instanceof Response) return access;

  const listId = access.list.id;
  const [{ memberIds }, expenses, settlements] = await Promise.all([
    loadContext(db, listId),
    loadExpenses(db, listId),
    loadSettlements(db, listId),
  ]);
  const balances = computeBalances([...memberIds], expenses, settlements);
  return json({
    version: access.list.version,
    balances,
    transfers: suggestSettlements(balances),
    totalSpentPaise: expenses.reduce((sum, e) => sum + e.amountPaise, 0),
  });
};
