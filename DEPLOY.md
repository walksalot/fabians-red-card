# Putting the pool online (no coding required)

This guide is for a non-technical owner. You'll have the real, shared app — the
one your friends log into and play for the whole tournament — live on the
internet. Pick **one** option below. Railway is the easiest.

The whole pool lives in one database file on a "volume" (a little permanent disk).
As long as that volume sticks around, you never lose picks, scores, or members.

---

## Option A — Railway (recommended, ~$5/month)

1. Go to **railway.com** and sign in with GitHub.
2. Click **New Project → Deploy from GitHub repo** and choose
   **`walksalot/fabians-red-card`**. Railway sees the included `Dockerfile` and
   builds it automatically.
3. Open the service → **Variables** and add one variable:
   - `DB_PATH` = `/data/app.db`
   *(You do not need to set a password secret — the app makes and remembers its
   own on the volume.)*
4. Open **Settings → Volumes → New Volume**, mount path **`/data`**. This is the
   permanent disk that holds the pool. (Size 1 GB is plenty.)
5. Open **Settings → Networking → Generate Domain**. That URL is your pool.
6. Open the URL once it's live, then read the deploy **Logs** — on the very first
   start the app prints your **admin username, admin password, and invite link**.
   Save those. (Want to set the admin password yourself instead of using the
   printed one? Add a variable `ADMIN_PASSWORD` before the first deploy.)
7. Share the **invite link** (`https://your-url/join/...`) in the group chat.
   Done.

To update later: push changes to GitHub (or click **Redeploy**). Your data
stays — the volume isn't touched.

---

## Option B — Fly.io (has a small free allowance)

1. Install the Fly CLI and run `fly launch` in this folder — it detects the
   `Dockerfile`.
2. When asked, **create a volume** and mount it at `/data`, and set
   `DB_PATH=/data/app.db` (`fly secrets set DB_PATH=/data/app.db` or in
   `fly.toml`).
3. `fly deploy`, then `fly logs` to read the first-run admin credentials.

---

## Option C — Any Docker host

The repo is a standard Docker app:

```bash
docker build -t fabians-red-card .
docker run -p 3000:3000 -v fabianpool:/data -e DB_PATH=/data/app.db fabians-red-card
```

First-run admin credentials print in the container logs. The named volume
`fabianpool` keeps your data across restarts.

---

## After it's live

- **Automatic results are on by default**: the app fills in final scores and the
  first goalscorer from a free public feed during match windows, and updates the
  leaderboard for everyone. You can still enter or correct any result by hand in
  **Admin → Results** — anything you type wins and is never overwritten. Turn the
  automation off anytime with the **Automatic results** switch in Admin → Settings.
- **Kickoff reminders**: anyone can add the schedule to their phone calendar by
  subscribing to `https://your-url/api/calendar` — their own calendar reminds
  them before each match. No nagging needed.
- **Backups**: the app saves a dated copy of the database to `/data/backups`
  every day automatically. To grab one manually, run `npm run backup`.
- **Money**: buy-ins and payouts are display-only. Collect and pay out in
  Venmo/your group chat as usual.

See `README.md` for the full admin guide.
