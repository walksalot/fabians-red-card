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
        status: {
          displayClock: "55'",
          type: { completed: false, state: 'in', shortDetail: "55'" },
        },
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

  // Regression for the delayed 2026-06-30 Mexico–Ecuador game: the feed's
  // event.date moved to the actual (late) kickoff and the sync dropped the
  // final on the floor — nobody got their points until this fix.
  it('banks the final of a delayed game (feed kickoff an hour after the fixture) and scores points', async () => {
    const db = createTestDb();
    const { e1, e2 } = seedWorld(db);
    const delayed = completedEvent();
    delayed.date = '2026-06-11T20:00Z'; // fixture kickoff is 19:00Z
    const summary = await runSync(db, async () => [delayed]);

    expect(summary.results).toBe(1);
    const match = db.select().from(schema.matches).where(eq(schema.matches.id, 1)).get();
    expect(match?.status).toBe('finished');
    expect(match?.resultSource).toBe('auto');
    expect(match?.homeScore).toBe(2);
    expect(match?.awayScore).toBe(1);
    expect(match?.firstScorer).toBe('Raul Jimenez');

    const p1 = db.select().from(schema.matchPoints).where(eq(schema.matchPoints.entryId, e1)).get();
    const p2 = db.select().from(schema.matchPoints).where(eq(schema.matchPoints.entryId, e2)).get();
    expect(p1?.total).toBe(20); // exact 10 + scorer 8 + first team 2
    expect(p2?.total).toBe(4); // outcome 2 + first team 2
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
    expect(match?.liveClock).toBe("55'"); // feed clock rides along for the display
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

  // End-to-end regression for the SUI 0-0 COL shootout: the whole loop —
  // feed → planner → result write → bracket propagation — in one pass.
  it('banks a shootout final with its tallies and fills the next round slot in the same pass', async () => {
    const db = createTestDb();
    seedWorld(db);
    db.insert(schema.teams).values([
      { id: 3, code: 'SUI', name: 'Switzerland', groupLetter: 'B' },
      { id: 4, code: 'COL', name: 'Colombia', groupLetter: 'C' },
    ]).run();
    // Real bracket wiring: R16 match 96 feeds the away slot of QF match 100.
    db.insert(schema.matches).values([
      {
        id: 96, stage: 'r16', homeTeamId: 3, awayTeamId: 4,
        kickoffUtc: '2026-06-11T16:00:00Z', matchday: '2026-06-11',
        venue: 'BC Place', city: 'Vancouver', status: 'scheduled',
      },
      {
        id: 100, stage: 'qf', homePlaceholder: 'Winners Match 95', awayPlaceholder: 'Winners Match 96',
        kickoffUtc: '2026-06-13T20:00:00Z', matchday: '2026-06-13',
        venue: 'Arrowhead Stadium', city: 'Kansas City', status: 'scheduled',
      },
    ]).run();
    const pensFinal: EspnEvent = {
      date: '2026-06-11T16:00Z',
      name: 'Colombia at Switzerland',
      competitions: [
        {
          status: { type: { completed: true, state: 'post', shortDetail: 'FT-Pens' } },
          competitors: [
            { homeAway: 'home', score: '0', shootoutScore: 2, team: { id: '300', abbreviation: 'SUI', displayName: 'Switzerland' } },
            { homeAway: 'away', score: '0', shootoutScore: 4, team: { id: '400', abbreviation: 'COL', displayName: 'Colombia' } },
          ],
          details: [
            // shootout kicks: scoringPlay true in the real feed, shootout true
            { scoringPlay: true, ownGoal: false, shootout: true, clock: { value: 7200 }, team: { id: '400' }, athletesInvolved: [{ displayName: 'Juan Fernando Quintero' }] },
            { scoringPlay: true, ownGoal: false, shootout: true, clock: { value: 7200 }, team: { id: '300' }, athletesInvolved: [{ displayName: 'Granit Xhaka' }] },
          ],
        },
      ],
    };

    // Date-aware fetcher (like the real feed): the event lives on its own
    // scoreboard date only, not on every date the sync happens to check.
    const fetcher = async (d: string) => (d === '20260611' ? [pensFinal] : []);
    const summary = await runSync(db, fetcher);
    expect(summary.results).toBe(1);

    const tie = db.select().from(schema.matches).where(eq(schema.matches.id, 96)).get();
    expect(tie?.status).toBe('finished');
    expect(tie?.homeScore).toBe(0);
    expect(tie?.awayScore).toBe(0);
    expect(tie?.firstScorer).toBeNull(); // Quintero's kick is not a goal
    expect(tie?.firstScoringTeam).toBe('none');
    expect(tie?.homePens).toBe(2);
    expect(tie?.awayPens).toBe(4);

    // Colombia advanced into the QF slot without waiting for a feed team
    // fill — written inside the result transaction itself.
    const qf = db.select().from(schema.matches).where(eq(schema.matches.id, 100)).get();
    expect(qf?.awayTeamId).toBe(4);
    expect(qf?.awayPlaceholder).toBeNull();
    expect(qf?.homeTeamId).toBeNull(); // other feeder undecided

    // Second pass: nothing to rewrite, nothing to re-propagate.
    const second = await runSync(db, fetcher);
    expect(second.results).toBe(0);
    expect(second.teamFills).toBe(0);
  });

  it('fills teams by display name when the feed abbreviation matches no seeded code, healing a finished TBD match', async () => {
    const db = createTestDb();
    seedWorld(db);
    db.insert(schema.teams).values([
      { id: 3, code: 'KOR', name: 'Korea Republic', groupLetter: 'B' },
      { id: 4, code: 'CIV', name: "Côte d'Ivoire", groupLetter: 'C' },
    ]).run();
    // R32 placeholder slot whose game already FINISHED while its feed codes
    // ('SKO'/'IVC' — not our FIFA codes) matched nothing: previously the
    // teams could never fill again (the old update was scheduled-only) and
    // the bracket stayed stranded forever.
    db.insert(schema.matches).values({
      id: 73, stage: 'r32', homePlaceholder: '1A', awayPlaceholder: '2B',
      kickoffUtc: '2026-06-11T16:00:00Z', matchday: '2026-06-11',
      venue: 'SoFi Stadium', city: 'LA', status: 'finished',
      homeScore: 2, awayScore: 0, firstScorer: 'Somebody', firstScoringTeam: 'home',
      resultSource: 'auto',
    }).run();
    db.insert(schema.matches).values({
      id: 90, stage: 'r16', homePlaceholder: 'Winners Match 73', awayPlaceholder: 'Winners Match 75',
      kickoffUtc: '2026-06-13T20:00:00Z', matchday: '2026-06-13',
      venue: 'NRG Stadium', city: 'Houston', status: 'scheduled',
    }).run();
    const event: EspnEvent = {
      date: '2026-06-11T16:00Z',
      name: "Côte d'Ivoire at Korea Republic",
      competitions: [
        {
          status: { type: { completed: true, state: 'post' } },
          competitors: [
            { homeAway: 'home', score: '2', team: { id: '300', abbreviation: 'SKO', displayName: 'Korea Republic' } },
            { homeAway: 'away', score: '0', team: { id: '400', abbreviation: 'IVC', displayName: "Côte d'Ivoire" } },
          ],
          details: [
            { scoringPlay: true, ownGoal: false, clock: { value: 900 }, team: { id: '300' }, athletesInvolved: [{ displayName: 'Somebody' }] },
          ],
        },
      ],
    };

    const summary = await runSync(db, async (d) => (d === '20260611' ? [event] : []));
    expect(summary.teamFills).toBeGreaterThanOrEqual(1);
    const healed = db.select().from(schema.matches).where(eq(schema.matches.id, 73)).get();
    expect(healed?.homeTeamId).toBe(3); // by name, not code
    expect(healed?.awayTeamId).toBe(4);
    // …and the finished match's winner flowed straight into the R16 slot.
    expect(
      db.select().from(schema.matches).where(eq(schema.matches.id, 90)).get()?.homeTeamId,
    ).toBe(3);
  });

  it('re-banks a scorer correction end to end and recomputes the scorer market', async () => {
    const db = createTestDb();
    const { e1 } = seedWorld(db);
    // A scheduled sibling on the same matchday keeps the date in the fetch
    // set after match 1 finishes — the exact window corrections arrive in.
    db.insert(schema.matches).values({
      id: 2, stage: 'group', groupLetter: 'A',
      kickoffUtc: '2026-06-11T22:00:00Z', matchday: '2026-06-11',
      venue: 'V', city: 'C', status: 'scheduled',
    }).run();
    const fetcher = (ev: EspnEvent) => async (d: string) => (d === '20260611' ? [ev] : []);
    await runSync(db, fetcher(completedEvent()));
    expect(
      db.select().from(schema.matchPoints).where(eq(schema.matchPoints.entryId, e1)).get()?.total,
    ).toBe(20); // exact 10 + scorer 8 + firstTeam 2

    // The feed re-credits the opening goal to somebody else — e1's scorer
    // pick no longer matches and the 8 points must come back off.
    const corrected = completedEvent();
    corrected.competitions![0].details![0].athletesInvolved = [{ displayName: 'Lyle Foster' }];
    const summary = await runSync(db, fetcher(corrected));
    expect(summary.results).toBe(1);
    const match = db.select().from(schema.matches).where(eq(schema.matches.id, 1)).get();
    expect(match?.firstScorer).toBe('Lyle Foster');
    expect(
      db.select().from(schema.matchPoints).where(eq(schema.matchPoints.entryId, e1)).get()?.total,
    ).toBe(12); // exact 10 + firstTeam 2, scorer gone
  });

  it('propagates stale knockout winners even when auto-sync is off (self-heal path)', async () => {
    const db = createTestDb();
    seedWorld(db);
    db.update(schema.leagues).set({ autoSyncEnabled: 0 }).run();
    db.insert(schema.teams).values([
      { id: 3, code: 'SUI', name: 'Switzerland', groupLetter: 'B' },
      { id: 4, code: 'COL', name: 'Colombia', groupLetter: 'C' },
    ]).run();
    // A tie banked before propagation existed: finished, pens known, child empty.
    db.insert(schema.matches).values([
      {
        id: 96, stage: 'r16', homeTeamId: 3, awayTeamId: 4,
        kickoffUtc: '2026-06-11T16:00:00Z', matchday: '2026-06-11',
        venue: 'BC Place', city: 'Vancouver', status: 'finished',
        homeScore: 0, awayScore: 0, homePens: 2, awayPens: 4,
        firstScoringTeam: 'none', resultSource: 'auto',
      },
      {
        id: 100, stage: 'qf', homePlaceholder: 'Winners Match 95', awayPlaceholder: 'Winners Match 96',
        kickoffUtc: '2026-06-13T20:00:00Z', matchday: '2026-06-13',
        venue: 'Arrowhead Stadium', city: 'Kansas City', status: 'scheduled',
      },
    ]).run();

    const summary = await runSync(db, async () => []);
    expect(summary.skipped).toBeTruthy(); // feed never consulted…
    expect(summary.teamFills).toBe(1); // …but the bracket still healed
    expect(
      db.select().from(schema.matches).where(eq(schema.matches.id, 100)).get()?.awayTeamId,
    ).toBe(4);
  });
});

import { eq } from 'drizzle-orm';
