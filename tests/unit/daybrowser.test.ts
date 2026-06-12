import { describe, expect, it } from 'vitest';
import { schema, type Db } from '@/db';
import { getMatchdayOverview, getTodayBoard } from '@/lib/services/today';
import { upsertPick } from '@/lib/services/picks';
import { setBooster } from '@/lib/services/boosters';
import { buildDayHref } from '@/app/league/[slug]/_components/day-href';
import { freshDb, withFakeNow } from '../helpers/db';

const NOW = '2026-06-11T20:00:00Z'; // match 1 kicked off, match 2 tonight, more tomorrow

function seedWorld(db: Db) {
  db.insert(schema.teams).values([
    { id: 1, code: 'MEX', name: 'Mexico', groupLetter: 'A' },
    { id: 2, code: 'RSA', name: 'South Africa', groupLetter: 'A' },
    { id: 3, code: 'CAN', name: 'Canada', groupLetter: 'B' },
    { id: 4, code: 'BIH', name: 'Bosnia and Herzegovina', groupLetter: 'B' },
  ]).run();
  db.insert(schema.matches).values([
    { id: 1, stage: 'group', groupLetter: 'A', homeTeamId: 1, awayTeamId: 2,
      kickoffUtc: '2026-06-11T19:00:00Z', matchday: '2026-06-11', venue: 'V', city: 'C', status: 'scheduled' },
    { id: 2, stage: 'group', groupLetter: 'A', homeTeamId: 1, awayTeamId: 2,
      kickoffUtc: '2026-06-12T02:00:00Z', matchday: '2026-06-11', venue: 'V', city: 'C', status: 'scheduled' },
    { id: 3, stage: 'group', groupLetter: 'B', homeTeamId: 3, awayTeamId: 4,
      kickoffUtc: '2026-06-12T19:00:00Z', matchday: '2026-06-12', venue: 'V', city: 'C', status: 'scheduled' },
    { id: 4, stage: 'group', groupLetter: 'B', homeTeamId: 3, awayTeamId: 4,
      kickoffUtc: '2026-06-13T01:00:00Z', matchday: '2026-06-12', venue: 'V', city: 'C', status: 'scheduled' },
    // knockout slot with TBD teams, further out
    { id: 73, stage: 'r32', homeTeamId: null, awayTeamId: null,
      homePlaceholder: 'Group A winners', awayPlaceholder: '3rd C/D/F',
      kickoffUtc: '2026-06-28T19:00:00Z', matchday: '2026-06-28', venue: 'V', city: 'C', status: 'scheduled' },
  ]).run();
  const uid = Number(db.insert(schema.users).values({
    username: 'u', displayName: 'U', passwordHash: 'x', createdAt: 1,
  }).run().lastInsertRowid);
  const leagueId = Number(db.insert(schema.leagues).values({
    name: 'L', slug: 'l', inviteToken: 't', adminUserId: uid, createdAt: 1,
  }).run().lastInsertRowid);
  const entryId = Number(db.insert(schema.entries).values({
    leagueId, userId: uid, label: 'U', createdAt: 1,
  }).run().lastInsertRowid);
  return { db, leagueId, entryId, uid };
}

describe('getTodayBoard with a requested day', () => {
  it('default board stays the current day; future day shows only that day', async () => {
    const { db, leagueId, entryId } = seedWorld(freshDb());
    await withFakeNow(NOW, () => {
      const today = getTodayBoard(db, leagueId, entryId);
      expect(today.matchday).toBe('2026-06-11');
      expect(today.matches.map((m) => m.match.id)).toEqual([1, 2]);

      const tomorrow = getTodayBoard(db, leagueId, entryId, '2026-06-12');
      expect(tomorrow.matchday).toBe('2026-06-12');
      // no in-progress carryover on future days — match 1 stays off this board
      expect(tomorrow.matches.map((m) => m.match.id)).toEqual([3, 4]);
    });
  });

  it('past and unknown days fall back to the current day', async () => {
    const { db, leagueId, entryId } = seedWorld(freshDb());
    await withFakeNow('2026-06-12T12:00:00Z', () => {
      // current day is now 2026-06-12; yesterday must not be browsable
      expect(getTodayBoard(db, leagueId, entryId, '2026-06-11').matchday).toBe('2026-06-12');
      expect(getTodayBoard(db, leagueId, entryId, '2026-06-32').matchday).toBe('2026-06-12');
      expect(getTodayBoard(db, leagueId, entryId, 'garbage').matchday).toBe('2026-06-12');
    });
  });

  it('far-future knockout day is browsable and flags TBD matchups', async () => {
    const { db, leagueId, entryId } = seedWorld(freshDb());
    await withFakeNow(NOW, () => {
      const ko = getTodayBoard(db, leagueId, entryId, '2026-06-28');
      expect(ko.matchday).toBe('2026-06-28');
      expect(ko.matches[0]!.match.homeTeamId).toBeNull();
    });
  });
});

