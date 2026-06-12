import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { schema } from '@/db';
import {
  fixNullSurnameArtifacts,
  scrubInvalidFutureScorers,
} from '@/lib/data-fixes';
import { freshDb, withFakeNow } from '../helpers/db';

/** Pinned clock for every repair run — between the past and future kickoffs. */
const NOW = '2026-06-12T00:00:00Z';

const FUTURE_MATCH = 1; // scheduled, kicks off after NOW → repairs may touch
const FINISHED_MATCH = 2; // finished → must stay byte-identical
const KICKED_OFF_MATCH = 3; // scheduled but already kicked off → byte-identical
const TBD_MATCH = 4; // future, away team unknown (knockout placeholder)

function seedWorld() {
  const db = freshDb();
  db.insert(schema.teams)
    .values([
      { id: 30, code: 'BRA', name: 'Brazil', groupLetter: 'C' },
      // MEX has NO players rows → squad resolution falls back to rosters.json.
      { id: 31, code: 'MEX', name: 'Mexico', groupLetter: 'A' },
    ])
    .run();
  db.insert(schema.players)
    .values([
      { teamId: 30, name: 'Casemiro null', position: 'M' },
      { teamId: 30, name: 'Endrick null', position: 'F' },
      { teamId: 30, name: 'Vinicius Junior', position: 'F' }, // untouched
    ])
    .run();
  const user = db
    .insert(schema.users)
    .values({ username: 'u1', displayName: 'U1', passwordHash: 'x', createdAt: 0 })
    .returning()
    .get();
  const league = db
    .insert(schema.leagues)
    .values({ name: 'L', slug: 'l', inviteToken: 't', adminUserId: user.id, createdAt: 0 })
    .returning()
    .get();
  const entry = db
    .insert(schema.entries)
    .values({ leagueId: league.id, userId: user.id, label: 'E', createdAt: 0 })
    .returning()
    .get();
  const entry2 = db
    .insert(schema.entries)
    .values({ leagueId: league.id, userId: user.id, label: 'E2', createdAt: 0 })
    .returning()
    .get();
  db.insert(schema.matches)
    .values([
      {
        id: FUTURE_MATCH,
        stage: 'group',
        kickoffUtc: '2026-06-15T16:00:00Z',
        matchday: '2026-06-15',
        venue: 'V',
        city: 'C',
        homeTeamId: 30,
        awayTeamId: 31,
      },
      {
        id: FINISHED_MATCH,
        stage: 'group',
        kickoffUtc: '2026-06-10T16:00:00Z',
        matchday: '2026-06-10',
        venue: 'V',
        city: 'C',
        homeTeamId: 30,
        awayTeamId: 31,
        status: 'finished',
        homeScore: 2,
        awayScore: 1,
      },
      {
        id: KICKED_OFF_MATCH,
        stage: 'group',
        kickoffUtc: '2026-06-11T16:00:00Z', // before NOW — locked in play
        matchday: '2026-06-11',
        venue: 'V',
        city: 'C',
        homeTeamId: 30,
        awayTeamId: 31,
      },
      {
        id: TBD_MATCH,
        stage: 'r32',
        kickoffUtc: '2026-06-29T16:00:00Z',
        matchday: '2026-06-29',
        venue: 'V',
        city: 'C',
        homeTeamId: 30,
        awayTeamId: null,
        awayPlaceholder: 'Winner of Group X',
      },
    ])
    .run();
  return { db, entry, entry2 };
}

function insertPick(
  db: ReturnType<typeof freshDb>,
  entryId: number,
  matchId: number,
  predScorer: string | null,
) {
  return db
    .insert(schema.picks)
    .values({
      entryId,
      matchId,
      predHome: 1,
      predAway: 0,
      predScorer,
      predFirstTeam: 'home',
      createdAt: 5,
      updatedAt: 7,
    })
    .returning()
    .get();
}

function pickById(db: ReturnType<typeof freshDb>, id: number) {
  return db.select().from(schema.picks).where(eq(schema.picks.id, id)).get()!;
}

