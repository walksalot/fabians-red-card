import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import { getLiveBoards } from '@/lib/services/live';
import { runSync } from '@/lib/sync/espn-sync';
import { freshDb, withFakeNow } from '../helpers/db';

const KICKOFF = '2026-06-11T19:00:00Z';
const DURING = '2026-06-11T19:45:00Z'; // match underway
const BEFORE = '2026-06-11T10:00:00Z';

function seedWorld(db: Db) {
  db.insert(schema.teams).values([
    { id: 1, code: 'MEX', name: 'Mexico', groupLetter: 'A' },
    { id: 2, code: 'RSA', name: 'South Africa', groupLetter: 'A' },
  ]).run();
  db.insert(schema.matches).values({
    id: 1, stage: 'group', groupLetter: 'A', homeTeamId: 1, awayTeamId: 2,
    kickoffUtc: KICKOFF, matchday: '2026-06-11', venue: 'Azteca', city: 'CDMX',
    status: 'scheduled',
  }).run();
  const uid = Number(db.insert(schema.users).values({
    username: 'u', displayName: 'U', passwordHash: 'x', createdAt: 1,
  }).run().lastInsertRowid);
  const leagueId = Number(db.insert(schema.leagues).values({
    name: 'L', slug: 'l', inviteToken: 't', adminUserId: uid, createdAt: 1,
  }).run().lastInsertRowid);
  const entry = (label: string) =>
    Number(db.insert(schema.entries).values({ leagueId, userId: uid, label, createdAt: 1 }).run().lastInsertRowid);
  return { db, leagueId, uid, entry };
}

function setLive(db: Db, fields: Partial<typeof schema.matches.$inferInsert>) {
  db.update(schema.matches).set(fields).where(eq(schema.matches.id, 1)).run();
}

const pick = (db: Db, entryId: number, p: Partial<typeof schema.picks.$inferInsert>) =>
  db.insert(schema.picks).values({
    entryId, matchId: 1, predHome: 0, predAway: 0, predScorer: null,
    predFirstTeam: null, createdAt: 1, updatedAt: 1, ...p,
  }).run();

