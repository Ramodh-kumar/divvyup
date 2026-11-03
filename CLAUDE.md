# DivvyUp

Splitwise-style shared expense tracker. Free to host on Cloudflare. Repo: https://github.com/Ramodh-kumar/divvyup

## Tech stack
- **Astro 7** (`output: 'server'`) with the **@astrojs/cloudflare** adapter, deployed to **Cloudflare Pages**
- **React 19** islands for interactive UI (expense form, balances, people editor); everything else is Astro
- **Tailwind CSS 4** via `@tailwindcss/vite`
- **Cloudflare D1** (SQLite) bound as `DB` (see `wrangler.jsonc`), accessed with **Drizzle ORM**; migrations in `migrations/`
- **Vitest** for unit tests; **TypeScript** strict

## Product decisions (agreed with the user)
- Purpose: shared split (who paid, who owes whom, settle-up suggestions)
- **Currency: INR only.** Money is stored as integer paise, never floats; display as ₹ with Indian grouping (₹1,23,456.00). One `currency` field on the list, default INR.
- **No accounts.** Each list has a secret edit link (and optional read-only view link). Only hashes of tokens are stored. URL shape: `/l/<token>`.
- **Shared editing:** anyone with the edit link can add/edit expenses; others see updates via **polling** (`GET /api/lists/:id/changes?since=<version>` every ~5-10s while the tab is visible). Real-time via Durable Objects is a possible later upgrade.
- Conflict safety: per-list `version` counter; per-expense `revision`; a stale edit gets HTTP 409.
- Each device picks "I am: <member>" once and stores it locally; used for `created_by`/`updated_by` attribution (trust-based).
- Members are scoped per list (no global users).
- Soft delete (`deleted_at`) everywhere + append-only `events` log for history/undo. Retention: lists archived after 12 months inactive, soft-deleted rows purged after 90 days (Cron Trigger). Not final; confirm with user.
- Balances are **derived** (paid - owed + settlements), never stored. Splits store resolved amounts per member (types: equal | exact | percent | shares) with deterministic rounding. Settle-up = greedy min-transactions.
- v1 features: categories and tags, export/import (JSON, CSV), soft delete/undo. Not in v1: multi-currency, unequal-split UI beyond the phases below.

## Planned data model (Drizzle schema goes in `src/lib/schema.ts`)
lists, members, expenses, expense_payers, expense_splits, categories, tags, expense_tags, settlements, events.
Every table carries `list_id` where relevant; mutable rows have `deleted_at`.

## Implementation checklist
1. [x] Scaffold: Astro + React + Tailwind + Cloudflare adapter + wrangler/D1 config + Drizzle config
2. [x] Drizzle schema (`src/lib/schema.ts`) and first migration (`migrations/0000_*.sql`, verified against local D1)
3. [x] Core pure logic in `src/lib/` with Vitest tests (23 passing): `money.ts` (parseRupees, formatINR), `splits.ts` (allocate via largest remainder; equal/exact/percent/shares; inputs sorted by memberId for determinism), `balances.ts` (computeBalances, suggestSettlements)
4. [x] API (complete, in slices). Conventions: token goes in `Authorization: Bearer <token>` (not the URL); the list is resolved from the token, so routes have no list id; `authenticate(db, request, 'edit'|'view')` in `src/lib/auth.ts`; DB via `getDb()` (`cloudflare:workers` env); helpers in `src/lib/http.ts`.
   - [x] Slice 1: `POST /api/lists` (create, returns tokens once, seeds default categories + members), `GET /api/list` (snapshot + role). Verified end to end on the dev server against local D1.
   - [x] Slice 2: members: `POST /api/members`, `PATCH|DELETE /api/members/:id` (case-insensitive unique names, soft delete refused with 409 while the member is in expenses/settlements). Every write appends `recordChange(...)` from `src/lib/changes.ts` to its `db.batch([...])` (bumps list `version` + logs an `events` row atomically). Optional `X-Member-Id` header = actor for attribution (`actorFrom` in auth.ts). Pattern to reuse for expenses.
   - [x] Slice 3a: expenses. `GET|POST /api/expenses`, `PUT|DELETE /api/expenses/:id`. Body: `{description, amountPaise, paidOn, paidBy | payers[], split:{type: equal|exact|percent|shares, memberIds | entries}, categoryId?, note?, tags?: string[]}`; PUT also needs `revision`. Validation is the pure `parseExpenseInput` in `expense-input.ts` (unit tested). Stale revision -> 409 with the server copy in `current`. Zero-owed members are not stored in `expense_splits`. Tags are created by name on first use.
     - Concurrency: `revisionGuard` in `expenses.ts` is a statement inside the D1 batch that raises (`abs(min int64)` overflow) if the revision changed, rolling back the whole batch; the catch then maps it to 409. Verified: two parallel PUTs -> one 200, one 409, data intact.
     - Gotcha: `db.run(sql...)` type-checks but fails inside `db.batch` at runtime. Use query builders (`db.select({...}).from(...)`) for batch items.
   - [x] Slice 3b: `GET|POST /api/settlements` (`{fromMemberId, toMemberId, amountPaise, paidOn}` = "from paid to"), `DELETE /api/settlements/:id` (soft; settlements are not edited, delete and re-add), `GET /api/balances` -> `{version, balances{memberId: netPaise}, transfers[], totalSpentPaise}`. Verified end to end; 31 unit tests.
   - [x] Slice 4: `GET /api/changes?since=<version>` -> `{version, changed, events[{version, entity, entityId, action, actorMemberId, at}], hasMore}` (idle poll is one cheap response; `hasMore` means refetch everything). Rate limits in `src/lib/rate-limit.ts`: 120 writes/min per list (point lookup on the events log, no extra writes; enforced inside `authenticate(..., 'edit')`, returns 429 + Retry-After) and 10 list creations/hour per IP (`rate_limits` table, hashed IP, skipped when `CF-Connecting-IP` is absent i.e. local dev). Migration `0001_*`. Verified end to end.
