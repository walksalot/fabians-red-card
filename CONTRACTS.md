# CONTRACTS — World Cup 2026 Prediction Pool ("Fabian's Red Card")

This file is the **single source of truth** for every module in this app. All agents and
contributors MUST build against these exact shapes. If something here seems wrong, fix your
code, not the contract (integrator resolves contract bugs).

## Product summary

Private World Cup 2026 prediction pool for a friend group (~15 players). Users join a league
via invite link or league password, predict **exact score + first goalscorer + first team to
score** for all 104 matches, earn points, compete on a live leaderboard. Admin enters results
manually. Prize pool is display-only. Dark, mobile-first UI.

## Stack

- Next.js (App Router, TypeScript, `src/` dir, `@/*` alias), Tailwind CSS v4
- SQLite via `better-sqlite3` + Drizzle ORM (`drizzle-orm/better-sqlite3`)
- Auth: username+password (bcryptjs), stateless JWT session cookie (jose, HS256)
- Validation: zod at every API boundary
- Tests: Vitest (unit/integration, in-memory SQLite), Playwright (e2e, 390px dark)
- No external paid services. No payment processing. Live updates via client polling (30s).

## Conventions

- DB file path: `process.env.DB_PATH ?? '.data/app.db'`. Tests use `:memory:`.
- Time: `now()` from `@/lib/clock` EVERYWHERE (never `new Date()` for logic). `clock.now()`
  returns `new Date(process.env.FAKE_NOW)` when `FAKE_NOW` is set (tests/e2e), else real time.
- All kickoff times stored as UTC ISO strings `YYYY-MM-DDTHH:MM:00Z`.
- `matchday` = the calendar date (YYYY-MM-DD) of kickoff in **America/New_York** (precomputed
  in seed; never recomputed client-side).
- API response envelope: success `{ ok: true, data: <payload> }`, failure
  `{ ok: false, error: string }` with proper HTTP status. Route handlers are THIN: parse with
  zod, check session, call service, map errors.
- Services throw `AppError(message, status)` (from `@/lib/errors`); routes catch and map.
  Unknown errors → 500 generic message (never leak internals).
- Money stored as integer cents. Percent splits as integer arrays summing to 100.
- IDs: integer autoincrement PKs. Matches use official FIFA match number as PK (1..104).
- All writes that derive from league scoring settings must call `recomputeLeague`/
  `recomputeMatch` (see Results service) so points are never stale.

## Database schema (Drizzle, `src/db/schema.ts`) — FROZEN

```
users:        id PK, username TEXT UNIQUE NOT NULL (stored lowercase), displayName TEXT NOT NULL,
              passwordHash TEXT NOT NULL, createdAt INTEGER NOT NULL (epoch ms)
leagues:      id PK, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, inviteToken TEXT UNIQUE NOT NULL,
              joinPasswordHash TEXT NULL, isPrivate INTEGER NOT NULL DEFAULT 1,
              buyInCents INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'USD',
              entriesPerUser INTEGER NOT NULL DEFAULT 1,
              payoutSplit TEXT NOT NULL DEFAULT '[60,30,10]'           -- JSON int[] sums to 100
              scoringRules TEXT NOT NULL DEFAULT '{"exact":10,"outcome":2,"scorer":8,"firstTeam":2,"underdog":5}',
              boosterMultiplier REAL NOT NULL DEFAULT 2,
              roundMultipliers TEXT NOT NULL DEFAULT '{"group":1,"r32":1,"r16":1,"qf":1,"sf":1,"third":1,"final":1}',
              adminUserId INTEGER NOT NULL REFERENCES users.id, createdAt INTEGER NOT NULL
memberships:  id PK, leagueId FK, userId FK, role TEXT NOT NULL ('admin'|'member'),
              createdAt INTEGER NOT NULL, UNIQUE(leagueId, userId)
entries:      id PK, leagueId FK, userId FK, label TEXT NOT NULL, createdAt INTEGER NOT NULL
teams:        id PK (seeded, no autoincr), code TEXT UNIQUE NOT NULL (FIFA 3-letter),
              name TEXT NOT NULL, groupLetter TEXT NOT NULL ('A'..'L')
matches:      id PK = official match number 1..104, stage TEXT NOT NULL
              ('group'|'r32'|'r16'|'qf'|'sf'|'third'|'final'), groupLetter TEXT NULL,
              homeTeamId INTEGER NULL FK, awayTeamId INTEGER NULL FK,
              homePlaceholder TEXT NULL, awayPlaceholder TEXT NULL,   -- knockout labels
              kickoffUtc TEXT NOT NULL, matchday TEXT NOT NULL, venue TEXT NOT NULL,
              city TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'scheduled' ('scheduled'|'finished'),
              homeScore INTEGER NULL, awayScore INTEGER NULL, firstScorer TEXT NULL,
              firstScoringTeam TEXT NULL ('home'|'away'|'none'), underdogTeamId INTEGER NULL
picks:        id PK, entryId FK, matchId FK, predHome INTEGER NOT NULL, predAway INTEGER NOT NULL,
              predScorer TEXT NULL, predFirstTeam TEXT NULL ('home'|'away'|'none'),
              createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, UNIQUE(entryId, matchId)
boosters:     id PK, entryId FK, matchday TEXT NOT NULL, matchId FK NOT NULL,
              createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, UNIQUE(entryId, matchday)
matchPoints:  id PK, entryId FK, matchId FK, breakdown TEXT NOT NULL (JSON PointsBreakdown),
              total REAL NOT NULL, UNIQUE(entryId, matchId)
```

