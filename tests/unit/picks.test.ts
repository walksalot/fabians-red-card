import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import {
  getEntryPicks,
  getMatchPicksPublic,
  upsertPick,
} from '@/lib/services/picks';
import { freshDb, withFakeNow } from '../helpers/db';

const KICKOFF_UTC = '2026-06-11T16:00:00Z';
const MATCHDAY = '2026-06-11';
const BEFORE_KICKOFF = '2026-06-11T12:00:00Z';
const AT_KICKOFF = KICKOFF_UTC;
const AFTER_KICKOFF = '2026-06-11T18:00:00Z';
const MATCH_ID = 7;

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

function seedEntry(db: Db, leagueId: number, userId: number, label: string) {
  return db
    .insert(schema.entries)
    .values({ leagueId, userId, label, createdAt: 0 })
    .returning()
    .get();
}

function seedMatch(db: Db, id: number, kickoffUtc = KICKOFF_UTC) {
  return db
    .insert(schema.matches)
    .values({
      id,
      stage: 'group',
      kickoffUtc,
      matchday: MATCHDAY,
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
  const entry = seedEntry(db, league.id, user.id, 'Alpha');
  const match = seedMatch(db, MATCH_ID);
  return { db, user, league, entry, match };
}

function basePick(entryId: number) {
  return {
    entryId,
    matchId: MATCH_ID,
    predHome: 2,
    predAway: 1,
    predScorer: 'Kylian Mbappé',
    predFirstTeam: 'home' as const,
  };
}

describe('upsertPick', () => {
  it('picks are editable before kickoff', async () => {
    const { db, user, entry } = setup();
    const saved = await withFakeNow(BEFORE_KICKOFF, () =>
      upsertPick(db, user.id, basePick(entry.id)),
    );
    expect(saved).toMatchObject({
      entryId: entry.id,
      matchId: MATCH_ID,
      predHome: 2,
      predAway: 1,
      predScorer: 'Kylian Mbappé',
      predFirstTeam: 'home',
    });
    expect(await getEntryPicks(db, entry.id)).toHaveLength(1);
  });

  it('picks are rejected server-side at kickoff', async () => {
    const { db, user, entry } = setup();
    await withFakeNow(AT_KICKOFF, async () => {
      await expect(
        upsertPick(db, user.id, basePick(entry.id)),
      ).rejects.toMatchObject({
        status: 409,
        message: 'Picks are locked for this match',
      });
    });
    expect(await getEntryPicks(db, entry.id)).toHaveLength(0);
  });

  it('picks are rejected server-side after kickoff', async () => {
    const { db, user, entry } = setup();
    await withFakeNow(AFTER_KICKOFF, async () => {
      await expect(
        upsertPick(db, user.id, basePick(entry.id)),
      ).rejects.toMatchObject({
        status: 409,
        message: 'Picks are locked for this match',
      });
    });
    expect(await getEntryPicks(db, entry.id)).toHaveLength(0);
  });

  it('picks are rejected once a result is entered, even before kickoff', async () => {
    const { db, user, entry, match } = setup();
    // The admin can enter a result ahead of kickoff; the result is then
    // visible to everyone, so a "prediction" must no longer be accepted.
    db.update(schema.matches)
      .set({ status: 'finished', homeScore: 2, awayScore: 1, firstScoringTeam: 'home' })
      .where(eq(schema.matches.id, match.id))
      .run();

    await withFakeNow(BEFORE_KICKOFF, async () => {
      await expect(
        upsertPick(db, user.id, basePick(entry.id)),
      ).rejects.toMatchObject({
        status: 409,
        message: 'Picks are locked for this match',
      });
    });
    expect(await getEntryPicks(db, entry.id)).toHaveLength(0);
  });

  it('pick upsert updates an existing pick', async () => {
    const { db, user, entry } = setup();
    const t1 = '2026-06-11T10:00:00Z';
    const t2 = '2026-06-11T12:30:00Z';
    const created = await withFakeNow(t1, () =>
      upsertPick(db, user.id, basePick(entry.id)),
    );
    const updated = await withFakeNow(t2, () =>
      upsertPick(db, user.id, {
        ...basePick(entry.id),
        predHome: 3,
        predAway: 0,
        predScorer: 'Harry Kane',
        predFirstTeam: 'away',
      }),
    );
    expect(updated.id).toBe(created.id);
    expect(updated).toMatchObject({
      predHome: 3,
      predAway: 0,
      predScorer: 'Harry Kane',
      predFirstTeam: 'away',
    });
    expect(updated.createdAt).toBe(Date.parse(t1)); // preserved
    expect(updated.updatedAt).toBe(Date.parse(t2)); // refreshed
    expect(await getEntryPicks(db, entry.id)).toHaveLength(1);
  });

  it('rejects a pick for an entry the user does not own', async () => {
    const { db, entry } = setup();
    const intruder = seedUser(db);
    await withFakeNow(BEFORE_KICKOFF, async () => {
      await expect(
        upsertPick(db, intruder.id, basePick(entry.id)),
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  it('rejects a pick for a missing match', async () => {
    const { db, user, entry } = setup();
    await withFakeNow(BEFORE_KICKOFF, async () => {
      await expect(
        upsertPick(db, user.id, { ...basePick(entry.id), matchId: 999 }),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  it('rejects non-integer or out-of-range scores', async () => {
    const { db, user, entry } = setup();
    await withFakeNow(BEFORE_KICKOFF, async () => {
      for (const bad of [-1, 21, 1.5, Number.NaN]) {
        await expect(
          upsertPick(db, user.id, { ...basePick(entry.id), predHome: bad }),
        ).rejects.toMatchObject({ status: 400 });
        await expect(
          upsertPick(db, user.id, { ...basePick(entry.id), predAway: bad }),
        ).rejects.toMatchObject({ status: 400 });
      }
    });
    expect(await getEntryPicks(db, entry.id)).toHaveLength(0);
  });

  it('rejects an invalid predFirstTeam value', async () => {
    const { db, user, entry } = setup();
    await withFakeNow(BEFORE_KICKOFF, async () => {
      await expect(
        upsertPick(db, user.id, {
          ...basePick(entry.id),
          predFirstTeam: 'middle' as 'home',
        }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  it('trims the predicted scorer and stores blank as null', async () => {
    const { db, user, entry } = setup();
    await withFakeNow(BEFORE_KICKOFF, async () => {
      const trimmed = await upsertPick(db, user.id, {
        ...basePick(entry.id),
        predScorer: '  Erling Haaland  ',
      });
      expect(trimmed.predScorer).toBe('Erling Haaland');

      const blank = await upsertPick(db, user.id, {
        ...basePick(entry.id),
        predScorer: '   ',
      });
      expect(blank.predScorer).toBeNull();
    });
  });

  it('rejects a predicted scorer longer than 80 characters', async () => {
    const { db, user, entry } = setup();
    await withFakeNow(BEFORE_KICKOFF, async () => {
      await expect(
        upsertPick(db, user.id, {
          ...basePick(entry.id),
          predScorer: 'a'.repeat(81),
        }),
      ).rejects.toMatchObject({ status: 400 });

      const maxed = await upsertPick(db, user.id, {
        ...basePick(entry.id),
        predScorer: 'a'.repeat(80),
      });
      expect(maxed.predScorer).toBe('a'.repeat(80));
    });
  });

  it('coerces scorer and first team for a 0-0 prediction', async () => {
    const { db, user, entry } = setup();
    const saved = await withFakeNow(BEFORE_KICKOFF, () =>
      upsertPick(db, user.id, {
        ...basePick(entry.id),
        predHome: 0,
        predAway: 0,
        predScorer: 'Lionel Messi',
        predFirstTeam: 'home',
      }),
    );
    expect(saved.predScorer).toBeNull();
    expect(saved.predFirstTeam).toBe('none');
  });
});

describe('getMatchPicksPublic', () => {
  it('other players picks are hidden before kickoff and visible after', async () => {
    const { db, user, league, entry } = setup();
    const rival = seedUser(db);
    const rivalEntry = seedEntry(db, league.id, rival.id, 'Rival');
    // An entry in a different league picking the same match must never leak in.
    const outsider = seedUser(db);
    const otherLeague = seedLeague(db, outsider.id);
    const outsiderEntry = seedEntry(db, otherLeague.id, outsider.id, 'Outsider');

    await withFakeNow(BEFORE_KICKOFF, async () => {
      await upsertPick(db, user.id, basePick(entry.id));
      await upsertPick(db, rival.id, {
        ...basePick(rivalEntry.id),
        predHome: 0,
        predAway: 2,
      });
      await upsertPick(db, outsider.id, basePick(outsiderEntry.id));

      await expect(
        getMatchPicksPublic(db, league.id, MATCH_ID),
      ).rejects.toMatchObject({
        status: 403,
        message: 'Picks are hidden until kickoff',
      });
    });

    const visible = await withFakeNow(AFTER_KICKOFF, () =>
      getMatchPicksPublic(db, league.id, MATCH_ID),
    );
    expect(visible).toHaveLength(2);
    expect(visible.map((v) => v.label).sort()).toEqual(['Alpha', 'Rival']);
    const mine = visible.find((v) => v.entryId === entry.id);
    expect(mine?.pick).toMatchObject({ predHome: 2, predAway: 1 });
    const theirs = visible.find((v) => v.entryId === rivalEntry.id);
    expect(theirs?.pick).toMatchObject({ predHome: 0, predAway: 2 });
  });

  it('becomes visible exactly at kickoff (mirrors the pick lock boundary)', async () => {
    const { db, user, league, entry } = setup();
    await withFakeNow(BEFORE_KICKOFF, () =>
      upsertPick(db, user.id, basePick(entry.id)),
    );
    const visible = await withFakeNow(AT_KICKOFF, () =>
      getMatchPicksPublic(db, league.id, MATCH_ID),
    );
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({ entryId: entry.id, label: 'Alpha' });
  });
});
