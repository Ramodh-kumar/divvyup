// Shapes returned by the /api endpoints (see CLAUDE.md for the contract).

export interface Member {
  id: string;
  name: string;
  color: string | null;
}

export interface Category {
  id: string;
  name: string;
  icon: string | null;
}

export interface Snapshot {
  list: { id: string; name: string; currency: string; version: number; createdAt: number; archivedAt: number | null };
  members: Member[];
  categories: Category[];
  role: 'edit' | 'view';
}

export interface Share {
  memberId: string;
  amountPaise: number;
}

export interface Expense {
  id: string;
  description: string;
  amountPaise: number;
  splitType: string;
  paidOn: string;
  categoryId: string | null;
  note: string | null;
  revision: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: number;
  updatedAt: number;
  payers: Share[];
  splits: Share[];
  tags: string[];
}

export interface Settlement {
  id: string;
  fromMemberId: string;
  toMemberId: string;
  amountPaise: number;
  paidOn: string;
  createdBy: string | null;
  createdAt: number;
}

export interface Transfer {
  from: string;
  to: string;
  amountPaise: number;
}

/** One entry of the changes feed (`GET /api/changes`). */
export interface Change {
  version: number;
  entity: string;
  entityId: string;
  action: string;
  actorMemberId: string | null;
  at: number;
}

export interface ChangesResponse {
  version: number;
  changed: boolean;
  events: Change[];
  hasMore: boolean;
}

export interface Balances {
  version: number;
  balances: Record<string, number>;
  transfers: Transfer[];
  totalSpentPaise: number;
}
