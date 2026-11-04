# DivvyUp

Split expenses with friends, for free. Make a list, add the people, log who paid what, and DivvyUp works out who owes whom. There are no accounts: you share a link, and everyone with it can add expenses and see updates as they happen.

Amounts are in Indian rupees (₹). It runs entirely on Cloudflare's free tier.

## Features

- **Lists with secret links.** An *edit link* lets people add and change expenses; a *view-only link* lets them look. Nobody signs up.
- **Flexible splits.** Equal, exact amounts, percentages or shares, with one or several people paying. Odd paise are shared out deterministically, so totals always match to the paisa.
- **Balances and settle-up.** See who is owed what, get a minimal set of suggested payments, and record payments as they happen.
- **Live updates.** When someone else changes the list, your screen updates and tells you who did what. Two people editing the same expense get a clear "someone changed this" choice instead of silently overwriting each other.
- **Your data stays yours.** Download a full JSON backup or a CSV for spreadsheets, import a backup into a new list, and restore anything deleted in the last 90 days.

## How it works

- **Astro** (server mode) with **React** islands and **Tailwind**, deployed as one **Cloudflare Worker** with static assets.
- **Cloudflare D1** (SQLite) stores everything, accessed with **Drizzle ORM**. Money is stored as integer paise, never floats.
- Access is by secret token in the link; only SHA-256 hashes of tokens are stored. The token travels in an `Authorization` header, not in API URLs.
- Live sync polls a tiny "what changed since version N?" endpoint and backs off when the list is quiet.

See [CLAUDE.md](CLAUDE.md) for the full design notes, API contract and project history.

## Run it locally

You need Node 20 or newer.

```bash
npm install
npm run db:migrate:local   # creates the local database
npm run dev                # http://localhost:4321
```

Useful commands:

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests (Vitest) |
| `npx tsc --noEmit` | Type check (the build does not type check) |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Build and run the real Worker locally with `wrangler` (includes the security headers and CSP, which `npm run dev` does not) |
| `npm run db:generate` | Generate a migration after changing `src/lib/schema.ts` |

To try the CAPTCHA locally, copy `.dev.vars.example` to `.dev.vars` (see [Turnstile](#optional-turnstile-captcha)).

## Deploy to Cloudflare (free)

One-time setup. You need a free Cloudflare account.

1. **Log in.**
   ```bash
   npx wrangler login
   ```
2. **Create the database** and copy the `database_id` it prints into [wrangler.jsonc](wrangler.jsonc).
   ```bash
   npx wrangler d1 create divvyup
   ```
3. **Create the tables** in the real database.
   ```bash
   npm run db:migrate:remote
   ```
4. **Deploy.**
   ```bash
   npm run deploy
   ```
   Wrangler prints your address, like `https://divvyup.<your-subdomain>.workers.dev`. Open it, create a list, and you are live.

After that, deploy changes with `npm run deploy`. If you change the database schema, run `npm run db:generate`, commit the new file in `migrations/`, and run `npm run db:migrate:remote` **before** deploying.

### Deploy automatically from GitHub (optional)

In the Cloudflare dashboard go to **Workers & Pages → Create → Import a repository**, pick this repo, and set:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`

Every push to `main` then deploys. Database migrations are still a manual `npm run db:migrate:remote`, so a schema change cannot break a live app by accident.

### Optional: Turnstile CAPTCHA

Without it anyone can create lists (still limited to 10 per hour per IP). Turnstile is free and stops bots creating lists in bulk.

1. In the dashboard open **Turnstile → Add widget**, enter your `workers.dev` hostname (or custom domain), and choose *Managed*.
2. Add the **site key** (public) to [wrangler.jsonc](wrangler.jsonc):
   ```jsonc
   "vars": { "TURNSTILE_SITE_KEY": "0x4AAAA..." }
   ```
3. Store the **secret key** (private) with Wrangler. Never put it in a file.
   ```bash
   npx wrangler secret put TURNSTILE_SECRET
   ```
4. Run `npm run deploy` again.

Once the secret is set, creating or importing a list needs a solved check. To switch it off, delete the secret with `npx wrangler secret delete TURNSTILE_SECRET`.

## Free-tier limits

| Resource | Free allowance | What uses it |
| --- | --- | --- |
| Worker requests | 100,000 / day | Every page load, API call and live-sync poll |
| D1 storage | 5 GB | Lists, expenses, the change log |
| D1 reads / writes | 5 million / 100,000 rows per day | Every request reads; each expense writes a handful of rows |

A tab left open polls every 8 seconds at first, then every 15 and finally 30 seconds while the list is quiet, and stops entirely in a background tab. A group of friends will sit far below these limits.

## Your data

- **Back up** from any list's **More** tab: JSON (complete, can be imported) or CSV (for spreadsheets).
- **Restore** from **More → Recently deleted**. Deleted expenses and payments are kept for 90 days, then permanently removed. Lists themselves are never removed automatically.
- **Import** a JSON backup from the home page. It always creates a *new* list with new links.
- **Lost links cannot be recovered**, because there are no accounts. Keep the edit link somewhere safe, for example in a pinned chat message.

## Security notes

- Anyone with an edit link can change that list, so treat it like a password. Share the view-only link when people only need to look.
- Pages are sent with a strict Content-Security-Policy (scripts are hashed, not blanket-allowed), `Referrer-Policy: no-referrer` so link tokens never leak to other sites, and headers that stop the app being framed or content-sniffed.
- Writes to one list are limited to 120 per minute and list creation to 10 per hour per IP.

## Project layout

```
src/pages/        Astro pages (/, /l/[token]) and the JSON API under api/
src/lib/          Server logic: schema, money, splits, balances, import/export, trash, rate limits
src/client/       Browser logic: API client, expense form model, live-sync hook
src/components/   React components
src/middleware.ts Security headers
migrations/       SQL migrations for D1 (generated by Drizzle)
```
