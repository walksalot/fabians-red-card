# access

## SUMMARY
ACCESS + INFORMATION lens on the live $600 pool. The core pre-kickoff privacy model is sound: across every path audited (Today board, day-browser future days, the live 'if it ended now' board, the leaderboard locked-picks reveal, History, and the public .ics calendar), other entries' picks and booster placements are never serialized before their match kicks off. today.ts ships only the caller's own pick; live.ts and leaderboard-picks.ts hard-filter to matches already kicked off or finished; the calendar exposes only the public schedule. Booster placements of others surface only once the boosted match kicks off, by which point the booster is already locked, so there is no strategy-intel leak. Lock integrity is correct: every write path checks the server clock (clock.ts, FAKE_NOW-aware) against kickoff and rejects at/after kickoff, and admin-only result/team/underdog routes are double-gated. The real exposures are not pre-kickoff leaks but: (1) sock-puppet multi-entry hedging bypassing entriesPerUser via open registration, (2) an authz inconsistency where the leaderboard API requires only login not membership, (3) client-controlled X-Forwarded-For driving the login rate-limit key (deployment-dependent brute-force bypass), and (4) predScorer accepted with no roster validation enabling a common-surname scoring trick. None let a player see rivals' hidden picks early; they are integrity/fairness gaps, not information leaks.

## RISKS
- [medium/high] Sock-puppet second account defeats one-entry-per-player (hedging)
  evidence: src/app/api/auth/register/route.ts:19-25; src/lib/services/leagues.ts:249-273; src/db/schema.ts:26
  Registration is open (no email/identity, only IP rate-limited 20/hr) and entriesPerUser is enforced per-USER not per-person. A friend can register a throwaway account, join via the shared invite link or password, and field a second independent entry. In a 60/30/10 winner-take-most split, controlling two top-3 slots captures up to 90% of the ~$600 pot. The app cannot detect this; only the commissioner eyeballing the member list catches it. Mechanism: open register -> join -> each user gets exactly one entry, so N accounts = N entries.
- [low/high] Leaderboard API requires only login, not league membership
  evidence: src/app/api/leagues/[slug]/leaderboard/route.ts:20; src/app/api/leagues/[slug]/live/route.ts:21; src/lib/calendar.ts:105
  Every other league data route uses requireOwnedEntry or requireMember, but /api/leagues/[slug]/leaderboard calls only requireUser. Any logged-in account can fetch standings, every entry's display name, today-delta, and the locked-picks reveal for a league it is not a member of, even when the page redirects non-members away. Fairness impact is low because the data is post-kickoff/public, but it is an authz inconsistency leaking the roster and locked predictions to outsiders who know the slug (exposed in the public calendar deep link).
- [medium/low] Login rate-limit key trusts client X-Forwarded-For (brute-force bypass)
  evidence: src/lib/rate-limit.ts:54-58; src/app/api/auth/login/route.ts:21-22; src/lib/services/leagues.ts:65-70
  clientIp() takes the first hop of the client-supplied X-Forwarded-For header verbatim as the rate-limit key. If the deployment does not sit behind a proxy that overwrites XFF, an attacker can rotate a spoofed XFF per request to mint fresh login buckets, defeating the 10-per-15-min cap and brute-forcing a friend's 8-char-minimum password. Account takeover means control of that player's entry. Severity hinges on whether the host sanitizes XFF, hence low confidence.
- [low/medium] predScorer accepted with no roster validation (common-surname trick)
  evidence: src/app/api/picks/route.ts:12-18; src/lib/services/picks.ts:66-77,108
  The picks API and service accept any free-text predScorer (the UI offers a roster dropdown, but the API does not constrain to it). Scoring matches by suffix-token, so a player can enter a widespread surname shared by several likely scorers to raise the probability the actual first scorer suffix-matches, harvesting the scorer bonus more often than an honest single-name pick. Harmless inconsistency: zod allows 120 chars but the service rejects over 80 with a 400.

## FACTS
- (Pre-kickoff privacy (Today board)) getTodayBoard serializes only the requesting entry's own pick (myPick); no other entry's picks/boosters are included, including for future day-browser days.
  [src/lib/services/today.ts:160-168; src/app/league/[slug]/today/page.tsx:210-225]
- (Pre-kickoff privacy (live board)) The live board only includes matches where now>=kickoff, so every pick/booster it reveals is already public under reveal-at-kickoff.
  [src/lib/services/live.ts:58-67,126-151]
- (Pre-kickoff privacy (leaderboard reveal)) getLockedPicksByEntry only emits picks for finished or kicked-off matches on the latest kicked-off day; an unkicked unfinished match on the same day is excluded, so editable picks never leak.
  [src/app/league/[slug]/_components/leaderboard-picks.ts:44-62]
- (Lock integrity (picks)) upsertPick returns 409 when status is finished OR nowMs()>=kickoff; clock is server-authoritative via clock.ts.
  [src/lib/services/picks.ts:52-55,101-103; src/lib/clock.ts:5-12]
- (Lock integrity (boosters)) setBooster/clearBooster reject once the holding match kicks off and reject TBD/finished targets; others' boosters only revealed post-kickoff when already locked.
  [src/lib/services/boosters.ts:58-65,82-92,183-185]
- (Calendar export) The public .ics feed exposes only the match schedule and a deep link; no league/player/pick data.
  [src/app/api/calendar/route.ts:12-25; src/lib/calendar.ts:86-114]
- (Admin write gating) results/teams/underdog routes require requireResultsAdmin (admin of the lowest-id primary league), so a friend who creates their own league cannot enter tournament results.
  [src/app/api/results/route.ts:24; src/lib/services/results.ts:50-71]
- (Join idempotency) joinLeague returns the existing entry when already a member, so repeated joins cannot mint extra entries within one account.
  [src/lib/services/leagues.ts:249-273]
- (Within-account entry cap) addEntry enforces entriesPerUser (default 1) and has no exposed API route, so one account cannot exceed its cap.
  [src/lib/services/leagues.ts:500-527; src/db/schema.ts:26]
- (Score bounds) predHome/predAway bounded 0-20 at both the zod edge and the service; matchId 1-104; no negative/absurd scores.
  [src/app/api/picks/route.ts:8-13; src/lib/services/picks.ts:57-64]