describe('getMatchdayOverview', () => {
  it('lists current + future days with pick progress and booster state', async () => {
    const { db, leagueId, entryId } = seedWorld(freshDb());
    await withFakeNow(NOW, async () => {
      await upsertPick(db, db.select().from(schema.entries).get()!.userId, {
        entryId, matchId: 2, predHome: 1, predAway: 0, predScorer: null, predFirstTeam: null,
      });
      db.insert(schema.boosters).values({
        entryId, matchday: '2026-06-12', matchId: 3, createdAt: 1, updatedAt: 1,
      }).run();

      const o = getMatchdayOverview(db, leagueId, entryId);
      expect(o.currentDay).toBe('2026-06-11');
      expect(o.days.map((d) => d.matchday)).toEqual(['2026-06-11', '2026-06-12', '2026-06-28']);
      const [d1, d2] = o.days;
      expect(d1).toMatchObject({ matchCount: 2, pickedCount: 1, boosterArmed: false });
      expect(d2).toMatchObject({ matchCount: 2, pickedCount: 0, boosterArmed: true });
      // next day (June 12) has gaps → the dot shows
      expect(o.nextDayHasGaps).toBe(true);
    });
  });

  it('dot clears when the next day is fully picked', async () => {
    const { db, leagueId, entryId, uid } = seedWorld(freshDb());
    await withFakeNow(NOW, async () => {
      await upsertPick(db, uid, { entryId, matchId: 3, predHome: 1, predAway: 0, predScorer: null, predFirstTeam: null });
      await upsertPick(db, uid, { entryId, matchId: 4, predHome: 1, predAway: 0, predScorer: null, predFirstTeam: null });
      expect(getMatchdayOverview(db, leagueId, entryId).nextDayHasGaps).toBe(false);
    });
  });
});

describe('TBD matchup guards', () => {
  it('rejects picks while either team slot is unknown', async () => {
    const { db, uid, entryId } = seedWorld(freshDb());
    await withFakeNow(NOW, async () => {
      await expect(
        upsertPick(db, uid, { entryId, matchId: 73, predHome: 1, predAway: 0, predScorer: null, predFirstTeam: null }),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  it('rejects a booster while either team slot is unknown', async () => {
    const { db, uid, entryId } = seedWorld(freshDb());
    await withFakeNow(NOW, async () => {
      await expect(
        setBooster(db, uid, { entryId, matchday: '2026-06-28', matchId: 73 }),
      ).rejects.toMatchObject({ status: 409 });
    });
  });
});

describe('buildDayHref (DayNav)', () => {
  it('current day gets the canonical param-free URL; future days get ?day=', () => {
    const sp = new URLSearchParams();
    expect(buildDayHref('l', '2026-06-11', '2026-06-11', sp)).toBe('/league/l/today');
    expect(buildDayHref('l', '2026-06-12', '2026-06-11', sp)).toBe('/league/l/today?day=2026-06-12');
  });

  it('preserves ?entry= so multi-entry users stay on their selected entry', () => {
    const sp = new URLSearchParams('entry=7&day=2026-06-12');
    expect(buildDayHref('l', '2026-06-28', '2026-06-11', sp)).toBe(
      '/league/l/today?entry=7&day=2026-06-28',
    );
    // navigating back to the current day drops only ?day=, keeping ?entry=
    expect(buildDayHref('l', '2026-06-11', '2026-06-11', sp)).toBe('/league/l/today?entry=7');
    // input params are not mutated
    expect(sp.toString()).toBe('entry=7&day=2026-06-12');
  });
});
