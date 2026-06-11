import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { schema, type Db } from '@/db';
import { getBooster, setBooster } from '@/lib/services/boosters';
// Deliberately unmocked: the recompute-on-move contract is exercised end to end.
import { enterResult } from '@/lib/services/results';
import { freshDb, withFakeNow } from '../helpers/db';

const MATCHDAY = '2026-06-11';
const NEXT_MATCHDAY = '2026-06-12';

const EARLY_ID = 1; // kicks off 16:00 on MATCHDAY
const LATE_ID = 2; // kicks off 20:00 on MATCHDAY
const NEXT_DAY_ID = 3; // kicks off 16:00 on NEXT_MATCHDAY

const EARLY_KICKOFF = '2026-06-11T16:00:00Z';
const LATE_KICKOFF = '2026-06-11T20:00:00Z';
const NEXT_DAY_KICKOFF = '2026-06-12T16:00:00Z';

const MORNING = '2026-06-11T10:00:00Z'; // nothing kicked off yet
const NOON = '2026-06-11T12:00:00Z'; // still nothing kicked off
const BETWEEN = '2026-06-11T17:00:00Z'; // early kicked off, late not yet

let seq = 0;

function seedUser(db: Db) {
  seq += 1;
  return db
    .insert(schema.users)
    .values({
      username: `user${seq}`,
      displayName: `User ${seq}`,
      passwordHash: 'not-a-real-hash',
      createdAt: 0,
    })
    .returning()
    .get();
}

function seedLeague(db: Db, adminUserId: number) {
  seq += 1;
  return db
    .insert(schema.leagues)
    .values({
      name: `League ${seq}`,
      slug: `league-${seq}`,
      inviteToken: `invite-${seq}`,
      adminUserId,
      createdAt: 0,
    })
    .returning()
    .get();
}

function seedMatch(db: Db, id: number, kickoffUtc: string, matchday: string) {
  return db
    .insert(schema.matches)
    .values({
      id,
      stage: 'group',
      kickoffUtc,
      matchday,
      venue: 'Test Stadium',
      city: 'Test City',
    })
    .returning()
    .get();
}

function setup() {
  const db = freshDb();
  const user = seedUser(db);
  const league = seedLeague(db, user.id);
  const entry = db
    .insert(schema.entries)
    .values({ leagueId: league.id, userId: user.id, label: 'Alpha', createdAt: 0 })
    .returning()
    .get();
  seedMatch(db, EARLY_ID, EARLY_KICKOFF, MATCHDAY);
  seedMatch(db, LATE_ID, LATE_KICKOFF, MATCHDAY);
  seedMatch(db, NEXT_DAY_ID, NEXT_DAY_KICKOFF, NEXT_MATCHDAY);
  return { db, user, league, entry };
}

function boosterRows(db: Db, entryId: number) {
  return db
    .select()
    .from(schema.boosters)
    .where(eq(schema.boosters.entryId, entryId))
    .all();
}

/** Make the user a results admin (admin membership in the only/primary league). */
function seedAdminMembership(db: Db, leagueId: number, userId: number) {
  db.insert(schema.memberships)
    .values({ leagueId, userId, role: 'admin', createdAt: 0 })
    .run();
}

/** Direct pick insert: 1-0 home (exact vs the 1-0 result below → base 10). */
function seedPick(db: Db, entryId: number, matchId: number) {
  db.insert(schema.picks)
    .values({
      entryId,
      matchId,
      predHome: 1,
      predAway: 0,
      createdAt: 0,
      updatedAt: 0,
    })
    .run();
}

function totalFor(db: Db, entryId: number, matchId: number): number | null {
  const row = db
    .select()
    .from(schema.matchPoints)
    .where(
      and(eq(schema.matchPoints.entryId, entryId), eq(schema.matchPoints.matchId, matchId)),
    )
    .get();
  return row?.total ?? null;
}

const RESULT_1_0 = {
  homeScore: 1,
  awayScore: 0,
  firstScorer: null,
  firstScoringTeam: 'home' as const,
};

