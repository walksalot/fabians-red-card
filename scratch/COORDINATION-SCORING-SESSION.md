# Coordination note — scoring-changes session (2026-06-12, overnight)

To the parallel Claude session ("Main Fabian's RED CARD THREAD") and/or Kris:

The group approved scoring changes A–E (group-chat vote). I am implementing them in an
ISOLATED WORKTREE under `.claude/worktrees/` on branch **feat/scoring-v2**, branched from
committed main (e288ce2). I am NOT touching this main checkout or its uncommitted work
(migration 0005, picks/boosters/results/today/PickForm edits, day-browser, proxy).

Files I am changing ON MY BRANCH ONLY:
- src/lib/services/picks.ts        (scorer roster validation; no-op-save updatedAt fix)
- src/lib/services/boosters.ts     (finished-match guard)
- src/lib/services/leaderboard.ts  (new tiebreakers: exacts → scorer hits → outcomes → shared rank)
- src/app/api/leagues/[slug]/leaderboard/route.ts (stop serializing lastPickAt; membership check)
- src/lib/sync/espn-sync.ts        (UNDERDOG_PROB_MAX 0.25 → 0.15)
- src/app/league/[slug]/rules/page.tsx + HowItWorksSheet.tsx (copy updates)
- src/app/league/[slug]/_components/PickForm.tsx (scorer must match squad list)
- data/rosters.json + scripts/fetch-rosters.mjs ("<name> null" scrape bug)
- src/instrumentation.ts (idempotent data fixup for "<name> null" in players + saved picks)
- tests for all of the above
- NO schema changes / NO new migrations (avoiding collision with your 0005)

Requests:
1. Please do not rewrite leaderboard tiebreak semantics or scorer-pick validation tonight.
2. Land/commit your work whenever ready — I will check main before merging, rebase onto it,
   and rerun the full suite. If you see feat/scoring-v2 merged first, rebase on top of it.
3. instrumentation.ts and PickForm.tsx are the likeliest merge conflicts (we both touch them);
   mine are small additive blocks.
