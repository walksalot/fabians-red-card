import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import {
  knockoutAdvancers,
  propagateAllKnockouts,
  propagateMatch,
} from '@/lib/services/bracket-propagation';
import { clearResult, enterResult, setMatchTeams, setUnderdog } from '@/lib/services/results';
import { freshDb } from '../helpers/db';

// ---------------------------------------------------------------------------
// Fixtures via DIRECT drizzle inserts (never through other agents' services).
// Match ids are REAL fixture numbers — the propagation wiring comes from
// data/fixtures.json, so tests must speak the same bracket: 89/90 (R16) feed
// 97 (QF); 101/102 (SF) feed 103 (third place, losers) and 104 (final).
// ---------------------------------------------------------------------------

let seq = 0;

function makeAdmin(db: Db) {
  const admin = db
    .insert(schema.users)
    .values({
      username: `admin${++seq}`,
      displayName: 'Admin',
      passwordHash: 'test-hash',
      createdAt: 1,
    })
    .returning()
    .get();
  const league = db
    .insert(schema.leagues)
    .values({
      name: `League ${seq}`,
      slug: `league-${seq}`,
      inviteToken: `token-${seq}`,
      adminUserId: admin.id,
      createdAt: 1,
    })
    .returning()
    .get();
  db.insert(schema.memberships)
    .values({ leagueId: league.id, userId: admin.id, role: 'admin', createdAt: 1 })
    .run();
  return admin;
}

function makeTeam(db: Db, id: number, code: string) {
  db.insert(schema.teams).values({ id, code, name: code, groupLetter: 'A' }).run();
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
      stage: 'r16',
      kickoffUtc: '2026-07-06T19:00:00Z',
      matchday: '2026-07-06',
      venue: 'V',
      city: 'C',
      ...overrides,
    })
    .returning()
    .get();
}

function matchById(db: Db, id: number) {
  return db.select().from(schema.matches).where(eq(schema.matches.id, id)).get()!;
}

/** The standard scene: R16 pair 89/90 with teams, their QF child 97 as seeded. */
function seedQuarterFinalScene(db: Db) {
  makeTeam(db, 1, 'SUI');
  makeTeam(db, 2, 'COL');
  makeTeam(db, 3, 'ENG');
  makeTeam(db, 4, 'FRA');
  makeMatch(db, 89, { homeTeamId: 1, awayTeamId: 2 });
  makeMatch(db, 90, { homeTeamId: 3, awayTeamId: 4 });
  makeMatch(db, 97, {
    stage: 'qf',
    kickoffUtc: '2026-07-09T20:00:00Z',
    matchday: '2026-07-09',
    homePlaceholder: 'Winners Match 89',
    awayPlaceholder: 'Winners Match 90',
  });
}

describe('knockoutAdvancers', () => {
  it('names the winner by score margin and by shootout margin on a level tie', () => {
    const db = freshDb();
    seedQuarterFinalScene(db);
    db.update(schema.matches)
      .set({ status: 'finished', homeScore: 2, awayScore: 1 })
      .where(eq(schema.matches.id, 89))
      .run();
    expect(knockoutAdvancers(matchById(db, 89))).toEqual({ winner: 1, loser: 2 });

    db.update(schema.matches)
      .set({ status: 'finished', homeScore: 0, awayScore: 0, homePens: 2, awayPens: 4 })
      .where(eq(schema.matches.id, 89))
      .run();
    expect(knockoutAdvancers(matchById(db, 89))).toEqual({ winner: 2, loser: 1 });
  });

  it('is undecidable while unfinished, level without tallies, or teams unknown', () => {
    const db = freshDb();
    seedQuarterFinalScene(db);
    expect(knockoutAdvancers(matchById(db, 89))).toBeNull(); // scheduled

    db.update(schema.matches)
      .set({ status: 'finished', homeScore: 1, awayScore: 1 })
      .where(eq(schema.matches.id, 89))
      .run();
    expect(knockoutAdvancers(matchById(db, 89))).toBeNull(); // level, pens unknown

    db.update(schema.matches)
      .set({ homeTeamId: null, homeScore: 2, awayScore: 0 })
      .where(eq(schema.matches.id, 89))
      .run();
    expect(knockoutAdvancers(matchById(db, 89))).toBeNull(); // team missing
  });
});

