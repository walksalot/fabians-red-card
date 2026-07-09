import { describe, expect, it } from 'vitest';
import { createTestDb, schema, type Db } from '@/db';
import { computeMatchdayWrap, latestWrappableMatchday } from '@/lib/services/wrap';

/** Two finished matches on one day, three entries with varied outcomes. */
function seed(db: Db) {
  db.insert(schema.teams).values([
    { id: 1, code: 'MEX', name: 'Mexico', groupLetter: 'A' },
    { id: 2, code: 'ECU', name: 'Ecuador', groupLetter: 'F' },
  ]).run();
  db.insert(schema.matches).values([
    { id: 1, stage: 'group', homeTeamId: 1, awayTeamId: 2, kickoffUtc: '2026-06-11T19:00:00Z', matchday: '2026-06-11', venue: 'V', city: 'C', status: 'finished', homeScore: 2, awayScore: 0 },
    { id: 2, stage: 'group', homeTeamId: 2, awayTeamId: 1, kickoffUtc: '2026-06-11T22:00:00Z', matchday: '2026-06-11', venue: 'V', city: 'C', status: 'finished', homeScore: 1, awayScore: 1 },
    { id: 3, stage: 'group', homeTeamId: 1, awayTeamId: 2, kickoffUtc: '2026-06-12T19:00:00Z', matchday: '2026-06-12', venue: 'V', city: 'C', status: 'scheduled' },
  ]).run();
  const userId = Number(db.insert(schema.users).values({ username: 'u', displayName: 'U', passwordHash: 'x', createdAt: 1 }).run().lastInsertRowid);
  const leagueId = Number(db.insert(schema.leagues).values({ name: 'L', slug: 'l', inviteToken: 't', adminUserId: userId, createdAt: 1 }).run().lastInsertRowid);
  const mk = (label: string) => Number(db.insert(schema.entries).values({ leagueId, userId, label, createdAt: 1 }).run().lastInsertRowid);
  const a = mk('Ada'); const b = mk('Ben'); const c = mk('Cy');
  const bd = (exact: number, outcome: number, total: number) =>
    JSON.stringify({ exact, outcome, scorer: 0, firstTeam: 0, underdog: 0, base: exact + outcome, roundMultiplier: 1, boosterMultiplier: 1, total });
  db.insert(schema.matchPoints).values([
    // match 1: Ada exact (12), Ben outcome (2), Cy zero
    { entryId: a, matchId: 1, breakdown: bd(10, 0, 12), total: 12 },
    { entryId: b, matchId: 1, breakdown: bd(0, 2, 2), total: 2 },
    { entryId: c, matchId: 1, breakdown: bd(0, 0, 0), total: 0 },
    // match 2: only Ben called it (sole caller)
    { entryId: a, matchId: 2, breakdown: bd(0, 0, 0), total: 0 },
    { entryId: b, matchId: 2, breakdown: bd(0, 2, 2), total: 2 },
    { entryId: c, matchId: 2, breakdown: bd(0, 0, 0), total: 0 },
  ]).run();
  return { leagueId, a, b, c };
}

