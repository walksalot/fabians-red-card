# UI Review Screenshot Library — Fabian's Red Card

Every PNG is a full-page capture (dark, deviceScaleFactor 2) at 390x844 unless the name says `-768`
(768x1024) or the line says element/viewport shot. League slug: `fabians-red-card`.

## How these were made (reproducible)

1. `DB_PATH=scratch/ui-review/db/base.db node scripts/seed-demo.mjs` — canonical demo world
   (12 users/entries, results entered for matches 1–11, picks on matches 1–16, boosters).
2. `node scratch/ui-review/build-scenarios.mjs` — clones base.db into five throwaway scenario DBs
   (mutations listed per shot below; all fabrication is display-only and lives in scratch/).
3. `node scratch/ui-review/capture.mjs [A-E]` + `node scratch/ui-review/capture-live-expanded.mjs` —
   boots `npm run dev -- --port 3210` per scenario with `DB_PATH`, `FAKE_NOW`,
   `SESSION_SECRET=ui-review-secret`, `SCHEDULER_DISABLED=1`, then drives Playwright.

Demo logins: members `sofia`/`marcus`/`chloe`/… with `demo-pass`; admin is `admin`/`demo-admin`
(display name "Fabian"). Invite link `/join/demo-invite-2026`, join password `redcard`.

## Scenario worlds

| World | DB | FAKE_NOW | Fabrication vs. base seed |
|---|---|---|---|
| A upcoming | db/upcoming.db | 2026-06-11T16:00:00Z | Matches 1–11 reset to scheduled (no results/points); DraftKings odds + first-goalscorer prices fabricated for matches 1–2 |
| B mixed | db/mixed.db | 2026-06-12T22:00:00Z | Matches 4–11 reset to scheduled; odds + scorer prices fabricated for match 4 (USA–PAR) |
| C finished | db/finished.db | 2026-06-12T06:00:00Z | Matches 3+ deleted outright to force the tournament-over fallback (only way Today renders an all-finished day) |
| D live | db/live.db | 2026-06-15T03:15:00Z | Match 12 (SWE–TUN, kicked off 02:00Z) given live feed fields: 1–0, clock 71', first scorer "Isak Hien" (SWE), status `in` |
| E tie | db/tie.db | 2026-06-15T03:15:00Z | Priya's picks, match_points and boosters replaced with exact copies of Sofia's → identical totals/exacts/scorer-hits/outcomes (true 1-1-3 tie) |

## Shots

### Today board
- `today-upcoming-390.png` — Today, all matches upcoming with saved picks; booster armed on KOR–CZE; odds strips + lock countdowns. World A, FAKE_NOW 2026-06-11T16:00Z, user sofia. Odds fabricated.
- `today-upcoming-768.png` — same state at 768px. World A, sofia.
- `today-scorer-dropdown-open-390.png` — pick form expanded (Edit), first-goalscorer combobox OPEN with odds-sorted squad list (Raúl Jiménez +330 …). Viewport shot. World A, sofia. Scorer prices fabricated.
- `today-scorer-dropdown-open-full-390.png` — same moment, full page. World A, sofia.
- `today-future-day-390.png` — day browser on a FUTURE matchday (`?day=2026-06-12`, "future matchday" caption, odds-appear-later notice). World A, sofia.
- `today-day-picker-open-390.png` — the all-days picker sheet open (pick-progress chips, booster-armed marker, TODAY badge). Viewport shot. World A, sofia.
- `today-mixed-miss-390.png` — THE commissioning scenario: CAN–BIH full-time 3–0 + USA–PAR upcoming 9:00 PM ET, viewer's pick MISSED ("No points this match"). World B, FAKE_NOW 2026-06-12T22:00Z, user sofia.
- `today-mixed-hit-exact-scorer-390.png` — same board, EXACT + scorer + first-team hit (chips Exact +10 / Scorer +8 / First team +2 → +20 pts). World B, marcus.
- `today-mixed-scorer-hit-390.png` — same board, scorer hit but score wrong (+10 via Scorer +8, First team +2). World B, chloe.
- `today-mixed-768.png` — mixed board at 768px. World B, sofia.
- `today-finished-390.png` — Today with EVERY match finished: one big boosted hit (Exact+Scorer+First ×2 booster → +40) and one miss. World C, FAKE_NOW 2026-06-12T06:00Z, sofia. Fabricated: matches 3+ deleted.
- `today-finished-768.png` — same at 768px. World C, sofia.
- `today-live-390.png` — LIVE match: SWE 1–0 TUN at 71' carryover card (red live border, "Right result · if it holds"), live ticker banner, plus the upcoming June 15 slate. World D, FAKE_NOW 2026-06-15T03:15Z, sofia. Live feed fields fabricated.
- `today-live-768.png` — same at 768px. World D, sofia.
- `today-live-board-expanded-390.png` — the "if it ended now" provisional board EXPANDED: all 12 entries with live engine points (W/EX/1st chips). World D, sofia.
- `today-live-board-expanded-768.png` — same at 768px. World D, sofia.

