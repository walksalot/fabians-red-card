import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import { runSync } from '@/lib/sync/espn-sync';
import { syncScorerOdds, type JsonFetcher } from '@/lib/sync/espn-props';
import type { EspnEvent } from '@/lib/sync/espn-map';
import { freshDb, withFakeNow } from '../helpers/db';

const KICKOFF = '2026-06-12T02:00:00Z';
const BEFORE = '2026-06-11T20:00:00Z';

function seedWorld(db: Db, { autoUnderdog = 0 } = {}) {
  db.insert(schema.teams).values([
    { id: 1, code: 'KOR', name: 'Korea Republic', groupLetter: 'A' },
    { id: 2, code: 'CZE', name: 'Czechia', groupLetter: 'A' },
  ]).run();
  db.insert(schema.matches).values({
    id: 2, stage: 'group', groupLetter: 'A', homeTeamId: 1, awayTeamId: 2,
    kickoffUtc: KICKOFF, matchday: '2026-06-11', venue: 'Akron', city: 'GDL',
    status: 'scheduled',
  }).run();
  const uid = Number(db.insert(schema.users).values({
    username: 'a', displayName: 'A', passwordHash: 'x', createdAt: 1,
  }).run().lastInsertRowid);
  db.insert(schema.leagues).values({
    name: 'L', slug: 'l', inviteToken: 't', adminUserId: uid, createdAt: 1,
    autoUnderdogEnabled: autoUnderdog,
  }).run();
  return db;
}

function preEventWithOdds(homeML: string, awayML: string, drawML = '+260'): EspnEvent {
  return {
    date: '2026-06-12T02:00Z',
    name: 'CZE @ KOR',
    competitions: [{
      status: { type: { completed: false, state: 'pre' } },
      odds: [{
        provider: { name: 'DraftKings' },
        overUnder: 2.5,
        moneyline: {
          home: { open: { odds: homeML }, close: { odds: homeML } },
          away: { open: { odds: awayML }, close: { odds: awayML } },
          draw: { open: { odds: drawML }, close: { odds: drawML } },
        },
        total: {
          over: { close: { line: 'o2.5', odds: '+110' } },
          under: { close: { line: 'u2.5', odds: '-130' } },
        },
      }],
      competitors: [
        { homeAway: 'home', score: '0', team: { id: '1', abbreviation: 'KOR', displayName: 'Korea Republic' } },
        { homeAway: 'away', score: '0', team: { id: '2', abbreviation: 'CZE', displayName: 'Czechia' } },
      ],
      details: [],
    }],
  };
}

describe('odds via runSync', () => {
  it('stores the parsed odds snapshot on the match', async () => {
    const db = seedWorld(freshDb());
    await withFakeNow(BEFORE, () => runSync(db, async () => [preEventWithOdds('-140', '+400')]));
    const m = db.select().from(schema.matches).where(eq(schema.matches.id, 2)).get()!;
    expect(m.oddsJson).toBeTruthy();
    const odds = JSON.parse(m.oddsJson!);
    expect(odds.homeML).toBe('-140');
    expect(odds.awayML).toBe('+400');
    expect(odds.homeProb + odds.drawProb + odds.awayProb).toBeCloseTo(1, 10);
    expect(m.oddsUpdatedAt).toBe(Date.parse(BEFORE));
  });

  it('auto-underdog OFF: never touches the flag', async () => {
    const db = seedWorld(freshDb(), { autoUnderdog: 0 });
    await withFakeNow(BEFORE, () => runSync(db, async () => [preEventWithOdds('-600', '+1200')]));
    const m = db.select().from(schema.matches).where(eq(schema.matches.id, 2)).get()!;
    expect(m.underdogTeamId).toBeNull();
  });

  it('auto-underdog ON: flags a clear underdog (≤25%) and clears it when odds tighten', async () => {
    const db = seedWorld(freshDb(), { autoUnderdog: 1 });
    // away +1200 → heavy underdog
    await withFakeNow(BEFORE, () => runSync(db, async () => [preEventWithOdds('-600', '+1200')]));
    let m = db.select().from(schema.matches).where(eq(schema.matches.id, 2)).get()!;
    expect(m.underdogTeamId).toBe(2); // Czechia (away)
    // odds tighten to a coin flip → flag clears
    await withFakeNow(BEFORE, () => runSync(db, async () => [preEventWithOdds('+110', '+120')]));
    m = db.select().from(schema.matches).where(eq(schema.matches.id, 2)).get()!;
    expect(m.underdogTeamId).toBeNull();
  });

  it('auto-underdog flag freezes at kickoff (odds still stored)', async () => {
    const db = seedWorld(freshDb(), { autoUnderdog: 1 });
    await withFakeNow(BEFORE, () => runSync(db, async () => [preEventWithOdds('-600', '+1200')]));
    // after kickoff the bookmaker line moves wildly — the flag must not
    const during = '2026-06-12T02:30:00Z';
    await withFakeNow(during, () => runSync(db, async () => [preEventWithOdds('+500', '-200')]));
    const m = db.select().from(schema.matches).where(eq(schema.matches.id, 2)).get()!;
    expect(m.underdogTeamId).toBe(2); // frozen pre-kickoff flag
  });
});

