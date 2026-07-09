import { describe, expect, it } from 'vitest';
import { schema, type Db } from '@/db';
import { getLockedPicksByEntry } from '@/app/league/[slug]/_components/leaderboard-picks';
import { freshDb, withFakeNow } from '../helpers/db';

// ---------------------------------------------------------------------------
// Fixtures via DIRECT drizzle inserts (never through other agents' services).
// ---------------------------------------------------------------------------

let seq = 0;

function seedLeague(db: Db) {
  const user = db
    .insert(schema.users)
    .values({ username: `u${++seq}`, displayName: 'U', passwordHash: 'x', createdAt: 1 })
    .returning()
    .get();
  const league = db
    .insert(schema.leagues)
    .values({ name: 'L', slug: `l${seq}`, inviteToken: `t${seq}`, adminUserId: user.id, createdAt: 1 })
    .returning()
    .get();
  const entry = db
    .insert(schema.entries)
    .values({ leagueId: league.id, userId: user.id, label: 'A', createdAt: 1 })
    .returning()
    .get();
  return { league, entry };
}

function makeMatch(db: Db, id: number, overrides: Partial<typeof schema.matches.$inferInsert> = {}) {
  db.insert(schema.matches)
    .values({
      id,
      stage: 'group',
      kickoffUtc: '2026-06-11T16:00:00Z',
      matchday: '2026-06-11',
      venue: 'V',
      city: 'C',
      ...overrides,
    })
    .run();
}

function makePick(db: Db, entryId: number, matchId: number) {
  db.insert(schema.picks)
    .values({ entryId, matchId, predHome: 1, predAway: 0, createdAt: 1, updatedAt: 1 })
    .run();
}

describe('getLockedPicksByEntry (leaderboard reveal privacy)', () => {
  it('a result entered AHEAD of kickoff never reveals picks before the game starts', async () => {
    const db = freshDb();
    const { league, entry } = seedLeague(db);
    // Finished (admin banked it early) but kickoff still in the future.
    makeMatch(db, 1, { status: 'finished', homeScore: 1, awayScore: 0 });
    makePick(db, entry.id, 1);

    await withFakeNow('2026-06-11T12:00:00Z', () => {
      const revealed = getLockedPicksByEntry(db, league.id);
      expect(revealed.size).toBe(0); // picks stay hidden until kickoff
    });

    // From kickoff the same match reveals normally.
    await withFakeNow('2026-06-11T16:00:00Z', () => {
      const revealed = getLockedPicksByEntry(db, league.id);
      expect(revealed.get(entry.id)?.map((p) => p.matchId)).toEqual([1]);
    });
  });

  it('a feed-live match (early real kickoff) reveals like a kicked-off one', async () => {
    const db = freshDb();
    const { league, entry } = seedLeague(db);
    makeMatch(db, 1, { liveStatus: 'in', liveHome: 0, liveAway: 0 });
    makePick(db, entry.id, 1);

    // Fixture kickoff is 16:00Z but the feed says the ball is rolling at 15:30Z.
    await withFakeNow('2026-06-11T15:30:00Z', () => {
      const revealed = getLockedPicksByEntry(db, league.id);
      expect(revealed.get(entry.id)?.map((p) => p.matchId)).toEqual([1]);
    });
  });
});
