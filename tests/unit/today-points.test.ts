import { describe, expect, it } from 'vitest';
import { schema, type Db } from '@/db';
import type { PointsBreakdown } from '@/lib/scoring';
import { getTodayPointsByEntry } from '@/app/league/[slug]/_components/today-points';
import { freshDb, withFakeNow } from '../helpers/db';

// ---------------------------------------------------------------------------
// Fixtures via DIRECT drizzle inserts (never through other agents' services).
// ---------------------------------------------------------------------------

let seq = 0;

function makeUser(db: Db) {
  const username = `user${++seq}`;
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

function makeEntry(db: Db, leagueId: number, userId: number) {
  return db
    .insert(schema.entries)
    .values({ leagueId, userId, label: `entry-${++seq}`, createdAt: 1 })
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
      kickoffUtc: '2026-06-11T19:00:00Z',
      matchday: '2026-06-11',
      venue: 'Estadio Azteca',
      city: 'Mexico City',
      status: 'finished',
      homeScore: 2,
      awayScore: 1,
      ...overrides,
    })
    .returning()
    .get();
}

function awardPoints(db: Db, entryId: number, matchId: number, total: number) {
  const breakdown: PointsBreakdown = {
    exact: 10,
    outcome: 0,
    scorer: 8,
    firstTeam: 2,
    underdog: 0,
    base: total,
    roundMultiplier: 1,
    boosterMultiplier: 1,
    total,
  };
  db.insert(schema.matchPoints)
    .values({ entryId, matchId, breakdown: JSON.stringify(breakdown), total })
    .run();
}

function fixture(db: Db) {
  const admin = makeUser(db);
  const league = makeLeague(db, admin.id);
  const entry = makeEntry(db, league.id, makeUser(db).id);
  makeMatch(db, 1);
  awardPoints(db, entry.id, 1, 20);
  return { league, entry };
}

// ---------------------------------------------------------------------------

describe('getTodayPointsByEntry', () => {
  it('reports points while the matchday is still the current NY date', async () => {
    const db = freshDb();
    const { league, entry } = fixture(db);
    // 2026-06-11T20:00Z = 4pm ET on the 2026-06-11 matchday.
    const map = await withFakeNow('2026-06-11T20:00:00Z', () =>
      getTodayPointsByEntry(db, league.id),
    );
    expect(map.get(entry.id)).toBe(20);
  });

  it('goes silent the morning after — yesterday is never "today"', async () => {
    const db = freshDb();
    const { league } = fixture(db);
    // 2026-06-12T12:00Z = 8am ET the next day; the chip is titled "Points won
    // today", so the finished 06-11 matchday must not light it up anymore.
    const map = await withFakeNow('2026-06-12T12:00:00Z', () =>
      getTodayPointsByEntry(db, league.id),
    );
    expect(map.size).toBe(0);
  });

  it('uses the New York calendar date, not UTC, for "today"', async () => {
    const db = freshDb();
    const { league, entry } = fixture(db);
    // 2026-06-12T03:00Z is 11pm ET on Jun 11 — still the 06-11 matchday.
    const map = await withFakeNow('2026-06-12T03:00:00Z', () =>
      getTodayPointsByEntry(db, league.id),
    );
    expect(map.get(entry.id)).toBe(20);
  });
});