describe('syncScorerOdds', () => {
  const PROPS_PAGE = {
    count: 2, pageCount: 1,
    items: [
      { type: { name: 'First Goalscorer' }, athlete: { $ref: 'http://x/athletes/11?x' }, current: { over: { american: '+450' } } },
      { type: { name: 'First Goalscorer' }, athlete: { $ref: 'http://x/athletes/22?x' }, current: { over: { american: '+900' } } },
      { type: { name: 'Anytime Goalscorer' }, athlete: { $ref: 'http://x/athletes/11?x' }, current: { over: { american: '+150' } } },
    ],
  };
  const SCOREBOARD = {
    events: [{
      id: '760888', date: '2026-06-12T02:00Z',
      competitions: [{ competitors: [
        { homeAway: 'home', team: { abbreviation: 'KOR' } },
        { homeAway: 'away', team: { abbreviation: 'CZE' } },
      ] }],
    }],
  };
  const stub: JsonFetcher = async (url) => {
    if (url.includes('/scoreboard')) return SCOREBOARD;
    if (url.includes('/propBets')) return PROPS_PAGE;
    if (url.includes('/athletes/11')) return { fullName: 'Son Heung-Min' };
    if (url.includes('/athletes/22')) return { fullName: 'Adam Hlozek' };
    throw new Error('unexpected url ' + url);
  };

  it('resolves event ids, walks props, resolves athletes, stores prices', async () => {
    const db = seedWorld(freshDb());
    const summary = await withFakeNow(BEFORE, () => syncScorerOdds(db, stub));
    expect(summary.matchesUpdated).toBe(1);
    expect(summary.pricesStored).toBe(2); // First Goalscorer only
    const rows = db.select().from(schema.scorerOdds).all();
    expect(rows.map((r) => [r.playerName, r.american]).sort()).toEqual([
      ['Adam Hlozek', '+900'],
      ['Son Heung-Min', '+450'],
    ]);
  });

  it('uses the athlete cache on the second pass and skips fresh matches', async () => {
    const db = seedWorld(freshDb());
    let athleteFetches = 0;
    const counting: JsonFetcher = async (url) => {
      if (url.includes('/athletes/')) athleteFetches++;
      return stub(url);
    };
    await withFakeNow(BEFORE, () => syncScorerOdds(db, counting));
    expect(athleteFetches).toBe(2);
    const again = await withFakeNow(BEFORE, () => syncScorerOdds(db, counting));
    expect(again.matchesUpdated).toBe(0); // fresh — skipped entirely
    expect(athleteFetches).toBe(2); // cache held
  });

  it('does nothing for matches outside the 36h window', async () => {
    const db = seedWorld(freshDb());
    const farOut = '2026-06-09T00:00:00Z';
    const summary = await withFakeNow(farOut, () => syncScorerOdds(db, stub));
    expect(summary.matchesUpdated).toBe(0);
  });
});
