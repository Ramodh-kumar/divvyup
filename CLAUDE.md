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
4. [ ] API: create list, token auth middleware, CRUD (members, expenses, settlements), changes feed, rate limiting
5. [ ] UI: landing/create-list, list view (expenses, balances, settle-up, activity), expense form, "I am" picker, mobile-first
6. [ ] Live sync: polling hook, 409 conflict flow, optimistic updates
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
- `/divvyup/` (nested folder) is an old clone of this repo with only a README. It is git-ignored; safe to delete.