`src/db/index.ts` exports `getDb(): BetterSQLite3Database<typeof schema>` (singleton per
DB_PATH; applies migrations from `drizzle/` on first open) and `createTestDb()` for tests
(`:memory:`, migrations applied, returns same type).

## Scoring engine (`src/lib/scoring.ts`) — FROZEN, PURE (no imports beyond types)

```ts
export type Stage = 'group'|'r32'|'r16'|'qf'|'sf'|'third'|'final';
export interface ScoringRules { exact: number; outcome: number; scorer: number;
  firstTeam: number; underdog: number }
export interface PickInput { predHome: number; predAway: number;
  predScorer: string | null; predFirstTeam: 'home'|'away'|'none'|null }
export interface ResultInput { homeScore: number; awayScore: number;
  firstScorer: string | null; firstScoringTeam: 'home'|'away'|'none';
  underdogSide: 'home'|'away'|null; stage: Stage }
export interface PointsBreakdown { exact: number; outcome: number; scorer: number;
  firstTeam: number; underdog: number; base: number; roundMultiplier: number;
  boosterMultiplier: number; total: number }
export function normalizeName(s: string): string   // lowercase, trim, collapse ws, strip
                                                   // diacritics (NFD), drop '.'
export function scorePick(pick: PickInput, result: ResultInput, rules: ScoringRules,
  opts: { roundMultiplier: number; boosted: boolean; boosterMultiplier: number }): PointsBreakdown
```

Rules (base components sum, then multipliers):
- exact: predicted score identical → `rules.exact` (10). Outcome NOT also awarded when exact.
- outcome (consolation): not exact but same result sign (home win / draw / away win) →
  `rules.outcome` (2).
- scorer: `normalizeName(predScorer) === normalizeName(result.firstScorer)`, both non-null,
  non-empty → `rules.scorer` (8).
- firstTeam: `predFirstTeam !== null && predFirstTeam === result.firstScoringTeam` →
  `rules.firstTeam` (2). ('none' counts: correctly calling 0-0.)
- underdog: `result.underdogSide !== null` AND pick predicts that side wins AND that side
  actually won → `rules.underdog` (5).
- `base = exact+outcome+scorer+firstTeam+underdog`;
  `total = base * roundMultiplier * (boosted ? boosterMultiplier : 1)`.

## Services (all in `src/lib/services/*.ts`; first arg is always `db` returned by getDb/createTestDb)

### leagues.ts
```ts
createUser(db, { username, displayName, password }): Promise<{ id, username, displayName }>
verifyLogin(db, { username, password }): Promise<{ id, username, displayName }>  // throws 401
createLeague(db, userId, { name, buyInCents?, joinPassword? }): Promise<League>  // creator =
  // admin membership + first entry; slug from name (unique-suffixed); inviteToken = 24-char hex
getLeagueBySlug(db, slug), getLeagueByInviteToken(db, token)
joinByInviteToken(db, userId, token): Promise<{ league, entry }>      // no password needed
joinByPassword(db, userId, slug, password): Promise<{ league, entry }> // throws 403 bad pw
  // both: idempotent if already member; creates membership + entry #1 (label=displayName)
updateLeagueSettings(db, leagueId, adminUserId, partial): Promise<League>
  // name, isPrivate, joinPassword (string sets, null clears), entriesPerUser (1..10),
  // buyInCents, payoutSplit, scoringRules, boosterMultiplier, roundMultipliers.
  // throws 403 if not admin. If scoringRules/boosterMultiplier/roundMultipliers changed →
  // recomputeLeague(db, leagueId).
removeMember(db, leagueId, adminUserId, targetUserId)  // deletes membership+entries+picks+
  // boosters+matchPoints for that user in this league; admin cannot remove self
addEntry(db, userId, leagueId, label): Promise<Entry>  // throws 403 when count >= entriesPerUser
listMembers(db, leagueId): { userId, displayName, role, entryCount }[]
prizePool(league, entryCount): { totalCents, payouts: { place, percent, amountCents }[] }
  // totalCents = buyInCents * entryCount; payouts from payoutSplit
```

