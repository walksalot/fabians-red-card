import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import { AppError } from '@/lib/errors';
import type { PointsBreakdown } from '@/lib/scoring';
import {
  clearResult,
  enterResult,
  recomputeMatch,
  recomputeLeague,
  requireResultsAdmin,
  setMatchTeams,
  setUnderdog,
} from '@/lib/services/results';
import { getLeaderboard } from '@/lib/services/leaderboard';
import { updateLeagueSettings } from '@/lib/services/leagues';
import { freshDb } from '../helpers/db';

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

function makeLeague(
  db: Db,
  adminUserId: number,
  overrides: Partial<typeof schema.leagues.$inferInsert> = {},
) {
  const n = ++seq;
  const league = db
    .insert(schema.leagues)
    .values({
      name: `League ${n}`,
      slug: `league-${n}`,
      inviteToken: `token-${n}`,
      adminUserId,
      createdAt: 1,
      ...overrides,
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

function makeTeam(db: Db, id: number, code: string) {
  return db
    .insert(schema.teams)
    .values({ id, code, name: code, groupLetter: 'A' })
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
  p: {
    predHome: number;
    predAway: number;
    predScorer?: string | null;
    predFirstTeam?: 'home' | 'away' | 'none' | null;
  },
) {
  return db
    .insert(schema.picks)
    .values({
      entryId,
      matchId,
      predHome: p.predHome,
      predAway: p.predAway,
      predScorer: p.predScorer ?? null,
      predFirstTeam: p.predFirstTeam ?? null,
      createdAt: 1,
      updatedAt: 1,
    })
    .returning()
    .get();
}

function pointsFor(db: Db, entryId: number, matchId: number) {
  const row = db
    .select()
    .from(schema.matchPoints)
    .where(
      and(eq(schema.matchPoints.entryId, entryId), eq(schema.matchPoints.matchId, matchId)),
    )
    .get();
  if (!row) return null;
  return { ...row, parsed: JSON.parse(row.breakdown) as PointsBreakdown };
}

function expectAppError(fn: () => unknown, status: number) {
  try {
    fn();
    expect.unreachable('expected AppError to be thrown');
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).status).toBe(status);
  }
}

// ---------------------------------------------------------------------------

describe('results service', () => {
  it('entering a result computes points and updates the leaderboard automatically', () => {
    const db = freshDb();
    const admin = makeUser(db);
    const league = makeLeague(db, admin.id);
    const alice = makeUser(db);
    const bob = makeUser(db);
    const entryA = makeEntry(db, league.id, alice.id, 'Alice');
    const entryB = makeEntry(db, league.id, bob.id, 'Bob');
    makeMatch(db, 1);
    makePick(db, entryA.id, 1, {
      predHome: 2,
      predAway: 1,
      predScorer: 'Musiala',
      predFirstTeam: 'home',
    });
    makePick(db, entryB.id, 1, { predHome: 0, predAway: 0, predFirstTeam: 'none' });

    const match = enterResult(db, admin.id, {
      matchId: 1,
      homeScore: 2,
      awayScore: 1,
      firstScorer: 'Musiala',
      firstScoringTeam: 'home',
    });
    expect(match.status).toBe('finished');

    // Alice: exact 10 + scorer 8 + firstTeam 2 = 20; Bob: nothing right.
    const a = pointsFor(db, entryA.id, 1);
    expect(a?.total).toBe(20);
    expect(a?.parsed.exact).toBe(10);
    expect(a?.parsed.scorer).toBe(8);
    expect(a?.parsed.firstTeam).toBe(2);
    expect(pointsFor(db, entryB.id, 1)?.total).toBe(0);

    const rows = getLeaderboard(db, league.id);
    expect(rows.map((r) => [r.rank, r.entryId, r.total])).toEqual([
      [1, entryA.id, 20],
      [2, entryB.id, 0],
    ]);
  });

  it('editing a result recomputes points', () => {
    const db = freshDb();
    const admin = makeUser(db);
    const league = makeLeague(db, admin.id);
    const entry = makeEntry(db, league.id, makeUser(db).id);
    makeMatch(db, 1);
    makePick(db, entry.id, 1, { predHome: 2, predAway: 1, predFirstTeam: 'home' });

    enterResult(db, admin.id, {
      matchId: 1,
      homeScore: 1,
      awayScore: 0,
      firstScorer: null,
      firstScoringTeam: 'home',
    });
    expect(pointsFor(db, entry.id, 1)?.total).toBe(4); // outcome 2 + firstTeam 2

    enterResult(db, admin.id, {
      matchId: 1,
      homeScore: 2,
      awayScore: 1,
      firstScorer: null,
      firstScoringTeam: 'home',
    });
    const after = pointsFor(db, entry.id, 1);
    expect(after?.total).toBe(12); // exact 10 + firstTeam 2
    expect(after?.parsed.exact).toBe(10);
    expect(after?.parsed.outcome).toBe(0);

    const allRows = db
      .select()
      .from(schema.matchPoints)
      .where(eq(schema.matchPoints.entryId, entry.id))
      .all();
    expect(allRows).toHaveLength(1); // upsert, not duplicate
  });

  it('configurable round multipliers for knockout rounds multiply match points', () => {
    const db = freshDb();
    const admin = makeUser(db);
    const league = makeLeague(db, admin.id, {
      roundMultipliers: JSON.stringify({
        group: 1,
        r32: 1,
        r16: 1,
        qf: 2,
        sf: 1,
        third: 1,
        final: 3,
      }),
    });
    const entry = makeEntry(db, league.id, makeUser(db).id);
    makeTeam(db, 1, 'FRA');
    makeTeam(db, 2, 'BRA');
    makeMatch(db, 50, { stage: 'group' });
    makeMatch(db, 99, { stage: 'qf', homeTeamId: 1, awayTeamId: 2 });
    const pick = { predHome: 2, predAway: 0, predFirstTeam: 'home' as const };
    makePick(db, entry.id, 50, pick);
    makePick(db, entry.id, 99, pick);
    const result = {
      homeScore: 2,
      awayScore: 0,
      firstScorer: null,
      firstScoringTeam: 'home' as const,
    };

    enterResult(db, admin.id, { matchId: 50, ...result });
    enterResult(db, admin.id, { matchId: 99, ...result });

    const groupPoints = pointsFor(db, entry.id, 50);
    expect(groupPoints?.parsed.roundMultiplier).toBe(1);
    expect(groupPoints?.total).toBe(12); // base exact 10 + firstTeam 2

    const qfPoints = pointsFor(db, entry.id, 99);
    expect(qfPoints?.parsed.base).toBe(12);
    expect(qfPoints?.parsed.roundMultiplier).toBe(2);
    expect(qfPoints?.total).toBe(24);
  });

  it('booster doubles the points of the boosted match only', () => {
    const db = freshDb();
    const admin = makeUser(db);
    const league = makeLeague(db, admin.id); // boosterMultiplier default 2
    const entry = makeEntry(db, league.id, makeUser(db).id);
    makeMatch(db, 10, { matchday: '2026-06-15', kickoffUtc: '2026-06-15T16:00:00Z' });
    makeMatch(db, 11, { matchday: '2026-06-15', kickoffUtc: '2026-06-15T19:00:00Z' });
    const pick = { predHome: 1, predAway: 0, predFirstTeam: 'home' as const };
    makePick(db, entry.id, 10, pick);
    makePick(db, entry.id, 11, pick);
    db.insert(schema.boosters)
      .values({ entryId: entry.id, matchday: '2026-06-15', matchId: 10, createdAt: 1, updatedAt: 1 })
      .run();
    const result = {
      homeScore: 1,
      awayScore: 0,
      firstScorer: null,
      firstScoringTeam: 'home' as const,
    };

    enterResult(db, admin.id, { matchId: 10, ...result });
    enterResult(db, admin.id, { matchId: 11, ...result });

    const boosted = pointsFor(db, entry.id, 10);
    expect(boosted?.parsed.base).toBe(12);
    expect(boosted?.parsed.boosterMultiplier).toBe(2);
    expect(boosted?.total).toBe(24);

    const plain = pointsFor(db, entry.id, 11);
    expect(plain?.parsed.boosterMultiplier).toBe(1);
    expect(plain?.total).toBe(12);
  });

  it('underdog bonus is awarded via match underdog flag', () => {
    const db = freshDb();
    const admin = makeUser(db);
    const league = makeLeague(db, admin.id);
    const entry = makeEntry(db, league.id, makeUser(db).id);
    makeTeam(db, 1, 'FRA');
    makeTeam(db, 2, 'PAN');
    makeMatch(db, 20, { homeTeamId: 1, awayTeamId: 2 });
    makePick(db, entry.id, 20, { predHome: 0, predAway: 2, predFirstTeam: 'away' });

    enterResult(db, admin.id, {
      matchId: 20,
      homeScore: 1,
      awayScore: 2,
      firstScorer: null,
      firstScoringTeam: 'away',
    });
    expect(pointsFor(db, entry.id, 20)?.total).toBe(4); // outcome 2 + firstTeam 2

    setUnderdog(db, admin.id, { matchId: 20, underdogTeamId: 2 });
    const after = pointsFor(db, entry.id, 20);
    expect(after?.parsed.underdog).toBe(5);
    expect(after?.total).toBe(9); // recomputed because match already finished
  });

  it('enterResult requires the caller to be an admin of the primary league', () => {
    const db = freshDb();
    const admin = makeUser(db);
    const league = makeLeague(db, admin.id); // primary league (lowest id)
    const member = makeUser(db);
    db.insert(schema.memberships)
      .values({ leagueId: league.id, userId: member.id, role: 'member', createdAt: 1 })
      .run();
    makeMatch(db, 1);
    const result = {
      matchId: 1,
      homeScore: 1,
      awayScore: 0,
      firstScorer: null,
      firstScoringTeam: 'home' as const,
    };

    // A plain member is rejected.
    expectAppError(() => requireResultsAdmin(db, member.id), 403);
    expectAppError(() => enterResult(db, member.id, result), 403);

    // Creating their own league (which grants an 'admin' membership there)
    // must NOT grant global results authority — that would let any player
    // overwrite every league's results via a throwaway league.
    makeLeague(db, member.id);
    expectAppError(() => requireResultsAdmin(db, member.id), 403);
    expectAppError(() => enterResult(db, member.id, result), 403);
    expectAppError(
      () => setUnderdog(db, member.id, { matchId: 1, underdogTeamId: null }),
      403,
    );
    expectAppError(() => clearResult(db, member.id, 1), 403);

    // The primary league's admin still can.
    expect(enterResult(db, admin.id, result).status).toBe('finished');
  });

  it('enterResult validates scores are integers between 0 and 30', () => {
    const db = freshDb();
    const admin = makeUser(db);
    makeLeague(db, admin.id);
    makeMatch(db, 1);
    const base = { matchId: 1, firstScorer: null, firstScoringTeam: 'home' as const };

    expectAppError(() => enterResult(db, admin.id, { ...base, homeScore: -1, awayScore: 0 }), 400);
    expectAppError(() => enterResult(db, admin.id, { ...base, homeScore: 0, awayScore: 31 }), 400);
    expectAppError(() => enterResult(db, admin.id, { ...base, homeScore: 1.5, awayScore: 0 }), 400);
    expectAppError(
      () =>
        enterResult(db, admin.id, {
          matchId: 999,
          homeScore: 1,
          awayScore: 0,
          firstScorer: null,
          firstScoringTeam: 'home',
        }),
      404,
    );
  });

  it('a goalless result coerces first scorer to null and first scoring team to none', () => {
    const db = freshDb();
    const admin = makeUser(db);
    makeLeague(db, admin.id);
    makeMatch(db, 1);

    const match = enterResult(db, admin.id, {
      matchId: 1,
      homeScore: 0,
      awayScore: 0,
      firstScorer: 'Messi', // ignored: nobody scored
      firstScoringTeam: 'home',
    });
    expect(match.firstScorer).toBeNull();
    expect(match.firstScoringTeam).toBe('none');
  });

  it("enterResult rejects firstScoringTeam 'none' when goals were scored", () => {
    const db = freshDb();
    const admin = makeUser(db);
    makeLeague(db, admin.id);
    makeMatch(db, 1);

    expectAppError(
      () =>
        enterResult(db, admin.id, {
          matchId: 1,
          homeScore: 2,
          awayScore: 1,
          firstScorer: null,
          firstScoringTeam: 'none',
        }),
      400,
    );
  });

  it('setMatchTeams assigns knockout teams, clears placeholders, and rejects group matches', () => {
    const db = freshDb();
    const admin = makeUser(db);
    makeLeague(db, admin.id);
    makeTeam(db, 1, 'FRA');
    makeTeam(db, 2, 'BRA');
    makeMatch(db, 80, { stage: 'r16', homePlaceholder: '1A', awayPlaceholder: '2B' });
    makeMatch(db, 1, { stage: 'group' });

    const updated = setMatchTeams(db, admin.id, { matchId: 80, homeTeamId: 1, awayTeamId: 2 });
    expect(updated.homeTeamId).toBe(1);
    expect(updated.awayTeamId).toBe(2);
    expect(updated.homePlaceholder).toBeNull();
    expect(updated.awayPlaceholder).toBeNull();

    expectAppError(
      () => setMatchTeams(db, admin.id, { matchId: 1, homeTeamId: 1, awayTeamId: 2 }),
      400,
    );
    expectAppError(
      () => setMatchTeams(db, admin.id, { matchId: 80, homeTeamId: 1, awayTeamId: 999 }),
      404,
    );
  });

  it('setMatchTeams on a finished match recomputes points and clears a stale underdog flag', () => {
    const db = freshDb();
    const admin = makeUser(db);
    const league = makeLeague(db, admin.id);
    const entry = makeEntry(db, league.id, makeUser(db).id);
    makeTeam(db, 1, 'FRA');
    makeTeam(db, 2, 'PAN');
    makeTeam(db, 3, 'GER');
    makeTeam(db, 4, 'JPN');
    makeMatch(db, 80, { stage: 'r16', homeTeamId: 1, awayTeamId: 2 });
    makePick(db, entry.id, 80, { predHome: 0, predAway: 2, predFirstTeam: 'away' });

    setUnderdog(db, admin.id, { matchId: 80, underdogTeamId: 2 });
    enterResult(db, admin.id, {
      matchId: 80,
      homeScore: 0,
      awayScore: 2,
      firstScorer: null,
      firstScoringTeam: 'away',
    });
    const before = pointsFor(db, entry.id, 80);
    expect(before?.parsed.underdog).toBe(5);
    expect(before?.total).toBe(17); // exact 10 + firstTeam 2 + underdog 5

    // Correction keeps team 2 but flips it to the home slot: the flag stays,
    // and the recompute drops the bonus (the underdog side no longer won).
    const flipped = setMatchTeams(db, admin.id, { matchId: 80, homeTeamId: 2, awayTeamId: 3 });
    expect(flipped.underdogTeamId).toBe(2);
    const afterFlip = pointsFor(db, entry.id, 80);
    expect(afterFlip?.parsed.underdog).toBe(0);
    expect(afterFlip?.total).toBe(12);

    // Correction to a pair that no longer contains the flagged team clears it.
    const reassigned = setMatchTeams(db, admin.id, { matchId: 80, homeTeamId: 3, awayTeamId: 4 });
    expect(reassigned.underdogTeamId).toBeNull();
    const afterReassign = pointsFor(db, entry.id, 80);
    expect(afterReassign?.parsed.underdog).toBe(0);
    expect(afterReassign?.total).toBe(12); // exact + firstTeam only, no stale bonus
  });

  it('clearing a result reverts the match to scheduled and deletes its points', () => {
    const db = freshDb();
    const admin = makeUser(db);
    const league = makeLeague(db, admin.id);
    const entry = makeEntry(db, league.id, makeUser(db).id);
    makeMatch(db, 1);
    makePick(db, entry.id, 1, { predHome: 2, predAway: 1, predFirstTeam: 'home' });

    expectAppError(() => clearResult(db, admin.id, 1), 409); // nothing to clear yet

    enterResult(db, admin.id, {
      matchId: 1,
      homeScore: 2,
      awayScore: 1,
      firstScorer: null,
      firstScoringTeam: 'home',
    });
    expect(pointsFor(db, entry.id, 1)?.total).toBe(12);

    const cleared = clearResult(db, admin.id, 1);
    expect(cleared.status).toBe('scheduled');
    expect(cleared.homeScore).toBeNull();
    expect(cleared.awayScore).toBeNull();
    expect(cleared.firstScorer).toBeNull();
    expect(cleared.firstScoringTeam).toBeNull();
    expect(pointsFor(db, entry.id, 1)).toBeNull(); // phantom points removed

    expectAppError(() => clearResult(db, admin.id, 999), 404);
  });

  it('changing scoring settings via updateLeagueSettings recomputes stored points (unmocked)', async () => {
    const db = freshDb();
    const admin = makeUser(db);
    const league = makeLeague(db, admin.id);
    const entry = makeEntry(db, league.id, makeUser(db).id);
    makeMatch(db, 1);
    makePick(db, entry.id, 1, { predHome: 2, predAway: 1, predFirstTeam: 'home' });
    enterResult(db, admin.id, {
      matchId: 1,
      homeScore: 2,
      awayScore: 1,
      firstScorer: null,
      firstScoringTeam: 'home',
    });
    expect(pointsFor(db, entry.id, 1)?.total).toBe(12); // exact 10 + firstTeam 2

    // End-to-end through the leagues service (no mocks): the settings write
    // and the recompute must be wired together.
    await updateLeagueSettings(db, league.id, admin.id, {
      scoringRules: { exact: 20, outcome: 2, scorer: 8, firstTeam: 2, underdog: 5 },
    });
    const after = pointsFor(db, entry.id, 1);
    expect(after?.parsed.exact).toBe(20);
    expect(after?.total).toBe(22);
  });

  it("setUnderdog rejects a team that is not one of the match's teams", () => {
    const db = freshDb();
    const admin = makeUser(db);
    makeLeague(db, admin.id);
    makeTeam(db, 1, 'FRA');
    makeTeam(db, 2, 'PAN');
    makeTeam(db, 3, 'GER');
    makeMatch(db, 1, { homeTeamId: 1, awayTeamId: 2 });

    expectAppError(() => setUnderdog(db, admin.id, { matchId: 1, underdogTeamId: 3 }), 400);
    const cleared = setUnderdog(db, admin.id, { matchId: 1, underdogTeamId: null });
    expect(cleared.underdogTeamId).toBeNull();
  });

  it('recomputeMatch deletes points when the match is not finished', () => {
    const db = freshDb();
    const admin = makeUser(db);
    const league = makeLeague(db, admin.id);
    const entry = makeEntry(db, league.id, makeUser(db).id);
    makeMatch(db, 1); // scheduled
    db.insert(schema.matchPoints)
      .values({ entryId: entry.id, matchId: 1, breakdown: '{}', total: 99 })
      .run();

    recomputeMatch(db, 1);
    expect(pointsFor(db, entry.id, 1)).toBeNull();
  });

  it('recomputeLeague recomputes finished matches only for that league', () => {
    const db = freshDb();
    const adminA = makeUser(db);
    const adminB = makeUser(db);
    const leagueA = makeLeague(db, adminA.id);
    const leagueB = makeLeague(db, adminB.id);
    const entryA = makeEntry(db, leagueA.id, adminA.id);
    const entryB = makeEntry(db, leagueB.id, adminB.id);
    makeMatch(db, 1);
    const pick = { predHome: 2, predAway: 1, predFirstTeam: 'home' as const };
    makePick(db, entryA.id, 1, pick);
    makePick(db, entryB.id, 1, pick);
    enterResult(db, adminA.id, {
      matchId: 1,
      homeScore: 2,
      awayScore: 1,
      firstScorer: null,
      firstScoringTeam: 'home',
    });
    expect(pointsFor(db, entryA.id, 1)?.total).toBe(12);
    expect(pointsFor(db, entryB.id, 1)?.total).toBe(12);

    // League A doubles exact points; only league A entries change after recompute.
    db.update(schema.leagues)
      .set({
        scoringRules: JSON.stringify({ exact: 20, outcome: 2, scorer: 8, firstTeam: 2, underdog: 5 }),
      })
      .where(eq(schema.leagues.id, leagueA.id))
      .run();
    recomputeLeague(db, leagueA.id);

    expect(pointsFor(db, entryA.id, 1)?.total).toBe(22);
    expect(pointsFor(db, entryB.id, 1)?.total).toBe(12);
  });
});