describe('fixNullSurnameArtifacts', () => {
  it('strips the " null" scrape artifact from players and unkicked picks, once', async () => {
    const { db, entry } = seedWorld();
    const pick = insertPick(db, entry.id, FUTURE_MATCH, 'Casemiro null');

    const first = await withFakeNow(NOW, () => fixNullSurnameArtifacts(db));
    expect(first).toEqual({ playersFixed: 2, picksFixed: 1 });

    const names = db
      .select({ name: schema.players.name })
      .from(schema.players)
      .all()
      .map((r) => r.name)
      .sort();
    expect(names).toEqual(['Casemiro', 'Endrick', 'Vinicius Junior']);

    const healed = pickById(db, pick.id);
    expect(healed.predScorer).toBe('Casemiro');
    // A repair is not an edit: timestamps untouched.
    expect(healed.updatedAt).toBe(7);
    expect(healed.createdAt).toBe(5);

    // Idempotent: a second boot fixes nothing more.
    expect(await withFakeNow(NOW, () => fixNullSurnameArtifacts(db))).toEqual({
      playersFixed: 0,
      picksFixed: 0,
    });
  });

  it('deletes the artifact row when the clean name already exists for the team (prod seed order)', async () => {
    const { db, entry } = seedWorld();
    // The prod seed inserts the CLEAN name before the repair runs — renaming
    // "Casemiro null" would collide with the (team_id, name) unique key.
    db.insert(schema.players)
      .values({ teamId: 30, name: 'Casemiro', position: 'M' })
      .run();
    const pick = insertPick(db, entry.id, FUTURE_MATCH, 'Casemiro null');

    const result = await withFakeNow(NOW, () => fixNullSurnameArtifacts(db));
    expect(result).toEqual({ playersFixed: 2, picksFixed: 1 }); // delete + rename

    // Exactly ONE Casemiro row remains for the team — the artifact is gone.
    const casemiros = db
      .select()
      .from(schema.players)
      .where(
        and(eq(schema.players.teamId, 30), eq(schema.players.name, 'Casemiro')),
      )
      .all();
    expect(casemiros).toHaveLength(1);
    expect(
      db.select().from(schema.players).where(eq(schema.players.name, 'Casemiro null')).all(),
    ).toHaveLength(0);

    // The pick heal still happened (separate transaction).
    expect(pickById(db, pick.id).predScorer).toBe('Casemiro');
  });

  it('never touches picks on finished or kicked-off matches (banked points stay safe)', async () => {
    const { db, entry, entry2 } = seedWorld();
    const onFinished = insertPick(db, entry.id, FINISHED_MATCH, 'Casemiro null');
    const onKickedOff = insertPick(db, entry.id, KICKED_OFF_MATCH, 'Casemiro null');
    const onFuture = insertPick(db, entry2.id, FUTURE_MATCH, 'Casemiro null');

    const result = await withFakeNow(NOW, () => fixNullSurnameArtifacts(db));
    expect(result.picksFixed).toBe(1); // only the future pick

    // Finished/kicked-off picks are byte-identical — no later recompute can
    // ever change the points they banked.
    expect(pickById(db, onFinished.id)).toEqual(onFinished);
    expect(pickById(db, onKickedOff.id)).toEqual(onKickedOff);
    expect(pickById(db, onFuture.id).predScorer).toBe('Casemiro');
  });

  it('is a no-op on clean data', async () => {
    const { db } = seedWorld();
    db.update(schema.players).set({ name: 'Casemiro' }).where(eq(schema.players.name, 'Casemiro null')).run();
    db.update(schema.players).set({ name: 'Endrick' }).where(eq(schema.players.name, 'Endrick null')).run();
    expect(await withFakeNow(NOW, () => fixNullSurnameArtifacts(db))).toEqual({
      playersFixed: 0,
      picksFixed: 0,
    });
  });
});

describe('scrubInvalidFutureScorers', () => {
  it('nulls an invalid scorer on a future match — everything else untouched', async () => {
    const { db, entry, entry2 } = seedWorld();
    const invalid = insertPick(db, entry.id, FUTURE_MATCH, 'Definitely Not A Player');
    const valid = insertPick(db, entry2.id, FUTURE_MATCH, 'Vinicius Junior');

    const result = await withFakeNow(NOW, () => scrubInvalidFutureScorers(db));
    expect(result).toEqual({ scorersCleared: 1 });

    const cleared = pickById(db, invalid.id);
    expect(cleared.predScorer).toBeNull();
    // Only the scorer goes — scoreline, first team and timestamps stay theirs.
    expect(cleared.predHome).toBe(1);
    expect(cleared.predAway).toBe(0);
    expect(cleared.predFirstTeam).toBe('home');
    expect(cleared.createdAt).toBe(5);
    expect(cleared.updatedAt).toBe(7);

    expect(pickById(db, valid.id).predScorer).toBe('Vinicius Junior');

    // Idempotent: nothing left to clear on the next boot.
    expect(await withFakeNow(NOW, () => scrubInvalidFutureScorers(db))).toEqual({
      scorersCleared: 0,
    });
  });

  it('accepts a fallback-squad scorer (team without players rows)', async () => {
    const { db, entry } = seedWorld();
    // Raúl Jiménez is on MEX's squad in data/rosters.json; MEX has no rows.
    const pick = insertPick(db, entry.id, FUTURE_MATCH, 'Raúl Jiménez');
    const result = await withFakeNow(NOW, () => scrubInvalidFutureScorers(db));
    expect(result).toEqual({ scorersCleared: 0 });
    expect(pickById(db, pick.id).predScorer).toBe('Raúl Jiménez');
  });

  it('TBD match: bare surname is nulled, a real full name from ANY squad is kept', async () => {
    const { db, entry, entry2 } = seedWorld();
    const surname = insertPick(db, entry.id, TBD_MATCH, 'Martinez');
    // Lautaro Martínez plays for Argentina — neither side of this match, but a
    // real player you might predict for the unknown opponent.
    const anySquad = insertPick(db, entry2.id, TBD_MATCH, 'Lautaro Martínez');

    const result = await withFakeNow(NOW, () => scrubInvalidFutureScorers(db));
    expect(result).toEqual({ scorersCleared: 1 });
    expect(pickById(db, surname.id).predScorer).toBeNull();
    expect(pickById(db, anySquad.id).predScorer).toBe('Lautaro Martínez');
  });

  it('never touches picks on finished or kicked-off matches', async () => {
    const { db, entry, entry2 } = seedWorld();
    const onFinished = insertPick(db, entry.id, FINISHED_MATCH, 'Total Garbage');
    const onKickedOff = insertPick(db, entry2.id, KICKED_OFF_MATCH, 'Total Garbage');

    const result = await withFakeNow(NOW, () => scrubInvalidFutureScorers(db));
    expect(result).toEqual({ scorersCleared: 0 });
    expect(pickById(db, onFinished.id)).toEqual(onFinished);
    expect(pickById(db, onKickedOff.id)).toEqual(onKickedOff);
  });
});