### picks.ts
```ts
upsertPick(db, userId, { entryId, matchId, predHome, predAway, predScorer, predFirstTeam })
  // throws 403 if entry not owned by user; 409 'locked' if clock.now() >= kickoffUtc
  // OR match.status === 'finished' (a result may be entered ahead of kickoff);
  // 0<=scores<=20; if predHome===0&&predAway===0 coerce predScorer=null, predFirstTeam='none'
getEntryPicks(db, entryId): Pick[]
getMatchPicksPublic(db, leagueId, matchId): { entryId, label, pick }[]
  // ONLY when clock.now() >= kickoff (else throws 403 'picks hidden until kickoff')
```

### boosters.ts
```ts
setBooster(db, userId, { entryId, matchday, matchId })
  // match must belong to matchday; target kickoff in future; if existing booster row for
  // (entry, matchday): replace ONLY if previously chosen match hasn't kicked off, else 409.
  // After change: if either old or new match already finished → recompute affected matchPoints.
getBooster(db, entryId, matchday): Booster | null
```

### results.ts
```ts
enterResult(db, adminUserId, { matchId, homeScore, awayScore, firstScorer, firstScoringTeam })
  // adminUserId must be an admin of the PRIMARY league (lowest league id — the
  // seeded one). League creation is open to everyone, so 'admin of any league'
  // must never grant global results authority.
  // sets status='finished'; editable (re-enter overwrites); then recomputeMatch(db, matchId)
clearResult(db, adminUserId, matchId)  // undo a mistaken result: status back to
  // 'scheduled', score fields nulled, recomputeMatch deletes the match's points
setMatchTeams(db, adminUserId, { matchId, homeTeamId, awayTeamId })  // knockout slots;
  // clears underdogTeamId when it matches neither new team; recomputeMatch if finished
setUnderdog(db, adminUserId, { matchId, underdogTeamId | null })     // → recomputeMatch if finished
recomputeMatch(db, matchId)   // for every league: rules; for every entry pick: scorePick with
  // boosted = (booster of that entry for match.matchday)?.matchId === matchId; upsert matchPoints
recomputeLeague(db, leagueId) // recompute all finished matches for that league's entries
```

### leaderboard.ts
```ts
getLeaderboard(db, leagueId): Array<{ rank, entryId, userId, label, displayName, total,
  exactCount, scorerHits, outcomeCount, lastPickAt }>
  // total = sum(matchPoints.total); exactCount = #breakdowns with exact>0; scorerHits =
  // #breakdowns with scorer>0. Sort: total DESC, exactCount DESC, scorerHits DESC,
  // lastPickAt ASC (max pick.updatedAt; entries with no picks = Infinity), entryId ASC.
  // Ranks assigned 1..n after sort (ties broken — ranks unique).
getEntryStats(db, entryId): { total, exactCount, scorerHits, picksMade, finishedPicked,
  accuracyPct, currentStreak, bestStreak, badges: string[] }
  // streak = consecutive finished picked matches (kickoff order) with total>0.
  // badges: 'First Exact' (>=1 exact), 'Sniper' (>=3 exact), 'Golden Boot Whisperer'
  // (>=5 scorer hits), 'Hot Streak' (streak >=5), 'Ever Present' (picked all finished matches)
```

### today.ts
```ts
getTodayBoard(db, leagueId, entryId): { matchday, matches: Array<{ match, myPick, booster,
  locked, teams }> }   // matches of the next matchday with any unkicked-off match (or today's),
                       // plus any in-progress (kicked off, unfinished) from current matchday
getSchedule(db): all matches with teams joined (for History/admin)
```

## API routes (`src/app/api/...`) — all zod-validated, envelope shape above

```
POST /api/auth/register   { username, displayName, password } → { user } + session cookie
POST /api/auth/login      { username, password } → { user } + cookie
POST /api/auth/logout     → clears cookie
GET  /api/me              → { user, leagues: [{ slug, name, role }] }
POST /api/leagues                          { name, buyInCents?, joinPassword? } → { league }
GET  /api/leagues/[slug]                   → { league(safe: no hashes/token unless admin), memberCount }
PATCH /api/leagues/[slug]/settings         (admin) partial settings → { league }
POST /api/leagues/[slug]/join              { password? } → { entry }   (public league or password)
POST /api/join/[token]                     → { league, entry }          (invite link)
DELETE /api/leagues/[slug]/members/[userId] (admin)
GET  /api/leagues/[slug]/leaderboard       → { rows, prizePool, memberCount }
GET  /api/leagues/[slug]/today?entryId=    → today board
POST /api/picks                            upsertPick body
POST /api/boosters                         setBooster body
GET  /api/leagues/[slug]/history?entryId=  → finished matches + picks + points
POST /api/results          (primary-league admin)  enterResult body
POST /api/results/clear    (primary-league admin)  { matchId }
POST /api/matches/teams    (primary-league admin)  setMatchTeams body
POST /api/matches/underdog (primary-league admin)  setUnderdog body
```