describe('computeMatchdayWrap', () => {
  it('crowns the day winner, finds the biggest haul, blanks and sole calls', () => {
    const db = createTestDb();
    const { leagueId, a, b, c } = seed(db);
    const wrap = computeMatchdayWrap(db, leagueId, '2026-06-11')!;
    expect(wrap.matchCount).toBe(2);
    expect(wrap.dayWinners.map((w) => w.entryId)).toEqual([a]); // 12 pts
    expect(wrap.biggestHaul).toEqual({
      points: 12,
      holders: [expect.objectContaining({ entryId: a, matchId: 1 })],
    });
    expect(wrap.blankedCount).toBe(1); // Cy
    expect(wrap.exactCount).toBe(1);
    expect(wrap.soleCalls).toEqual([
      expect.objectContaining({ entryId: b, matchId: 2 }),
    ]);
    expect(wrap.dayTotals[0]).toMatchObject({ entryId: a, total: 12 });
    void c;
  });

  it("an entry with NO picks that day skipped it — it didn't 'blank' it", () => {
    const db = createTestDb();
    const { leagueId } = seed(db);
    // Fourth entry, zero picks (no matchPoints rows at all on the day).
    const league = db.select().from(schema.leagues).all()[0];
    db.insert(schema.entries)
      .values({ leagueId: league.id, userId: league.adminUserId, label: 'Dot', createdAt: 1 })
      .run();
    const wrap = computeMatchdayWrap(db, leagueId, '2026-06-11')!;
    expect(wrap.blankedCount).toBe(1); // still only Cy — Dot never played
    // …but Dot still appears in the day totals table with 0.
    expect(wrap.dayTotals.some((t) => t.label === 'Dot' && t.total === 0)).toBe(true);
  });

  it('day-winner and biggest-haul ties survive float drift (micro-point rounding)', () => {
    const db = createTestDb();
    const { leagueId, a, b } = seed(db);
    db.delete(schema.matchPoints).run();
    const bd = (total: number) =>
      JSON.stringify({ exact: 0, outcome: 2, scorer: 0, firstTeam: 0, underdog: 0, base: 2, roundMultiplier: 1.5, boosterMultiplier: 1, total });
    // 0.1 + 0.2 !== 0.3 in floats: identical hauls accumulated differently
    // must still tie for the day win and share the biggest haul.
    db.insert(schema.matchPoints).values([
      // a accumulates 0.1 + 0.2 (= 0.30000000000000004 in floats); b holds
      // exactly 0.3 — identical scores that differ only by float drift.
      { entryId: a, matchId: 1, breakdown: bd(0.1), total: 0.1 },
      { entryId: a, matchId: 2, breakdown: bd(0.2), total: 0.2 },
      { entryId: b, matchId: 1, breakdown: bd(0.3), total: 0.3 },
    ]).run();
    const wrap = computeMatchdayWrap(db, leagueId, '2026-06-11')!;
    expect(wrap.dayWinners.map((w) => w.entryId).sort()).toEqual([a, b].sort());
  });

  it('a tied biggest haul credits EVERY holder, not the first row scanned', () => {
    // The live-league bug: ~10 entries hit the same top haul on one match and
    // the wrap named a single arbitrary entry. All holders must be reported.
    const db = createTestDb();
    const { leagueId, a, b, c } = seed(db);
    db.delete(schema.matchPoints).run();
    const bd = JSON.stringify({ exact: 10, outcome: 0, scorer: 0, firstTeam: 0, underdog: 0, base: 10, roundMultiplier: 1, boosterMultiplier: 1, total: 12 });
    db.insert(schema.matchPoints).values([
      // Same top haul on the same match for all three entries.
      { entryId: a, matchId: 1, breakdown: bd, total: 12 },
      { entryId: b, matchId: 1, breakdown: bd, total: 12 },
      { entryId: c, matchId: 1, breakdown: bd, total: 12 },
      { entryId: a, matchId: 2, breakdown: bd, total: 3 },
    ]).run();
    const wrap = computeMatchdayWrap(db, leagueId, '2026-06-11')!;
    expect(wrap.biggestHaul!.points).toBe(12);
    expect(wrap.biggestHaul!.holders.map((h) => h.entryId)).toEqual([a, b, c]);
    expect(new Set(wrap.biggestHaul!.holders.map((h) => h.matchId))).toEqual(new Set([1]));
  });

  it('a biggest-haul tie can span different matches', () => {
    const db = createTestDb();
    const { leagueId, a, b } = seed(db);
    db.delete(schema.matchPoints).run();
    const bd = JSON.stringify({ exact: 10, outcome: 0, scorer: 0, firstTeam: 0, underdog: 0, base: 10, roundMultiplier: 1, boosterMultiplier: 1, total: 12 });
    db.insert(schema.matchPoints).values([
      { entryId: a, matchId: 1, breakdown: bd, total: 12 },
      { entryId: b, matchId: 2, breakdown: bd, total: 12 },
    ]).run();
    const wrap = computeMatchdayWrap(db, leagueId, '2026-06-11')!;
    expect(wrap.biggestHaul!.holders).toHaveLength(2);
    expect(new Set(wrap.biggestHaul!.holders.map((h) => h.matchId))).toEqual(new Set([1, 2]));
  });

  it('an all-zero day has no biggest haul', () => {
    const db = createTestDb();
    const { leagueId } = seed(db);
    db.delete(schema.matchPoints).run();
    const bd = JSON.stringify({ exact: 0, outcome: 0, scorer: 0, firstTeam: 0, underdog: 0, base: 0, roundMultiplier: 1, boosterMultiplier: 1, total: 0 });
    db.insert(schema.matchPoints).values([
      { entryId: 1, matchId: 1, breakdown: bd, total: 0 },
    ]).run();
    const wrap = computeMatchdayWrap(db, leagueId, '2026-06-11')!;
    expect(wrap.biggestHaul).toBeNull();
  });

  it('returns null for a day with no finished matches', () => {
    const db = createTestDb();
    const { leagueId } = seed(db);
    expect(computeMatchdayWrap(db, leagueId, '2026-06-12')).toBeNull();
  });

  it('latestWrappableMatchday skips partially-finished days and days at/after the cutoff', () => {
    const db = createTestDb();
    seed(db);
    expect(latestWrappableMatchday(db, '2026-06-12')).toBe('2026-06-11');
    expect(latestWrappableMatchday(db, '2026-06-11')).toBeNull();
  });
});