5. [ ] UI (React islands + Tailwind, light/dark via system setting, mobile-first):
   - [x] Landing + create-list flow with share-link screen (`/`, `CreateList.tsx`, `MyLists.tsx`), list page `/l/[token]` (`ListApp.tsx`, `client:only="react"`, token read from the URL and sent as a Bearer header) with Expenses (read-only), Balances (+ "Mark as paid", undo payment) and People (add/remove) tabs, and the "Who are you?" picker. Tab is in the URL hash (`#balances`). Client code in `src/client/` (typed API client, localStorage helpers, `useListData` hook); it reuses `src/lib/money.ts`. Verified visually with headless Chrome screenshots.
   - [x] Add/edit/delete expense flow: `ExpenseForm.tsx` (bottom sheet on mobile) on top of the pure, unit-tested `src/client/expense-form.ts` (draft state, live split preview, `buildPayload`). All four split types, several payers, category, tags, note. Tap a row to edit; view-only links get no buttons. 409 conflict banner offers "Use their version" (adopts theirs and their revision) or "Save mine instead" (resends with their revision). Percent/share expenses reopen as exact amounts (server stores only resolved amounts). Errors/banners scroll into view. Verified with a real-browser flow (23 checks incl. a genuine two-user conflict, balances, view link, dark mode).
   - [ ] Activity feed; polish (empty states, loading skeletons)
   - Pages set `<meta name="referrer" content="no-referrer">` and `noindex` because URLs contain secret tokens.
6. [x] Live sync (in `src/client/useListData.ts`): polls `GET /api/changes?since=<version>` every 8s (`POLL_MS`) while the tab is visible; if the version moved it refetches everything and `describeChanges` (`src/client/activity.ts`) words a toast such as "Ravi added an expense" (own changes skipped). Pauses in hidden tabs, catches up on focus/visibilitychange/`online`, exponential backoff to 60s with an "Offline. Retrying…" pill. A sequence counter drops stale `reload` responses. The 409 conflict flow shipped with the expense form. Optimistic updates were skipped on purpose: every write reloads, which is simple and always consistent. Verified with a two-person real-browser test (live update in ~7s, toast, offline recovery, idle polling = only `/api/changes`).
7. [ ] Retention: soft delete/undo, JSON/CSV export, JSON import, Cron Trigger for archive/purge
8. [ ] Hardening and deploy: Turnstile on list creation, security headers, GitHub -> Cloudflare Pages, D1 migrations, README

## Commands
- `npm run dev` - Astro dev server
- `npm run build` - production build (output in `dist/`)
- `npm run preview` - build and serve with `wrangler pages dev`
- `npm test` - Vitest
- `npm run db:generate` - generate Drizzle migration; `db:migrate:local` / `db:migrate:remote` apply it to D1

## Setup still needed
- `wrangler.jsonc` has a placeholder `database_id`; run `npx wrangler d1 create divvyup` (needs Cloudflare login) and paste the id.
- The Cloudflare adapter enables Images and KV-session bindings by default; we don't need them, so disable them in `astro.config.mjs`.

## Environment gotchas (Windows)
- `git` is installed at `%LOCALAPPDATA%\Programs\Git\cmd` but is **not on PATH**. In PowerShell run `$env:Path += ";$env:LOCALAPPDATA\Programs\Git\cmd"` first.
- PowerShell 5.1 `Set-Content -Encoding utf8` writes a BOM, which breaks JSON parsing (`package.json`). Write files without a BOM (use the Write tool or `[IO.File]::WriteAllText` with `UTF8Encoding($false)`).
- npm blocked install scripts for `esbuild` and `workerd`. The build works; if wrangler or dev complains, run `npm install-scripts approve`.
- Testing against `astro dev`: stop it with `taskkill /PID <pid> /T /F` (plain `Stop-Process` leaves child processes holding the port, and the next run silently talks to the stale server). Local D1 state lives in `.wrangler/state`; apply migrations with `npm run db:migrate:local`.
- Visual check without a browser tool: run the dev server, seed data through the API, then `chrome.exe --headless=new --window-size=600,900 --virtual-time-budget=8000 --screenshot=<png> <url>` (Chrome is at `C:\Program Files\Google\Chrome\Application`). Headless Chrome has a minimum window width, so use 600 wide or more. The black strip at the bottom is Astro's dev toolbar.
- Real-browser UI testing that works here: `playwright-core` (install it outside the repo) cannot launch this Chrome over a pipe. Instead start `chrome.exe --headless=new --remote-debugging-port=9333 --user-data-dir=<temp dir> about:blank` yourself and use `chromium.connectOverCDP('http://127.0.0.1:9333')`. Islands are server-rendered first, so wait for hydration (`!document.querySelector('astro-island[ssr]')`) before typing or input is discarded. `devToolbar` is disabled in `astro.config.mjs` because it covers the bottom of small viewports and intercepts clicks.
- `/divvyup/` (nested folder) is an old clone of this repo with only a README. It is git-ignored; safe to delete.