### Table
- `table-collapsed-390.png` — leaderboard collapsed; prize pool $300 with 1st/2nd/3rd split; live SWE–TUN ticker on top; red card on last place (Fabian, rank 12). World D, sofia.
- `table-expanded-390.png` — Sofia's row EXPANDED: locked picks for Sun Jun 14 with per-match result/exact/scorer chips + the live fixture row. World D, sofia.
- `table-lastplace-redcard-390.png` — element zoom of the last-place row: red-card easter egg next to Fabian. World D, sofia.
- `table-tie-390.png` — TIE state: Priya & Sofia share rank 1 at 86 pts (identical on all four tiebreak keys), Marcus is rank 3 → 1-1-3; "Dead level … on every tiebreaker" banner. World E, sofia. Tie fabricated.
- `table-tie-expanded-390.png` — tie board with the second tied row expanded. World E, sofia.

### Rules / History / Profile
- `rules-390.png` — full Rules page in one full-page capture (auto-generated from league settings). World D, sofia.
- `history-390.png` — History with 11 finished matches and per-match points. World D, sofia.
- `profile-390.png` — Profile: 86 pts hero, exact/scorer/outcome/accuracy stats, streaks, recent form, badges (First Exact, Sniper, Hot Streak, Ever Present). World D, sofia.

### Auth / Join
- `login-390.png` — login. World D, logged out.
- `register-390.png` — register. World D, logged out.
- `join-invite-390.png` — invite-link join page (`/join/demo-invite-2026`): "YOU ARE INVITED", member avatars, create-account form. World D, logged out.

### Admin (user: admin / "Fabian")
- `admin-full-390.png` — the entire admin page, full-page (very tall; section zooms below). World D.
- `admin-invite-390.png` — element shot, #invite (invite link + join password box).
- `admin-settings-390.png` — element shot, #settings (league settings form: buy-in, payout split, scoring values, booster, automation).
- `admin-members-390.png` — element shot, #members (member list with roles/removal).
- `admin-results-entry-390.png` — element shot, #results (manual result entry: scores, first scorer, first team; SWE–TUN awaiting result).
- `admin-knockout-teams-390.png` — element shot, #fixtures (knockout bracket team assignment for TBD fixtures).
- `admin-underdog-picker-390.png` — element shot, #underdog (underdog bonus picker for upcoming matches).

## Not captured / caveats
- A *naturally occurring* all-finished Today board: the board, by design, advances to the next day
  the moment a day is fully settled (src/lib/services/today.ts:71-97), so World C deletes matches 3+
  to trigger the end-of-tournament fallback — visually identical, but the world is truncated.
- Multi-entry EntrySwitcher: league is seeded with `entries_per_user=1`, so the switcher never
  renders (src/app/league/[slug]/today/page.tsx:268-273 gates it on `entries.length > 1`).
- Live shot nit: the fabricated first scorer is "Isak Hien" (a real SWE squad name the fuzzy
  match landed on) rather than Alexander Isak — cosmetic only.
- Full-page captures place the fixed bottom tab bar once within the first viewport-height of the
  stitched image (Playwright fullPage behavior); viewport shots (`*-open-390`) show true placement.