describe('getLiveBoards (if it ended now)', () => {
  it('returns nothing before kickoff and after a final result', async () => {
    const world = seedWorld(freshDb());
    const { db, leagueId } = world;
    world.entry('A');
    await withFakeNow(BEFORE, () => {
      expect(getLiveBoards(db, leagueId)).toHaveLength(0);
    });
    db.update(schema.matches).set({ status: 'finished' }).where(eq(schema.matches.id, 1)).run();
    await withFakeNow(DURING, () => {
      expect(getLiveBoards(db, leagueId)).toHaveLength(0);
    });
  });

  it('scores picks with the real engine against the live snapshot, boosters included', async () => {
    const world = seedWorld(freshDb());
    const { db, leagueId } = world;
    const exact = world.entry('Exact'); // 1-0, scorer hit, first-team hit
    const outcome = world.entry('Outcome'); // 2-1 home win, no scorer
    const miss = world.entry('Miss'); // away win
    pick(db, exact, { predHome: 1, predAway: 0, predScorer: 'Raúl Jiménez', predFirstTeam: 'home' });
    pick(db, outcome, { predHome: 2, predAway: 1, predFirstTeam: 'away' });
    pick(db, miss, { predHome: 0, predAway: 2, predFirstTeam: 'away' });
    // booster on the live match for the exact picker
    db.insert(schema.boosters).values({
      entryId: exact, matchday: '2026-06-11', matchId: 1, createdAt: 1, updatedAt: 1,
    }).run();
    setLive(db, {
      liveHome: 1, liveAway: 0, liveStatus: 'in', liveUpdatedAt: 5,
      liveFirstScorer: 'Raul Jimenez', liveFirstScoringTeam: 'home',
    });

    await withFakeNow(DURING, () => {
      const [board] = getLiveBoards(db, leagueId);
      expect(board.matchId).toBe(1);
      expect(board.hasLiveData).toBe(true);
      expect(board.liveHome).toBe(1);
      const by = Object.fromEntries(board.rows.map((r) => [r.label, r]));
      // exact 10 + scorer 8 (accent-forgiving) + firstTeam 2 = 20, boosted x2 = 40
      expect(by.Exact.total).toBe(40);
      expect(by.Exact.boosted).toBe(true);
      // right result only = 2 (firstTeam 'away' wrong)
      expect(by.Outcome.total).toBe(2);
      expect(by.Miss.total).toBe(0);
      // ranked: best provisional first
      expect(board.rows[0].label).toBe('Exact');
    });
  });

  it('entries without a pick rank last with no breakdown', async () => {
    const world = seedWorld(freshDb());
    const { db, leagueId } = world;
    const a = world.entry('A');
    world.entry('NoPick');
    pick(db, a, { predHome: 1, predAway: 0 });
    setLive(db, { liveHome: 1, liveAway: 0, liveStatus: 'in', liveUpdatedAt: 5 });
    await withFakeNow(DURING, () => {
      const [board] = getLiveBoards(db, leagueId);
      expect(board.rows[1].label).toBe('NoPick');
      expect(board.rows[1].pick).toBeNull();
      expect(board.rows[1].breakdown).toBeNull();
    });
  });

  it('kicked off but no feed data yet: board renders with hasLiveData=false and zero totals', async () => {
    const world = seedWorld(freshDb());
    const { db, leagueId } = world;
    pick(db, world.entry('A'), { predHome: 1, predAway: 0 });
    await withFakeNow(DURING, () => {
      const [board] = getLiveBoards(db, leagueId);
      expect(board.hasLiveData).toBe(false);
      expect(board.rows[0].breakdown).toBeNull();
      expect(board.rows[0].total).toBe(0);
    });
  });

  it('goals without an attributed first scorer never award first-team points', async () => {
    const world = seedWorld(freshDb());
    const { db, leagueId } = world;
    const nonePicker = world.entry('NonePicker');
    pick(db, nonePicker, { predHome: 0, predAway: 0, predFirstTeam: 'none' });
    setLive(db, { liveHome: 1, liveAway: 0, liveStatus: 'in', liveUpdatedAt: 5 }); // no scorer attribution
    await withFakeNow(DURING, () => {
      const [board] = getLiveBoards(db, leagueId);
      const row = board.rows[0];
      expect(row.breakdown?.firstTeam).toBe(0); // no phantom 'none' award at 1-0
      expect(row.total).toBe(0);
    });
  });

  it('live first-goal facts flow in from the feed and clear at full time', async () => {
    const world = seedWorld(freshDb());
    const { db } = world;
    const liveEvent = (completed: boolean) => [{
      date: '2026-06-11T19:00Z',
      name: 'RSA @ MEX',
      competitions: [{
        status: { type: { completed, state: completed ? 'post' : 'in' } },
        competitors: [
          { homeAway: 'home', score: '1', team: { id: '100', abbreviation: 'MEX', displayName: 'Mexico' } },
          { homeAway: 'away', score: '0', team: { id: '200', abbreviation: 'RSA', displayName: 'South Africa' } },
        ],
        details: [{ scoringPlay: true, ownGoal: false, clock: { value: 540 }, team: { id: '100' }, athletesInvolved: [{ displayName: 'Julián Quiñones' }] }],
      }],
    }];
    await withFakeNow(DURING, async () => {
      await runSync(db, async () => liveEvent(false));
      const m = db.select().from(schema.matches).where(eq(schema.matches.id, 1)).get();
      expect(m?.liveFirstScorer).toBe('Julián Quiñones');
      expect(m?.liveFirstScoringTeam).toBe('home');
      await runSync(db, async () => liveEvent(true)); // full time
      const done = db.select().from(schema.matches).where(eq(schema.matches.id, 1)).get();
      expect(done?.status).toBe('finished');
      expect(done?.liveFirstScorer).toBeNull(); // live state cleared at FT
      expect(done?.firstScorer).toBe('Julián Quiñones'); // real result holds the fact now
    });
  });
});
