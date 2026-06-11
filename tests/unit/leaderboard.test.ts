import { describe, expect, it } from 'vitest';
import { schema, type Db } from '@/db';
import type { PointsBreakdown } from '@/lib/scoring';
import { entryCountOf } from '@/lib/api-helpers';
import { prizePool } from '@/lib/services/leagues';
import { getEntryStats, getLeaderboard } from '@/lib/services/leaderboard';
import { getSchedule, getTodayBoard } from '@/lib/services/today';
import { freshDb, withFakeNow } from '../helpers/db';

// ---------------------------------------------------------------------------
// Fixtures via DIRECT drizzle inserts (never through other agents' services).
// ---------------------------------------------------------------------------

let seq = 0;

function makeUser(db: Db, name?: string) {
  const username = name ?? `user${++seq}`;
  return db
    .insert(schema.users)
    .values({ username, displayName: username, passwordHash: 'test-hash', createdAt: 1 })
    .returning()
    .get();
}

function makeLeague(db: Db, adminUserId: number) {
  const n = ++seq;
  const league = db
    .insert(schema.leagues)
    .values({
      name: `League ${n}`,
      slug: `league-${n}`,
      inviteToken: `token-${n}`,
      adminUserId,
      createdAt: 1,
    })
    .returning()
    .get();
  db.insert(schema.memberships)
    .values({ leagueId: league.id, userId: adminUserId, role: 'admin', createdAt: 1 })
    .run();
  return league;
}

function makeEntry(db: Db, leagueId: number, userId: number, label?: string) {
  return db
    .insert(schema.entries)
    .values({ leagueId, userId, label: label ?? `entry-${++seq}`, createdAt: 1 })
    .returning()
    .get();
}

function makeMatch(
  db: Db,
  id: number,
  overrides: Partial<typeof schema.matches.$inferInsert> = {},
) {
  return db
    .insert(schema.matches)
    .values({
      id,
      stage: 'group',
      kickoffUtc: '2026-06-11T16:00:00Z',
      matchday: '2026-06-11',
      venue: 'Estadio Azteca',
      city: 'Mexico City',
      ...overrides,
    })
    .returning()
    .get();
}

function makePick(
  db: Db,
  entryId: number,
  matchId: number,
  overrides: Partial<typeof schema.picks.$inferInsert> = {},
) {
  return db
    .insert(schema.picks)
    .values({
      entryId,
      matchId,
      predHome: 1,
      predAway: 0,
      createdAt: 1,
      updatedAt: 1,
      ...overrides,
    })
    .returning()
    .get();
}

/** Insert a matchPoints row with a crafted breakdown (fixture-level control). */
function awardPoints(
  db: Db,
  entryId: number,
  matchId: number,
  partial: Partial<PointsBreakdown> & { total: number },
) {
  const breakdown: PointsBreakdown = {
    exact: 0,
    outcome: 0,
    scorer: 0,
    firstTeam: 0,
    underdog: 0,
    base: 0,
    roundMultiplier: 1,
    boosterMultiplier: 1,
    ...partial,
  };
  db.insert(schema.matchPoints)
    .values({ entryId, matchId, breakdown: JSON.stringify(breakdown), total: breakdown.total })
    .run();
}

/** league + n entries + m finished matches, for tie-break scenarios. */
function standingsFixture(db: Db, entryCount: number, matchCount: number) {
  const admin = makeUser(db);
  const league = makeLeague(db, admin.id);
  const entries = Array.from({ length: entryCount }, (_, i) =>
    makeEntry(db, league.id, makeUser(db).id, `Entry ${i + 1}`),
  );
  const matches = Array.from({ length: matchCount }, (_, i) =>
    makeMatch(db, i + 1, { status: 'finished', homeScore: 1, awayScore: 0 }),
  );
  return { league, entries, matches };
}

// ---------------------------------------------------------------------------