describe('knockout winner propagation', () => {
  it('a decisive result flows straight into the next round slot (placeholder cleared)', () => {
    const db = freshDb();
    const admin = makeAdmin(db);
    seedQuarterFinalScene(db);

    enterResult(db, admin.id, {
      matchId: 89,
      homeScore: 2,
      awayScore: 1,
      firstScorer: null,
      firstScoringTeam: 'home',
    });
    const qf = matchById(db, 97);
    expect(qf.homeTeamId).toBe(1); // SUI advanced
    expect(qf.homePlaceholder).toBeNull();
    expect(qf.awayTeamId).toBeNull(); // other feeder still undecided
    expect(qf.awayPlaceholder).toBe('Winners Match 90');
  });

  it('a shootout tie advances the pens winner — the SUI 0-0 COL bug scene', () => {
    const db = freshDb();
    const admin = makeAdmin(db);
    seedQuarterFinalScene(db);

    // Banked as 0-0 with no tallies yet: slot must stay open, nobody guessed.
    enterResult(db, admin.id, {
      matchId: 89,
      homeScore: 0,
      awayScore: 0,
      firstScorer: null,
      firstScoringTeam: 'none',
    });
    expect(matchById(db, 97).homeTeamId).toBeNull();

    // Tallies arrive (backfill or admin re-entry): Colombia advance.
    enterResult(db, admin.id, {
      matchId: 89,
      homeScore: 0,
      awayScore: 0,
      firstScorer: null,
      firstScoringTeam: 'none',
      homePens: 2,
      awayPens: 4,
    });
    const qf = matchById(db, 97);
    expect(qf.homeTeamId).toBe(2); // COL via pens
    expect(qf.homePlaceholder).toBeNull();
  });

  it('a corrected result replaces the previously propagated team (but never a foreign fill)', () => {
    const db = freshDb();
    const admin = makeAdmin(db);
    seedQuarterFinalScene(db);

    enterResult(db, admin.id, {
      matchId: 89,
      homeScore: 2,
      awayScore: 1,
      firstScorer: null,
      firstScoringTeam: 'home',
    });
    expect(matchById(db, 97).homeTeamId).toBe(1);

    // Fat-fingered the sides — the re-entered result flips the winner.
    enterResult(db, admin.id, {
      matchId: 89,
      homeScore: 1,
      awayScore: 2,
      firstScorer: null,
      firstScoringTeam: 'home',
    });
    expect(matchById(db, 97).homeTeamId).toBe(2);

    // An admin override to a team from OUTSIDE the tie is never touched.
    db.update(schema.matches).set({ homeTeamId: 3 }).where(eq(schema.matches.id, 97)).run();
    propagateMatch(db, matchById(db, 89));
    expect(matchById(db, 97).homeTeamId).toBe(3);
  });

  it('clearing a result reverts our fill to the seeded placeholder', () => {
    const db = freshDb();
    const admin = makeAdmin(db);
    seedQuarterFinalScene(db);

    enterResult(db, admin.id, {
      matchId: 89,
      homeScore: 0,
      awayScore: 0,
      firstScorer: null,
      firstScoringTeam: 'none',
      homePens: 4,
      awayPens: 3,
    });
    expect(matchById(db, 97).homeTeamId).toBe(1);

    clearResult(db, admin.id, 89);
    const qf = matchById(db, 97);
    expect(qf.homeTeamId).toBeNull();
    expect(qf.homePlaceholder).toBe('Winners Match 89'); // restored from fixtures
  });

  it('a semifinal feeds its winner to the final and its loser to the third-place tie', () => {
    const db = freshDb();
    const admin = makeAdmin(db);
    makeTeam(db, 5, 'GER');
    makeTeam(db, 6, 'PAR');
    makeMatch(db, 101, { stage: 'sf', homeTeamId: 5, awayTeamId: 6 });
    makeMatch(db, 103, {
      stage: 'third',
      homePlaceholder: 'Losers Match 101',
      awayPlaceholder: 'Losers Match 102',
    });
    makeMatch(db, 104, {
      stage: 'final',
      homePlaceholder: 'Winners Match 101',
      awayPlaceholder: 'Winners Match 102',
    });

    enterResult(db, admin.id, {
      matchId: 101,
      homeScore: 2,
      awayScore: 2,
      firstScorer: 'Somebody',
      firstScoringTeam: 'home',
      homePens: 3,
      awayPens: 5,
    });
    expect(matchById(db, 104).homeTeamId).toBe(6); // Paraguay to the final
    expect(matchById(db, 103).homeTeamId).toBe(5); // Germany to the third-place tie
    expect(matchById(db, 103).awayTeamId).toBeNull(); // other semi undecided
  });

  it('a finished tie missing its tallies never un-fills a slot the legacy path already filled', () => {
    const db = freshDb();
    seedQuarterFinalScene(db);
    // Legacy production shape: the tie banked 0-0 BEFORE pens support, and
    // the old ESPN/admin team fill already placed the true advancer (SUI) in
    // the QF slot. The sweep must not "revert" what it never wrote.
    db.update(schema.matches)
      .set({ status: 'finished', homeScore: 0, awayScore: 0, resultSource: 'auto' })
      .where(eq(schema.matches.id, 89))
      .run();
    db.update(schema.matches)
      .set({ homeTeamId: 1, homePlaceholder: null })
      .where(eq(schema.matches.id, 97))
      .run();

    expect(propagateAllKnockouts(db)).toBe(0);
    const qf = matchById(db, 97);
    expect(qf.homeTeamId).toBe(1); // untouched
    expect(qf.homePlaceholder).toBeNull();
  });

  it('never re-teams a finished child match', () => {
    const db = freshDb();
    seedQuarterFinalScene(db);
    db.update(schema.matches)
      .set({ status: 'finished', homeScore: 2, awayScore: 1 })
      .where(eq(schema.matches.id, 89))
      .run();
    db.update(schema.matches)
      .set({ status: 'finished', homeTeamId: 3, awayTeamId: 4, homeScore: 1, awayScore: 0 })
      .where(eq(schema.matches.id, 97))
      .run();

    propagateMatch(db, matchById(db, 89));
    expect(matchById(db, 97).homeTeamId).toBe(3); // banked result untouched
  });

  it('clears a stale underdog flag when the propagated correction removes that team', () => {
    const db = freshDb();
    const admin = makeAdmin(db);
    seedQuarterFinalScene(db);

    enterResult(db, admin.id, {
      matchId: 89,
      homeScore: 2,
      awayScore: 1,
      firstScorer: null,
      firstScoringTeam: 'home',
    });
    // QF now SUI vs TBD; flag SUI as the underdog.
    db.update(schema.matches).set({ awayTeamId: 3 }).where(eq(schema.matches.id, 97)).run();
    setUnderdog(db, admin.id, { matchId: 97, underdogTeamId: 1 });

    // Correction: COL actually won the tie — SUI leaves the QF, flag must go.
    enterResult(db, admin.id, {
      matchId: 89,
      homeScore: 1,
      awayScore: 2,
      firstScorer: null,
      firstScoringTeam: 'home',
    });
    const qf = matchById(db, 97);
    expect(qf.homeTeamId).toBe(2);
    expect(qf.underdogTeamId).toBeNull();
  });

  it('correcting a finished feeder’s TEAMS moves the child slot to the new winner', () => {
    const db = freshDb();
    const admin = makeAdmin(db);
    seedQuarterFinalScene(db);

    enterResult(db, admin.id, {
      matchId: 89,
      homeScore: 2,
      awayScore: 1,
      firstScorer: null,
      firstScoringTeam: 'home',
    });
    expect(matchById(db, 97).homeTeamId).toBe(1); // SUI (home) won 2-1

    // The pairing itself was wrong: it was ENG (3) at home, not SUI. The old
    // pair's winner is stranded in the QF unless the correction follows.
    setMatchTeams(db, admin.id, { matchId: 89, homeTeamId: 3, awayTeamId: 2 });
    expect(matchById(db, 97).homeTeamId).toBe(3); // ENG replaces the stale SUI
  });

  it('re-entering a decisive result as level WITHOUT tallies reverts our fill (no fabricated advancer)', () => {
    const db = freshDb();
    const admin = makeAdmin(db);
    seedQuarterFinalScene(db);

    enterResult(db, admin.id, {
      matchId: 89,
      homeScore: 2,
      awayScore: 1,
      firstScorer: null,
      firstScoringTeam: 'home',
    });
    expect(matchById(db, 97).homeTeamId).toBe(1);

    // Correction: it actually finished level and the admin doesn't know the
    // shootout numbers yet — the previous fill is known-stale and must open
    // up again rather than leave SUI looking like the (unknown) advancer.
    enterResult(db, admin.id, {
      matchId: 89,
      homeScore: 1,
      awayScore: 1,
      firstScorer: null,
      firstScoringTeam: 'home',
    });
    const qf = matchById(db, 97);
    expect(qf.homeTeamId).toBeNull();
    expect(qf.homePlaceholder).toBe('Winners Match 89');
  });

  it('propagateAllKnockouts heals a whole stale bracket in one pass (cascades by id order)', () => {
    const db = freshDb();
    seedQuarterFinalScene(db);
    // Results banked while propagation did not exist yet: children never filled.
    db.update(schema.matches)
      .set({ status: 'finished', homeScore: 0, awayScore: 0, homePens: 2, awayPens: 4, resultSource: 'auto' })
      .where(eq(schema.matches.id, 89))
      .run();
    db.update(schema.matches)
      .set({ status: 'finished', homeScore: 3, awayScore: 1, resultSource: 'auto' })
      .where(eq(schema.matches.id, 90))
      .run();

    const writes = propagateAllKnockouts(db);
    expect(writes).toBe(2);
    const qf = matchById(db, 97);
    expect(qf.homeTeamId).toBe(2); // COL on pens
    expect(qf.awayTeamId).toBe(3); // ENG by margin
    expect(qf.homePlaceholder).toBeNull();
    expect(qf.awayPlaceholder).toBeNull();

    // Idempotent: a second sweep writes nothing.
    expect(propagateAllKnockouts(db)).toBe(0);
  });

  it('group-stage results never propagate through the knockout wiring', () => {
    const db = freshDb();
    makeTeam(db, 1, 'MEX');
    makeTeam(db, 2, 'RSA');
    // Group match with a knockout match's feeder id can't exist, but a plain
    // group game must simply be a no-op regardless of wiring.
    const m = makeMatch(db, 1, {
      stage: 'group',
      homeTeamId: 1,
      awayTeamId: 2,
      status: 'finished',
      homeScore: 2,
      awayScore: 0,
    });
    expect(propagateMatch(db, m)).toBe(0);
  });
});