describe('setBooster / getBooster', () => {
  it('daily booster applies to exactly one chosen match per matchday', async () => {
    const { db, user, entry } = setup();
    await withFakeNow(MORNING, async () => {
      await setBooster(db, user.id, {
        entryId: entry.id,
        matchday: MATCHDAY,
        matchId: EARLY_ID,
      });
      // Choosing again on the same matchday replaces, never adds a second row.
      await setBooster(db, user.id, {
        entryId: entry.id,
        matchday: MATCHDAY,
        matchId: LATE_ID,
      });
      // A different matchday is an independent booster.
      await setBooster(db, user.id, {
        entryId: entry.id,
        matchday: NEXT_MATCHDAY,
        matchId: NEXT_DAY_ID,
      });
    });

    const rows = boosterRows(db, entry.id);
    expect(rows.filter((r) => r.matchday === MATCHDAY)).toHaveLength(1);
    expect(rows).toHaveLength(2);
    expect((await getBooster(db, entry.id, MATCHDAY))?.matchId).toBe(LATE_ID);
    expect((await getBooster(db, entry.id, NEXT_MATCHDAY))?.matchId).toBe(
      NEXT_DAY_ID,
    );
  });

  it('booster cannot be moved after its match kicks off', async () => {
    const { db, user, entry } = setup();
    await withFakeNow(MORNING, () =>
      setBooster(db, user.id, {
        entryId: entry.id,
        matchday: MATCHDAY,
        matchId: EARLY_ID,
      }),
    );
    await withFakeNow(BETWEEN, async () => {
      await expect(
        setBooster(db, user.id, {
          entryId: entry.id,
          matchday: MATCHDAY,
          matchId: LATE_ID,
        }),
      ).rejects.toMatchObject({
        status: 409,
        message: 'Booster already locked for this matchday',
      });
    });
    expect((await getBooster(db, entry.id, MATCHDAY))?.matchId).toBe(EARLY_ID);
  });

  it('booster is locked exactly at the boosted match kickoff', async () => {
    const { db, user, entry } = setup();
    await withFakeNow(MORNING, () =>
      setBooster(db, user.id, {
        entryId: entry.id,
        matchday: MATCHDAY,
        matchId: EARLY_ID,
      }),
    );
    await withFakeNow(EARLY_KICKOFF, async () => {
      await expect(
        setBooster(db, user.id, {
          entryId: entry.id,
          matchday: MATCHDAY,
          matchId: LATE_ID,
        }),
      ).rejects.toMatchObject({
        status: 409,
        message: 'Booster already locked for this matchday',
      });
    });
  });

  it('booster can be moved to another match while both are unkicked', async () => {
    const { db, user, entry } = setup();
    const first = await withFakeNow(MORNING, () =>
      setBooster(db, user.id, {
        entryId: entry.id,
        matchday: MATCHDAY,
        matchId: EARLY_ID,
      }),
    );
    const moved = await withFakeNow(NOON, () =>
      setBooster(db, user.id, {
        entryId: entry.id,
        matchday: MATCHDAY,
        matchId: LATE_ID,
      }),
    );
    expect(moved.id).toBe(first.id); // same row, replaced
    expect(moved.matchId).toBe(LATE_ID);
    expect(moved.createdAt).toBe(Date.parse(MORNING)); // preserved
    expect(moved.updatedAt).toBe(Date.parse(NOON)); // refreshed
    expect(boosterRows(db, entry.id)).toHaveLength(1);
  });

  it('rejects a booster on a match at or after its kickoff', async () => {
    const { db, user, entry } = setup();
    for (const instant of [EARLY_KICKOFF, BETWEEN]) {
      await withFakeNow(instant, async () => {
        await expect(
          setBooster(db, user.id, {
            entryId: entry.id,
            matchday: MATCHDAY,
            matchId: EARLY_ID,
          }),
        ).rejects.toMatchObject({ status: 409 });
      });
    }
    expect(await getBooster(db, entry.id, MATCHDAY)).toBeNull();
  });

  it('rejects a booster when the match is not on the requested matchday', async () => {
    const { db, user, entry } = setup();
    await withFakeNow(MORNING, async () => {
      await expect(
        setBooster(db, user.id, {
          entryId: entry.id,
          matchday: NEXT_MATCHDAY,
          matchId: EARLY_ID,
        }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  it('rejects a booster for an entry the user does not own', async () => {
    const { db, entry } = setup();
    const intruder = seedUser(db);
    await withFakeNow(MORNING, async () => {
      await expect(
        setBooster(db, intruder.id, {
          entryId: entry.id,
          matchday: MATCHDAY,
          matchId: EARLY_ID,
        }),
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  it('rejects a booster for a missing match', async () => {
    const { db, user, entry } = setup();
    await withFakeNow(MORNING, async () => {
      await expect(
        setBooster(db, user.id, {
          entryId: entry.id,
          matchday: MATCHDAY,
          matchId: 999,
        }),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  it('getBooster returns null when no booster is set', async () => {
    const { db, entry } = setup();
    expect(await getBooster(db, entry.id, MATCHDAY)).toBeNull();
  });

  it('moving the booster OFF an already-finished match recomputes its points back to x1', async () => {
    const { db, user, league, entry } = setup();
    seedAdminMembership(db, league.id, user.id);
    seedPick(db, entry.id, EARLY_ID);

    await withFakeNow(MORNING, async () => {
      // Result entered ahead of kickoff: EARLY is finished but unkicked.
      enterResult(db, user.id, { matchId: EARLY_ID, ...RESULT_1_0 });
      expect(totalFor(db, entry.id, EARLY_ID)).toBe(10); // exact, unboosted

      await setBooster(db, user.id, {
        entryId: entry.id,
        matchday: MATCHDAY,
        matchId: EARLY_ID,
      });
      expect(totalFor(db, entry.id, EARLY_ID)).toBe(20); // boosted x2

      // Allowed: EARLY has not kicked off. The old match's points must drop
      // back to x1 immediately — no stale doubled points on the leaderboard.
      await setBooster(db, user.id, {
        entryId: entry.id,
        matchday: MATCHDAY,
        matchId: LATE_ID,
      });
      expect(totalFor(db, entry.id, EARLY_ID)).toBe(10);
      expect((await getBooster(db, entry.id, MATCHDAY))?.matchId).toBe(LATE_ID);
    });
  });

  it('moving the booster ONTO an already-finished match recomputes its points to x2', async () => {
    const { db, user, league, entry } = setup();
    seedAdminMembership(db, league.id, user.id);
    seedPick(db, entry.id, EARLY_ID);

    await withFakeNow(MORNING, async () => {
      await setBooster(db, user.id, {
        entryId: entry.id,
        matchday: MATCHDAY,
        matchId: LATE_ID,
      });

      enterResult(db, user.id, { matchId: EARLY_ID, ...RESULT_1_0 });
      expect(totalFor(db, entry.id, EARLY_ID)).toBe(10); // not boosted yet

      await setBooster(db, user.id, {
        entryId: entry.id,
        matchday: MATCHDAY,
        matchId: EARLY_ID,
      });
      expect(totalFor(db, entry.id, EARLY_ID)).toBe(20); // boost applied on move
    });
  });
});
