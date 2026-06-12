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
  // every group match has both teams known — picks on TBD matchups are a
  // separate 409 path covered in daybrowser.test.ts
  db.insert(schema.teams)
    .values([
      { id: 901, code: 'AAA', name: 'Team Alpha', groupLetter: 'A' },
      { id: 902, code: 'BBB', name: 'Team Beta', groupLetter: 'A' },
    ])
    .onConflictDoNothing()
    .run();
  return db
    .insert(schema.matches)
    .values({
      id,
      stage: 'group',
      homeTeamId: 901,
      awayTeamId: 902,
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
    // Length is checked before squad rules; pin the at-the-limit acceptance on
    // a match whose squads resolve empty (validation fails open there).
    db.insert(schema.teams)
      .values([
        { id: 80, code: 'ZZ1', name: 'Nowhere FC', groupLetter: 'Z' },
        { id: 81, code: 'ZZ2', name: 'Nullsville', groupLetter: 'Z' },
      ])
      .run();
    const matchId = 45;
    db.insert(schema.matches)
      .values({
        id: matchId,
        stage: 'group',
        kickoffUtc: KICKOFF_UTC,
        matchday: MATCHDAY,
        venue: 'Test Stadium',
        city: 'Test City',
        homeTeamId: 80,
        awayTeamId: 81,
      })
      .run();
    await withFakeNow(BEFORE_KICKOFF, async () => {
      await expect(
        upsertPick(db, user.id, {
          ...basePick(entry.id),
          matchId,
          predScorer: 'a'.repeat(81),
        }),
      ).rejects.toMatchObject({ status: 400 });

      const maxed = await upsertPick(db, user.id, {
        ...basePick(entry.id),
        matchId,
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

  it('re-saving an identical pick is a no-op: updatedAt is NOT refreshed', async () => {
    const { db, user, entry } = setup();
    const t1 = '2026-06-11T10:00:00Z';
    const t2 = '2026-06-11T12:30:00Z';
    const t3 = '2026-06-11T13:00:00Z';
    const created = await withFakeNow(t1, () =>
      upsertPick(db, user.id, basePick(entry.id)),
    );
    // Byte-identical re-save: nothing changes, especially not the timestamp.
    const resaved = await withFakeNow(t2, () =>
      upsertPick(db, user.id, basePick(entry.id)),
    );
    expect(resaved.updatedAt).toBe(Date.parse(t1));
    expect(resaved).toEqual(created);
    // A real change still refreshes it.
    const changed = await withFakeNow(t3, () =>
      upsertPick(db, user.id, { ...basePick(entry.id), predHome: 3 }),
    );
    expect(changed.updatedAt).toBe(Date.parse(t3));
  });
});

describe('scorer roster validation', () => {
  /** Match with real team ids + seeded squads (the post-fix happy path). */
  function setupWithSquads() {
    const { db, user, league, entry } = setup();
    db.insert(schema.teams)
      .values([
        { id: 1, code: 'ARG', name: 'Argentina', groupLetter: 'A' },
        { id: 2, code: 'FRA', name: 'France', groupLetter: 'B' },
      ])
      .run();
    db.insert(schema.players)
      .values([
        { teamId: 1, name: 'Lautaro Martínez', position: 'F' },
        { teamId: 1, name: 'Emiliano Martínez', position: 'G' },
        { teamId: 2, name: 'Kylian Mbappé', position: 'F' },
      ])
      .run();
    const matchId = 42;
    db.insert(schema.matches)
      .values({
        id: matchId,
        stage: 'group',
        kickoffUtc: KICKOFF_UTC,
        matchday: MATCHDAY,
        venue: 'Test Stadium',
        city: 'Test City',
        homeTeamId: 1,
        awayTeamId: 2,
      })
      .run();
    return { db, user, league, entry, matchId };
  }

  it('accepts a full squad name, accent- and case-insensitively', async () => {
    const { db, user, entry, matchId } = setupWithSquads();
    await withFakeNow(BEFORE_KICKOFF, async () => {
      const saved = await upsertPick(db, user.id, {
        ...basePick(entry.id),
        matchId,
        predScorer: 'lautaro martinez',
      });
      // Stored canonicalized to the squad spelling (unambiguous match).
      expect(saved.predScorer).toBe('Lautaro Martínez');
    });
  });

  it('accepts a player from the away squad', async () => {
    const { db, user, entry, matchId } = setupWithSquads();
    await withFakeNow(BEFORE_KICKOFF, async () => {
      const saved = await upsertPick(db, user.id, {
        ...basePick(entry.id),
        matchId,
        predScorer: 'Kylian Mbappé',
      });
      expect(saved.predScorer).toBe('Kylian Mbappé');
    });
  });

  it('rejects a bare surname (the "martinez" loophole is closed)', async () => {
    const { db, user, entry, matchId } = setupWithSquads();
    await withFakeNow(BEFORE_KICKOFF, async () => {
      await expect(
        upsertPick(db, user.id, {
          ...basePick(entry.id),
          matchId,
          predScorer: 'Martinez',
        }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  it('rejects a player who is not in either squad', async () => {
    const { db, user, entry, matchId } = setupWithSquads();
    await withFakeNow(BEFORE_KICKOFF, async () => {
      await expect(
        upsertPick(db, user.id, {
          ...basePick(entry.id),
          matchId,
          predScorer: 'Erling Haaland',
        }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  it('0-0 coercion still wins: a garbage scorer on a 0-0 pick is nulled, not rejected', async () => {
    const { db, user, entry, matchId } = setupWithSquads();
    await withFakeNow(BEFORE_KICKOFF, async () => {
      const saved = await upsertPick(db, user.id, {
        ...basePick(entry.id),
        matchId,
        predHome: 0,
        predAway: 0,
        predScorer: 'definitely not a player',
      });
      expect(saved.predScorer).toBeNull();
    });
  });

  it('falls back to the bundled rosters file when the players table is empty', async () => {
    const { db, user, entry } = setup();
    // Teams exist (codes match data/rosters.json) but NO players rows seeded.
    db.insert(schema.teams)
      .values([
        { id: 30, code: 'BRA', name: 'Brazil', groupLetter: 'C' },
        { id: 31, code: 'MEX', name: 'Mexico', groupLetter: 'A' },
      ])
      .run();
    const matchId = 43;
    db.insert(schema.matches)
      .values({
        id: matchId,
        stage: 'group',
        kickoffUtc: KICKOFF_UTC,
        matchday: MATCHDAY,
        venue: 'Test Stadium',
        city: 'Test City',
        homeTeamId: 30,
        awayTeamId: 31,
      })
      .run();
    await withFakeNow(BEFORE_KICKOFF, async () => {
      // Casemiro is on Brazil's squad in data/rosters.json (post "null" fix).
      const saved = await upsertPick(db, user.id, {
        ...basePick(entry.id),
        matchId,
        predScorer: 'Casemiro',
      });
      expect(saved.predScorer).toBe('Casemiro');
      await expect(
        upsertPick(db, user.id, {
          ...basePick(entry.id),
          matchId,
          predScorer: 'Erling Haaland',
        }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  it('re-saving a non-canonical spelling of the stored scorer is a no-op', async () => {
    const { db, user, entry, matchId } = setupWithSquads();
    const t1 = '2026-06-11T10:00:00Z';
    const t2 = '2026-06-11T12:30:00Z';
    const created = await withFakeNow(t1, () =>
      upsertPick(db, user.id, {
        ...basePick(entry.id),
        matchId,
        predScorer: 'Lautaro Martínez',
      }),
    );
    // Re-typing the accent-less spelling canonicalizes to the stored row —
    // identical pick, so nothing changes (especially not updatedAt).
    const resaved = await withFakeNow(t2, () =>
      upsertPick(db, user.id, {
        ...basePick(entry.id),
        matchId,
        predScorer: 'lautaro martinez',
      }),
    );
    expect(resaved.updatedAt).toBe(Date.parse(t1));
    expect(resaved).toEqual(created);
  });

  it('fails OPEN when both squads resolve empty (teams unknown to rosters.json, no players rows)', async () => {
    const { db, user, entry } = setup();
    // Codes that exist in neither the players table nor data/rosters.json —
    // missing squad data must never lock players out of the scorer component.
    db.insert(schema.teams)
      .values([
        { id: 90, code: 'XX1', name: 'Mystery FC', groupLetter: 'Z' },
        { id: 91, code: 'XX2', name: 'Unknown United', groupLetter: 'Z' },
      ])
      .run();
    const matchId = 44;
    db.insert(schema.matches)
      .values({
        id: matchId,
        stage: 'group',
        kickoffUtc: KICKOFF_UTC,
        matchday: MATCHDAY,
        venue: 'Test Stadium',
        city: 'Test City',
        homeTeamId: 90,
        awayTeamId: 91,
      })
      .run();
    await withFakeNow(BEFORE_KICKOFF, async () => {
      const saved = await upsertPick(db, user.id, {
        ...basePick(entry.id),
        matchId,
        predScorer: 'Anyone At All',
      });
      expect(saved.predScorer).toBe('Anyone At All');
    });
  });

  it('grandfathers an identical re-save of a stored off-squad scorer, but re-validates on any change', async () => {
    const { db, user, entry, matchId } = setupWithSquads();
    // A pre-rule pick stored before validation existed (inserted directly).
    db.insert(schema.picks)
      .values({
        entryId: entry.id,
        matchId,
        predHome: 2,
        predAway: 1,
        predScorer: 'Martinez', // bare surname — would fail validation today
        predFirstTeam: 'home',
        createdAt: 5,
        updatedAt: 7,
      })
      .run();
    await withFakeNow(BEFORE_KICKOFF, async () => {
      // Byte-identical re-save: the no-op short-circuit runs BEFORE validation.
      const resaved = await upsertPick(db, user.id, {
        entryId: entry.id,
        matchId,
        predHome: 2,
        predAway: 1,
        predScorer: 'Martinez',
        predFirstTeam: 'home',
      });
      expect(resaved.predScorer).toBe('Martinez');
      expect(resaved.updatedAt).toBe(7); // untouched — nothing was written
      // Changing anything (here: the scoreline) re-runs validation → 400.
      await expect(
        upsertPick(db, user.id, {
          entryId: entry.id,
          matchId,
          predHome: 3,
          predAway: 1,
          predScorer: 'Martinez',
          predFirstTeam: 'home',
        }),
      ).rejects.toMatchObject({ status: 400 });
    });
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
