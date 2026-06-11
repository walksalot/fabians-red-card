# Fabian's Red Card — World Cup 2026 Prediction Pool

**👀 Click around the demo:** https://walksalot.github.io/fabians-red-card/
*(read-only preview with sample data — the real app is fully interactive; see `DEPLOY.md` to put the real league online in ~5 minutes)*

A private prediction pool website for your friend group. Everyone joins your league with
one link, predicts the **exact score** and **first goalscorer** for every World Cup match
(all 104 of them, group stage included), and battles on a live leaderboard. You enter the
results — no API keys, no subscriptions, no payments processed.

## What's in the box

- **Today** — today's matches with pick entry; picks lock automatically at kickoff
- **Table** — live leaderboard: rank, points, exact scores, scorer hits, prize pool
- **Rules & Prizes** — scoring, payouts, tiebreakers, booster rules (auto-generated from your settings)
- **History** — every past pick, result, and points breakdown
- **Profile** — stats, accuracy, streaks, badges
- **Admin** — league settings, members, results entry, knockout teams, underdog flags

Scoring (all editable in Admin → Settings): exact score **10**, right winner/draw **2**,
first goalscorer **8**, first team to score **2**, underdog win bonus **5**. Each player
gets **one booster per matchday** that multiplies one match's points (×2 by default), and
you can set extra multipliers for knockout rounds.

## Running it (one-time setup, ~5 minutes)

You need [Node.js](https://nodejs.org) 20 or newer installed. Then, in this folder:

```bash
npm install        # downloads dependencies (one time)
npm run setup      # creates the database with all 104 matches and prints your admin login
npm run build      # prepares the production app (one time, and after any update)
npm start          # starts the website on http://localhost:3000
```

**`npm run setup` prints your admin username, password, and the invite link — save them!**
It only does this the very first time; it will never overwrite your data if run again.

Send friends the invite link (`http://YOUR-ADDRESS/join/xxxxxxxx`). They tap it, choose a
display name and password, and they're in. No emails, no verification.

## Putting it online for your friends

The app is a single small server with one database file — any of these works:

1. **A cheap VPS** (DigitalOcean/Hetzner/Lightsail, ~$5/mo): install Node, copy this
   folder, run the four commands above, and put it behind the provider's firewall with
   port 3000 open (or add Caddy/nginx for HTTPS — recommended since everyone logs in).
2. **A spare computer at home** + a tunnel like Cloudflare Tunnel or Tailscale Funnel
   (both have free tiers) so friends can reach it.

Either way: the **entire pool lives in one file: `.data/app.db`**. Copy that file
somewhere safe now and then (especially before updates) and you can never lose the pool.

> Security note: `npm run setup` generates a private `SESSION_SECRET` in `.env.local`.
> Don't share that file or `.data/`, and use HTTPS if the site is on the open internet.

## Admin guide (running the pool)

Open **Admin** (last tab — only you see it) on your phone:

- **Entering results (your match-night job):** Admin → Results. Find the match, type the
  final score, the first goalscorer's name, and which team scored first, hit save.
  Points and the leaderboard update for everyone instantly. Made a typo? Re-enter and
  save again — everything recomputes.
  - *Scorer names:* matching ignores case and accents ("mbappe" = "Mbappé"), but spelling
    must otherwise match what players typed. Eyeball the picks shown for the match and be
    generous when adjudicating your own typing.
  - *0–0 games:* enter 0 and 0; "first team to score" flips to "none" automatically.
- **Knockout rounds:** once a bracket slot is decided, Admin → Knockout teams: pick the
  two teams for each match so everyone can make picks. (Group-stage games come pre-loaded.)
- **Underdog bonus:** before a match, optionally flag one side as the underdog in Admin →
  Underdog. Players who predicted an underdog win get +5 if it happens. No flag = no bonus.
- **League settings:** name, private/public, join password, entries per player (default 1),
  buy-in amount, payout split (60/30/10 by default), booster multiplier, knockout round
  multipliers, and every scoring value. Changing scoring re-scores already-finished
  matches automatically.
- **Members:** see everyone, remove someone (this deletes their picks).
- **Buy-ins and payouts are display-only.** The app shows the pot (buy-in × entries) and
  the split; collecting and paying out stays in Venmo/your group chat, where it belongs.

## For developers

```bash
npm run typecheck   # TypeScript
npm run lint        # ESLint
npm test            # unit + integration tests (Vitest)
npm run test:e2e    # full mobile-viewport journey test (Playwright)
npm run seed        # (re)seed schedule — never overwrites results or users
```

Stack: Next.js (App Router) · SQLite (better-sqlite3 + Drizzle) · Tailwind · Vitest ·
Playwright. Architecture contract in `CONTRACTS.md`. The official 104-match schedule
lives in `data/fixtures.json` / `data/teams.json` (kickoffs in UTC, verified against
official sources); `scripts/validate-fixtures.mjs` re-checks its structure any time.

Also in the box (all optional, all free, no API keys):

- **Automatic results** — during match windows the server fills in final scores, first
  goalscorers, live in-progress scores, and knockout bracket teams from ESPN's free
  public feed. Manual entry always works and always wins: anything you type is marked
  yours and the robot never touches it. Toggle in Admin → Settings ("Automatic results").
- **Calendar reminders** — friends subscribe to `/api/calendar` once and their own phone
  reminds them before each kickoff (the Today screen shows countdowns too).
- **Daily backups** — the server snapshots the database to `.data/backups` once a day;
  `npm run backup` does it on demand.

Not included by design: payment processing (the pot is display-only).