describe('leaderboard service', () => {
  it('leaderboard orders by total points', () => {
    const db = freshDb();
    const { league, entries } = standingsFixture(db, 3, 2);
    const [e1, e2, e3] = entries;
    awardPoints(db, e1.id, 1, { exact: 10, total: 10 });
    awardPoints(db, e1.id, 2, { outcome: 2, total: 2 });
    awardPoints(db, e2.id, 1, { outcome: 2, total: 2 });
    awardPoints(db, e3.id, 1, { exact: 10, scorer: 8, firstTeam: 2, total: 20 });

    const rows = getLeaderboard(db, league.id);
    expect(rows.map((r) => [r.rank, r.entryId, r.total])).toEqual([
      [1, e3.id, 20],
      [2, e1.id, 12],
      [3, e2.id, 2],
    ]);
    expect(rows[2].outcomeCount).toBe(1);
  });

  it('tiebreak: most exact scores wins', () => {
    const db = freshDb();
    const { league, entries } = standingsFixture(db, 2, 2);
    const [e1, e2] = entries;
    // Both on 20 points; e1 has two exacts, e2 only one.
    awardPoints(db, e1.id, 1, { exact: 10, total: 10 });
    awardPoints(db, e1.id, 2, { exact: 10, total: 10 });
    awardPoints(db, e2.id, 1, { exact: 10, boosterMultiplier: 2, total: 20 });

    const rows = getLeaderboard(db, league.id);
    expect(rows.map((r) => r.entryId)).toEqual([e1.id, e2.id]);
    expect(rows[0].exactCount).toBe(2);
    expect(rows[1].exactCount).toBe(1);
  });

  it('tiebreak: most scorer hits wins when exacts tie', () => {
    const db = freshDb();
    const { league, entries } = standingsFixture(db, 2, 2);
    const [e1, e2] = entries;
    // Both 20 points, both one exact; e1 has a scorer hit, e2 does not.
    awardPoints(db, e1.id, 1, { exact: 10, total: 10 });
    awardPoints(db, e1.id, 2, { scorer: 8, firstTeam: 2, total: 10 });
    awardPoints(db, e2.id, 1, { exact: 10, total: 10 });
    awardPoints(db, e2.id, 2, { outcome: 2, boosterMultiplier: 5, total: 10 });

    const rows = getLeaderboard(db, league.id);
    expect(rows.map((r) => r.entryId)).toEqual([e1.id, e2.id]);
    expect(rows[0].scorerHits).toBe(1);
    expect(rows[1].scorerHits).toBe(0);
  });

  it('tiebreak: earliest pick submission wins when exacts and scorer hits tie', () => {
    const db = freshDb();
    const { league, entries } = standingsFixture(db, 3, 2);
    const [e1, e2, e3] = entries;
    for (const e of entries) {
      awardPoints(db, e.id, 1, { exact: 10, total: 10 });
      awardPoints(db, e.id, 2, { scorer: 8, total: 8 });
    }
    // Identical points; e2 updated a pick later than e1; e3 has no picks at all.
    makePick(db, e1.id, 1, { updatedAt: 1_000 });
    makePick(db, e2.id, 1, { updatedAt: 1_000 });
    makePick(db, e2.id, 2, { updatedAt: 2_000 });

    const rows = getLeaderboard(db, league.id);
    expect(rows.map((r) => r.entryId)).toEqual([e1.id, e2.id, e3.id]);
    expect(rows[0].lastPickAt).toBe(1_000);
    expect(rows[1].lastPickAt).toBe(2_000);
    expect(rows[2].lastPickAt).toBeNull(); // no picks sorts last on this key
  });

  it('tiebreak: float-rounded totals — mathematically equal sums tie before tiebreaks', () => {
    const db = freshDb();
    const { league, entries } = standingsFixture(db, 2, 2);
    const [e1, e2] = entries;
    // e1 accumulates 0.1 + 0.2 (raw float sum = 0.30000000000000004);
    // e2 holds exactly 0.3 plus an exact hit. The totals are mathematically
    // equal, so the exact-count tiebreak must decide — not a 1e-17 artifact.
    awardPoints(db, e1.id, 1, { total: 0.1 });
    awardPoints(db, e1.id, 2, { total: 0.2 });
    awardPoints(db, e2.id, 1, { exact: 10, total: 0.3 });

    const rows = getLeaderboard(db, league.id);
    expect(rows.map((r) => r.entryId)).toEqual([e2.id, e1.id]);
    expect(rows[0].total).toBe(0.3);
    expect(rows[1].total).toBe(0.3); // identical after rounding
  });

  it('a user with multiple entries holds independent leaderboard rows and the prize pool counts entries', () => {
    const db = freshDb();
    const admin = makeUser(db);
    const league = makeLeague(db, admin.id);
    makeMatch(db, 1, { status: 'finished', homeScore: 1, awayScore: 0 });
    const multi = makeUser(db);
    const solo = makeUser(db);
    const entryA = makeEntry(db, league.id, multi.id, 'Multi A');
    const entryB = makeEntry(db, league.id, multi.id, 'Multi B');
    const entryC = makeEntry(db, league.id, solo.id, 'Solo');
    awardPoints(db, entryA.id, 1, { exact: 10, total: 10 });
    awardPoints(db, entryB.id, 1, { outcome: 2, total: 2 });
    awardPoints(db, entryC.id, 1, { scorer: 8, total: 8 });

    // Two entries of one user are fully independent rows (totals, labels, ranks).
    const rows = getLeaderboard(db, league.id);
    expect(rows.map((r) => [r.rank, r.entryId, r.userId, r.label, r.total])).toEqual([
      [1, entryA.id, multi.id, 'Multi A', 10],
      [2, entryC.id, solo.id, 'Solo', 8],
      [3, entryB.id, multi.id, 'Multi B', 2],
    ]);

    // The prize pool is driven by ENTRIES (3), not members (2).
    expect(entryCountOf(db, league.id)).toBe(3);
    const pool = prizePool(
      { buyInCents: 2000, payoutSplit: '[60,30,10]' },
      entryCountOf(db, league.id),
    );
    expect(pool.totalCents).toBe(6000);
    expect(pool.payouts.map((p) => p.amountCents)).toEqual([3600, 1800, 600]);
  });

  it('leaderboard ranks are deterministic and unique', () => {
    const db = freshDb();
    const { league, entries } = standingsFixture(db, 4, 1);
    // All four entries fully tied on every key — falls through to entryId ASC.
    const first = getLeaderboard(db, league.id);
    const second = getLeaderboard(db, league.id);

    expect(second).toEqual(first);
    expect(first.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    expect(new Set(first.map((r) => r.rank)).size).toBe(4);
    expect(first.map((r) => r.entryId)).toEqual(entries.map((e) => e.id));
  });

  it('entry stats compute streaks over finished picked matches in kickoff order', () => {
    const db = freshDb();
    const admin = makeUser(db);
    const league = makeLeague(db, admin.id);
    const entry = makeEntry(db, league.id, makeUser(db).id);
    // Kickoff order (2,1,3,4,5) deliberately differs from id order.
    const kickoffs: Record<number, string> = {
      1: '2026-06-12T16:00:00Z',
      2: '2026-06-11T16:00:00Z',
      3: '2026-06-13T16:00:00Z',
      4: '2026-06-14T16:00:00Z',
      5: '2026-06-15T16:00:00Z',
    };
    for (const id of [1, 2, 3, 4, 5]) {
      makeMatch(db, id, {
        kickoffUtc: kickoffs[id],
        matchday: kickoffs[id].slice(0, 10),
        status: 'finished',
        homeScore: 1,
        awayScore: 0,
      });
      makePick(db, entry.id, id);
    }
    // In kickoff order: m2 scored, m1 blank, m3 scored, m4 scored, m5 scored.
    awardPoints(db, entry.id, 2, { exact: 10, total: 10 });
    awardPoints(db, entry.id, 1, { total: 0 });
    awardPoints(db, entry.id, 3, { outcome: 2, total: 2 });
    awardPoints(db, entry.id, 4, { scorer: 8, total: 8 });
    awardPoints(db, entry.id, 5, { outcome: 2, total: 2 });

    const stats = getEntryStats(db, entry.id);
    expect(stats.bestStreak).toBe(3);
    expect(stats.currentStreak).toBe(3);
    expect(stats.total).toBe(22);
    expect(stats.picksMade).toBe(5);
    expect(stats.finishedPicked).toBe(5);
    expect(stats.accuracyPct).toBe(80); // 4 of 5 finished picks scored
    expect(stats.exactCount).toBe(1);
    expect(stats.scorerHits).toBe(1);
  });

  it('entry stats award badges at their thresholds', () => {
    const db = freshDb();
    const admin = makeUser(db);
    const league = makeLeague(db, admin.id);
    const entry = makeEntry(db, league.id, makeUser(db).id);
    for (let id = 1; id <= 5; id++) {
      makeMatch(db, id, {
        kickoffUtc: `2026-06-1${id}T16:00:00Z`,
        matchday: `2026-06-1${id}`,
        status: 'finished',
        homeScore: 1,
        awayScore: 0,
      });
      makePick(db, entry.id, id);
      awardPoints(db, entry.id, id, { exact: 10, scorer: 8, total: 18 });
    }

    const stats = getEntryStats(db, entry.id);
    expect(stats.exactCount).toBe(5);
    expect(stats.scorerHits).toBe(5);
    expect(stats.bestStreak).toBe(5);
    expect(stats.badges).toEqual([
      'First Exact',
      'Sniper',
      'Golden Boot Whisperer',
      'Hot Streak',
      'Ever Present',
    ]);

    // A fresh entry that picked nothing earns no badges.
    const blank = makeEntry(db, league.id, makeUser(db).id);
    expect(getEntryStats(db, blank.id).badges).toEqual([]);
  });
});

describe('today board', () => {
  it('shows all matches of the earliest matchday with an unfinished match', async () => {
    const db = freshDb();
    const admin = makeUser(db);
    const league = makeLeague(db, admin.id);
    const entry = makeEntry(db, league.id, makeUser(db).id);
    makeMatch(db, 1, {
      matchday: '2026-06-11',
      kickoffUtc: '2026-06-11T16:00:00Z',
      status: 'finished',
      homeScore: 1,
      awayScore: 0,
    });
    makeMatch(db, 2, { matchday: '2026-06-12', kickoffUtc: '2026-06-12T19:00:00Z' });
    makeMatch(db, 3, { matchday: '2026-06-12', kickoffUtc: '2026-06-12T16:00:00Z' });
    makeMatch(db, 4, { matchday: '2026-06-13', kickoffUtc: '2026-06-13T16:00:00Z' });

    await withFakeNow('2026-06-10T12:00:00Z', () => {
      const board = getTodayBoard(db, league.id, entry.id);
      expect(board.matchday).toBe('2026-06-12');
      // Ordered by kickoff within the matchday.
      expect(board.matches.map((m) => m.match.id)).toEqual([3, 2]);
    });
  });

  it('advances past a fully kicked-off matchday awaiting results, carrying in-progress matches', async () => {
    const db = freshDb();
    const admin = makeUser(db);
    const league = makeLeague(db, admin.id);
    const entry = makeEntry(db, league.id, makeUser(db).id);
    // m1 kicked off hours ago, result not yet entered (admin asleep);
    // m2 is tomorrow's match — its pick form must already be reachable.
    makeMatch(db, 1, { matchday: '2026-06-11', kickoffUtc: '2026-06-11T16:00:00Z' });
    makeMatch(db, 2, { matchday: '2026-06-12', kickoffUtc: '2026-06-12T16:00:00Z' });
    db.insert(schema.boosters)
      .values({ entryId: entry.id, matchday: '2026-06-11', matchId: 1, createdAt: 1, updatedAt: 1 })
      .run();

    await withFakeNow('2026-06-11T23:00:00Z', () => {
      const board = getTodayBoard(db, league.id, entry.id);
      // Next matchday with an unkicked-off match — never pinned to yesterday.
      expect(board.matchday).toBe('2026-06-12');
      // In-progress m1 (kicked off, unfinished) is carried over, kickoff order.
      expect(board.matches.map((m) => m.match.id)).toEqual([1, 2]);
      expect(board.matches[0].locked).toBe(true);
      expect(board.matches[1].locked).toBe(false);
      // Booster flags resolve per matchday, even across the carryover.
      expect(board.matches[0].booster).toBe(true);
      expect(board.matches[1].booster).toBe(false);
    });
  });

  it('joins my pick, booster state, and lock state per match', async () => {
    const db = freshDb();
    const admin = makeUser(db);
    const league = makeLeague(db, admin.id);
    const entry = makeEntry(db, league.id, makeUser(db).id);
    makeMatch(db, 1, { matchday: '2026-06-12', kickoffUtc: '2026-06-12T15:00:00Z' });
    makeMatch(db, 2, { matchday: '2026-06-12', kickoffUtc: '2026-06-12T20:00:00Z' });
    makePick(db, entry.id, 1, { predHome: 2, predAway: 1 });
    db.insert(schema.boosters)
      .values({ entryId: entry.id, matchday: '2026-06-12', matchId: 2, createdAt: 1, updatedAt: 1 })
      .run();

    await withFakeNow('2026-06-12T16:00:00Z', () => {
      const board = getTodayBoard(db, league.id, entry.id);
      const [m1, m2] = board.matches;
      expect(m1.match.id).toBe(1);
      expect(m1.myPick?.predHome).toBe(2);
      expect(m1.booster).toBe(false);
      expect(m1.locked).toBe(true); // kicked off an hour ago

      expect(m2.myPick).toBeNull();
      expect(m2.booster).toBe(true);
      expect(m2.locked).toBe(false); // kicks off later today
    });
  });

  it('schedule lists every match with teams joined, ordered by match number', () => {
    const db = freshDb();
    db.insert(schema.teams)
      .values([
        { id: 1, code: 'MEX', name: 'Mexico', groupLetter: 'A' },
        { id: 2, code: 'CAN', name: 'Canada', groupLetter: 'B' },
      ])
      .run();
    makeMatch(db, 2, { homeTeamId: 1, awayTeamId: 2 });
    makeMatch(db, 1, { stage: 'r32', homePlaceholder: '1A', awayPlaceholder: '2B' });

    const schedule = getSchedule(db);
    expect(schedule.map((s) => s.match.id)).toEqual([1, 2]);
    expect(schedule[0].homeTeam).toBeNull(); // placeholder slot, no team yet
    expect(schedule[1].homeTeam?.name).toBe('Mexico');
    expect(schedule[1].awayTeam?.code).toBe('CAN');
  });
});
