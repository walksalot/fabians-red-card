import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, schema, type Db } from '@/db';
import { runSync, autoSyncEnabled, getAppState } from '@/lib/sync/espn-sync';
import type { EspnEvent } from '@/lib/sync/espn-map';

const KICKOFF = '2026-06-11T19:00:00Z';

/** Minimal world: 2 teams, 1 group match, 1 league, 2 entries with picks. */
function seedWorld(db: Db) {
  db.insert(schema.teams).values([
    { id: 1, code: 'MEX', name: 'Mexico', groupLetter: 'A' },
    { id: 2, code: 'RSA', name: 'South Africa', groupLetter: 'A' },
  ]).run();
  db.insert(schema.matches).values({
    id: 1,
    stage: 'group',
    groupLetter: 'A',
    homeTeamId: 1,
    awayTeamId: 2,
    kickoffUtc: KICKOFF,
    matchday: '2026-06-11',
    venue: 'Estadio Azteca',
    city: 'Mexico City',
    status: 'scheduled',
  }).run();
  const userId = Number(
    db.insert(schema.users).values({ username: 'a', displayName: 'A', passwordHash: 'x', createdAt: 1 }).run().lastInsertRowid,
  );
  const leagueId = Number(
    db.insert(schema.leagues).values({
      name: 'L', slug: 'l', inviteToken: 'tok', adminUserId: userId, createdAt: 1,
    }).run().lastInsertRowid,
  );
  const e1 = Number(
    db.insert(schema.entries).values({ leagueId, userId, label: 'A', createdAt: 1 }).run().lastInsertRowid,
  );
  const e2 = Number(
    db.insert(schema.entries).values({ leagueId, userId, label: 'B', createdAt: 1 }).run().lastInsertRowid,
  );
  // e1 nails the exact score + scorer + first team (10+8+2=20);
  // e2 gets the right winner (outcome 2) + first team home (2) = 4, no scorer/exact
  db.insert(schema.picks).values([
    { entryId: e1, matchId: 1, predHome: 2, predAway: 1, predScorer: 'Raul Jimenez', predFirstTeam: 'home', createdAt: 1, updatedAt: 1 },
    { entryId: e2, matchId: 1, predHome: 3, predAway: 0, predScorer: null, predFirstTeam: 'home', createdAt: 1, updatedAt: 1 },
  ]).run();
  return { leagueId, e1, e2 };
}

function completedEvent(): EspnEvent {
  return {
    date: '2026-06-11T19:00Z',
    name: 'South Africa at Mexico',
    competitions: [
      {
        status: { type: { completed: true, state: 'post' } },
        competitors: [
          { homeAway: 'home', score: '2', team: { id: '100', abbreviation: 'MEX', displayName: 'Mexico' } },
          { homeAway: 'away', score: '1', team: { id: '200', abbreviation: 'RSA', displayName: 'South Africa' } },
        ],
        details: [
          { scoringPlay: true, ownGoal: false, clock: { value: 600 }, team: { id: '100' }, athletesInvolved: [{ displayName: 'Raul Jimenez' }] },
          { scoringPlay: true, ownGoal: false, clock: { value: 3000 }, team: { id: '200' }, athletesInvolved: [{ displayName: 'Lyle Foster' }] },
        ],
      },
    ],
  };
}

function liveEvent(): EspnEvent {
  return {
    date: '2026-06-11T19:00Z',
    name: 'South Africa at Mexico',
    competitions: [
      {
        status: { type: { completed: false, state: 'in' } },
        competitors: [
          { homeAway: 'home', score: '1', team: { id: '100', abbreviation: 'MEX', displayName: 'Mexico' } },
          { homeAway: 'away', score: '0', team: { id: '200', abbreviation: 'RSA', displayName: 'South Africa' } },
        ],
        details: [],
      },
    ],
  };
}

describe('runSync (auto-results orchestrator)', () => {
  beforeEach(() => { process.env.FAKE_NOW = '2026-06-11T21:00:00Z'; });
  afterEach(() => { delete process.env.FAKE_NOW; });

  it('fills a final result from the feed and recomputes points league-wide', async () => {
    const db = createTestDb();
    const { e1, e2 } = seedWorld(db);
    const summary = await runSync(db, async () => [completedEvent()]);

    expect(summary.results).toBe(1);
    const match = db.select().from(schema.matches).where(eq(schema.matches.id, 1)).get();
    expect(match?.status).toBe('finished');
    expect(match?.resultSource).toBe('auto');
    expect(match?.homeScore).toBe(2);
    expect(match?.firstScorer).toBe('Raul Jimenez');
    expect(match?.firstScoringTeam).toBe('home');

    const p1 = db.select().from(schema.matchPoints).where(eq(schema.matchPoints.entryId, e1)).get();
    const p2 = db.select().from(schema.matchPoints).where(eq(schema.matchPoints.entryId, e2)).get();
    expect(p1?.total).toBe(20); // exact 10 + scorer 8 + first team 2
    expect(p2?.total).toBe(4); // outcome 2 + first team 2
    expect(getAppState(db, 'lastSyncAt')).toBeTruthy();
  });

  it('never overwrites a result an admin typed by hand', async () => {
    const db = createTestDb();
    seedWorld(db);
    db.update(schema.matches)
      .set({ status: 'finished', homeScore: 0, awayScore: 0, firstScoringTeam: 'none', resultSource: 'manual' })
      .where(eq(schema.matches.id, 1)).run();

    const summary = await runSync(db, async () => [completedEvent()]);
    expect(summary.results).toBe(0);
    const match = db.select().from(schema.matches).where(eq(schema.matches.id, 1)).get();
    expect(match?.homeScore).toBe(0); // admin's 0-0 stands
    expect(match?.resultSource).toBe('manual');
  });

  it('records an in-progress live score without finishing the match', async () => {
    const db = createTestDb();
    seedWorld(db);
    const summary = await runSync(db, async () => [liveEvent()]);
    expect(summary.liveUpdates).toBe(1);
    expect(summary.results).toBe(0);
    const match = db.select().from(schema.matches).where(eq(schema.matches.id, 1)).get();
    expect(match?.status).toBe('scheduled');
    expect(match?.liveStatus).toBe('in');
    expect(match?.liveHome).toBe(1);
    expect(db.select().from(schema.matchPoints).all()).toHaveLength(0); // live never scores
  });

  it('is idempotent — a second pass over the same final makes no further writes', async () => {
    const db = createTestDb();
    seedWorld(db);
    await runSync(db, async () => [completedEvent()]);
    const second = await runSync(db, async () => [completedEvent()]);
    expect(second.results).toBe(0);
  });

  it('skips entirely when auto-sync is disabled on the primary league', async () => {
    const db = createTestDb();
    seedWorld(db);
    db.update(schema.leagues).set({ autoSyncEnabled: 0 }).run();
    expect(autoSyncEnabled(db)).toBe(false);
    const summary = await runSync(db, async () => [completedEvent()]);
    expect(summary.skipped).toBeTruthy();
    expect(db.select().from(schema.matches).where(eq(schema.matches.id, 1)).get()?.status).toBe('scheduled');
  });

  it('survives a feed fetch failure without throwing', async () => {
    const db = createTestDb();
    seedWorld(db);
    const summary = await runSync(db, async () => { throw new Error('network down'); });
    expect(summary.notes.join(' ')).toMatch(/fetch failed/);
    expect(summary.results).toBe(0);
  });
});

import { eq } from 'drizzle-orm';