Rate limits (in-memory, `src/lib/rate-limit.ts`): login 10/(ip,username)/15min,
register 20/ip/hour, join-by-password 10/(ip,league)/15min → 429.
Passwords: minimum 8 characters at register (zod schema + createUser).

Session: `@/lib/session` exports `createSessionCookie(user)`, `getSessionUser(db)` (reads
cookie via next/headers, returns user row or null), `requireUser(db)` (throws 401).
JWT secret: `process.env.SESSION_SECRET` (required in prod; `npm run setup` generates
`.env.local`; tests set it in config).

## Pages (App Router, all dark mobile-first; bottom tab bar on league pages)

```
/                          redirect: 1 league → its /today; else league picker/create/join
/login, /register          forms (register supports ?next= redirect)
/join/[token]              invite landing: shows league name+player count; register/login inline; joins
/league/[slug]/today       Today screen (pick entry, booster toggle, countdown, lock state)
/league/[slug]/table       leaderboard (poll 30s): rank, label, total, exact, scorer hits; prize pool card
/league/[slug]/rules       scoring table from league settings, booster+round multipliers,
                           tiebreakers, prize pool & payout split
/league/[slug]/history     past matchdays: result, my pick, points breakdown
/league/[slug]/profile     stats + badges + streaks; logout; entry switcher if >1 entries
/league/[slug]/admin       (admin only) settings form, members list (remove), results entry
                           (score+scorer+first team per match), underdog flag, knockout team
                           assignment, invite link copy
```

Shared UI in `src/components/`: `TabBar` (fixed bottom: Today/Table/Rules/History/Profile —
client, uses usePathname), `MatchCard` (props: match+teams+pick+locked+onSave+booster props),
`ScoreInput`, `Countdown` (client), `LeaderboardTable`, `StatCard`, `Badge`. Tailwind dark
palette: bg zinc-950, cards zinc-900, accent emerald-400, danger red ("red card" motif).

## File ownership (build phase — do not touch files you don't own)

- core (done before build): schema, db, clock, errors, normalize, scoring(+tests), session,
  fixtures data, seed, configs
- agent services-A: services/leagues.ts + tests/unit/leagues.test.ts
- agent services-B: services/picks.ts, services/boosters.ts + tests/unit/picks.test.ts,
  tests/unit/boosters.test.ts
- agent services-C: services/results.ts, services/leaderboard.ts, services/today.ts +
  tests/unit/results.test.ts, tests/unit/leaderboard.test.ts
- agent api: all src/app/api/** route handlers + src/lib/api-helpers.ts
- agent ui-shell: src/app/layout.tsx, globals, src/components/**, /, /login, /register, /join/[token]
- agent ui-league: /league/[slug]/{today,table,rules,history,profile} pages + their client comps
  (in src/app/league/[slug]/_components/)
- agent ui-admin: /league/[slug]/admin page + client comps (in .../admin/_components/)
- agent e2e: playwright.config.ts, e2e/*.spec.ts, scripts/seed-e2e.mjs

## Test conventions

- `tests/helpers/db.ts`: `freshDb()` → in-memory db with migrations; factories
  `makeUser/makeLeague/joinUser/makeMatch...` (owned by services-A agent; others may use).
- Lock tests: set `process.env.FAKE_NOW` around calls (clock reads it lazily; reset after).
- Every goal criterion has a NAMED test (e.g. `'exact score scores 10 points'`).
- Commands: `npm run typecheck` (tsc --noEmit), `npm run lint`, `npm test` (vitest run),
  `npm run test:e2e` (playwright), `npm run build`.

## Next 16 gotchas (MANDATORY)

- `params` in pages/route handlers is a **Promise**: `const { slug } = await params;`
  Type: `{ params: Promise<{ slug: string }> }`.
- `cookies()` from `next/headers` is **async**: `const jar = await cookies();`
- Route handlers and server components run in Node runtime by default — better-sqlite3 is fine
  there, but NEVER import `@/db` from client components ('use client').
- `tests/helpers/db.ts` is core-owned and already exists: exports `freshDb()` and
  `withFakeNow(iso, fn)`. There are NO shared factories — tests create data through the
  services themselves.

