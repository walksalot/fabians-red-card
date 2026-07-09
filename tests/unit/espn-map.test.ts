import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  normalizeKickoff,
  planSync,
  type EspnEvent,
  type MatchSnapshot,
} from '@/lib/sync/espn-map';

function snap(partial: Partial<MatchSnapshot> & { id: number; kickoffUtc: string }): MatchSnapshot {
  return {
    homeCode: 'MEX',
    awayCode: 'RSA',
    homeName: 'Mexico',
    awayName: 'South Africa',
    status: 'scheduled',
    resultSource: null,
    venue: 'Estadio Azteca',
    homeScore: null,
    awayScore: null,
    homePens: null,
    awayPens: null,
    firstScorer: null,
    firstScoringTeam: null,
    ...partial,
  };
}

function espnEvent(over: {
  date?: string;
  name?: string;
  state?: 'pre' | 'in' | 'post';
  completed?: boolean;
  displayClock?: string;
  shortDetail?: string;
  home?: { abbr?: string; name?: string; score?: string; id?: string; shootoutScore?: string | number };
  away?: { abbr?: string; name?: string; score?: string; id?: string; shootoutScore?: string | number };
  details?: Array<{
    scoringPlay?: boolean;
    ownGoal?: boolean;
    shootout?: boolean;
    clock?: number;
    teamId?: string;
    athlete?: string;
  }>;
  venue?: string;
}): EspnEvent {
  return {
    date: over.date ?? '2026-06-11T19:00Z',
    name: over.name ?? 'Test Event',
    competitions: [
      {
        status: {
          displayClock: over.displayClock,
          type: {
            completed: over.completed ?? false,
            state: over.state ?? 'pre',
            shortDetail: over.shortDetail,
          },
        },
        venue: over.venue ? { fullName: over.venue } : undefined,
        competitors: [
          {
            homeAway: 'home',
            score: over.home?.score,
            shootoutScore: over.home?.shootoutScore,
            team: {
              id: over.home?.id ?? '100',
              abbreviation: over.home?.abbr ?? 'MEX',
              displayName: over.home?.name ?? 'Mexico',
            },
          },
          {
            homeAway: 'away',
            score: over.away?.score,
            shootoutScore: over.away?.shootoutScore,
            team: {
              id: over.away?.id ?? '200',
              abbreviation: over.away?.abbr ?? 'RSA',
              displayName: over.away?.name ?? 'South Africa',
            },
          },
        ],
        details: (over.details ?? []).map((d) => ({
          scoringPlay: d.scoringPlay ?? true,
          ownGoal: d.ownGoal ?? false,
          shootout: d.shootout ?? false,
          clock: { value: d.clock ?? 0 },
          team: { id: d.teamId ?? '100' },
          athletesInvolved: d.athlete ? [{ displayName: d.athlete }] : [],
        })),
      },
    ],
  };
}

describe('normalizeKickoff', () => {
  it('accepts the ESPN minute format and full ISO forms', () => {
    expect(normalizeKickoff('2026-06-11T19:00Z')).toBe('2026-06-11T19:00:00Z');
    expect(normalizeKickoff('2026-06-11T19:00:00Z')).toBe('2026-06-11T19:00:00Z');
    expect(normalizeKickoff('2026-06-11T19:00:00.000Z')).toBe('2026-06-11T19:00:00Z');
    expect(normalizeKickoff('not a date')).toBeNull();
  });
});

describe('planSync', () => {
  const M1 = snap({ id: 1, kickoffUtc: '2026-06-11T19:00:00Z' });

  it('applies a completed result with first scorer and first scoring team', () => {
    const plan = planSync(
      [
        espnEvent({
          state: 'post',
          completed: true,
          home: { score: '2' },
          away: { score: '1' },
          details: [
            { clock: 1200, teamId: '100', athlete: 'Raúl Jiménez' },
            { clock: 2400, teamId: '200', athlete: 'Lyle Foster' },
          ],
        }),
      ],
      [M1],
    );
    expect(plan.actions).toEqual([
      {
        kind: 'result',
        matchId: 1,
        homeScore: 2,
        awayScore: 1,
        firstScorer: 'Raúl Jiménez',
        firstScoringTeam: 'home',
        homePens: null,
        awayPens: null,
      },
    ]);
  });

  it('own goal counts for first team to score but not the scorer market', () => {
    const plan = planSync(
      [
        espnEvent({
          state: 'post',
          completed: true,
          home: { score: '1' },
          away: { score: '1' },
          details: [
            { clock: 600, teamId: '200', ownGoal: true, athlete: 'Unlucky Defender' },
            { clock: 1800, teamId: '100', athlete: 'Real Striker' },
          ],
        }),
      ],
      [M1],
    );
    expect(plan.actions).toEqual([
      {
        kind: 'result',
        matchId: 1,
        homeScore: 1,
        awayScore: 1,
        firstScorer: 'Real Striker',
        firstScoringTeam: 'away',
        homePens: null,
        awayPens: null,
      },
    ]);
  });

  it('0-0 finals need no goal details and record none/null', () => {
    const plan = planSync(
      [espnEvent({ state: 'post', completed: true, home: { score: '0' }, away: { score: '0' } })],
      [M1],
    );
    expect(plan.actions).toEqual([
      {
        kind: 'result',
        matchId: 1,
        homeScore: 0,
        awayScore: 0,
        firstScorer: null,
        firstScoringTeam: 'none',
        homePens: null,
        awayPens: null,
      },
    ]);
  });

  it('never touches a manually-entered result', () => {
    const manual = snap({
      id: 1,
      kickoffUtc: '2026-06-11T19:00:00Z',
      resultSource: 'manual',
      status: 'finished',
      homeScore: 3,
      awayScore: 0,
    });
    const plan = planSync(
      [
        espnEvent({
          state: 'post',
          completed: true,
          home: { score: '2' },
          away: { score: '1' },
          details: [{ teamId: '100', athlete: 'Somebody' }],
        }),
      ],
      [manual],
    );
    expect(plan.actions).toEqual([]);
  });

  it('skips a completed game with unusable goal details instead of guessing', () => {
    const plan = planSync(
      [
        espnEvent({
          state: 'post',
          completed: true,
          home: { score: '2' },
          away: { score: '1' },
          details: [], // feed gave nothing
        }),
      ],
      [M1],
    );
    expect(plan.actions).toEqual([]);
    expect(plan.notes.join(' ')).toMatch(/enter result manually/);
  });

  it('emits live score updates for in-progress games', () => {
    const plan = planSync(
      [espnEvent({ state: 'in', home: { score: '1' }, away: { score: '0' } })],
      [M1],
    );
    expect(plan.actions).toEqual([{ kind: 'live', matchId: 1, liveHome: 1, liveAway: 0, firstScorer: null, firstScoringTeam: null, clock: null, liveHomePens: null, liveAwayPens: null }]);
  });

  it('carries the feed clock on live updates, preferring shortDetail (HT) over the raw clock', () => {
    const running = planSync(
      [espnEvent({ state: 'in', home: { score: '1' }, away: { score: '0' }, displayClock: "55'", shortDetail: "55'" })],
      [M1],
    );
    expect(running.actions[0]).toMatchObject({ kind: 'live', clock: "55'" });

    // halftime: displayClock parks at "45'" but shortDetail says HT — show HT
    const halftime = planSync(
      [espnEvent({ state: 'in', home: { score: '1' }, away: { score: '0' }, displayClock: "45'", shortDetail: 'HT' })],
      [M1],
    );
    expect(halftime.actions[0]).toMatchObject({ kind: 'live', clock: 'HT' });

    // no shortDetail → raw displayClock still serves
    const fallback = planSync(
      [espnEvent({ state: 'in', home: { score: '1' }, away: { score: '0' }, displayClock: "90'+3'" })],
      [M1],
    );
    expect(fallback.actions[0]).toMatchObject({ kind: 'live', clock: "90'+3'" });
  });

  it('drops a clock string that is not clock-shaped (untrusted feed text)', () => {
    const plan = planSync(
      [
        espnEvent({
          state: 'in',
          home: { score: '1' },
          away: { score: '0' },
          shortDetail: '<img src=x onerror=alert(1)>',
        }),
      ],
      [M1],
    );
    expect(plan.actions[0]).toMatchObject({ kind: 'live', clock: null });
  });

  it('is idempotent for already-applied auto results', () => {
    const done = snap({
      id: 1,
      kickoffUtc: '2026-06-11T19:00:00Z',
      status: 'finished',
      resultSource: 'auto',
      homeScore: 2,
      awayScore: 1,
      firstScorer: 'Somebody',
      firstScoringTeam: 'home',
    });
    const plan = planSync(
      [
        espnEvent({
          state: 'post',
          completed: true,
          home: { score: '2' },
          away: { score: '1' },
          details: [{ teamId: '100', athlete: 'Somebody' }],
        }),
      ],
      [done],
    );
    expect(plan.actions).toEqual([]);
  });

  it('fills knockout placeholder teams from a matched kickoff', () => {
    const r32 = snap({
      id: 73,
      kickoffUtc: '2026-06-28T19:00:00Z',
      homeCode: null,
      awayCode: null,
      homeName: null,
      awayName: null,
    });
    const plan = planSync(
      [
        espnEvent({
          date: '2026-06-28T19:00Z',
          state: 'pre',
          home: { abbr: 'BRA', name: 'Brazil' },
          away: { abbr: 'SCO', name: 'Scotland' },
        }),
      ],
      [r32],
    );
    expect(plan.actions).toEqual([
      { kind: 'teams', matchId: 73, homeCode: 'BRA', awayCode: 'SCO', homeName: 'Brazil', awayName: 'Scotland' },
    ]);
  });

  it('reports ambiguity instead of guessing between same-instant placeholders', () => {
    const a = snap({ id: 73, kickoffUtc: '2026-06-28T19:00:00Z', homeCode: null, awayCode: null, homeName: null, awayName: null });
    const b = snap({ id: 74, kickoffUtc: '2026-06-28T19:00:00Z', homeCode: null, awayCode: null, homeName: null, awayName: null });
    const plan = planSync(
      [
        espnEvent({
          date: '2026-06-28T19:00Z',
          state: 'pre',
          home: { abbr: 'BRA', name: 'Brazil' },
          away: { abbr: 'SCO', name: 'Scotland' },
        }),
      ],
      [a, b],
    );
    expect(plan.actions).toEqual([]);
    expect(plan.notes.join(' ')).toMatch(/ambiguous/);
  });

  it('disambiguates same-instant placeholders by the ACTUAL venue name', () => {
    const a = snap({ id: 73, kickoffUtc: '2026-06-28T19:00:00Z', homeCode: null, awayCode: null, homeName: null, awayName: null, venue: 'SoFi Stadium' });
    const b = snap({ id: 74, kickoffUtc: '2026-06-28T19:00:00Z', homeCode: null, awayCode: null, homeName: null, awayName: null, venue: 'Gillette Stadium' });
    const plan = planSync(
      [
        espnEvent({
          date: '2026-06-28T19:00Z',
          state: 'pre',
          home: { abbr: 'BRA', name: 'Brazil' },
          away: { abbr: 'SCO', name: 'Scotland' },
          venue: 'Gillette Stadium, Foxborough', // spelling drift tolerated
        }),
      ],
      [a, b],
    );
    expect(plan.actions).toEqual([
      { kind: 'teams', matchId: 74, homeCode: 'BRA', awayCode: 'SCO', homeName: 'Brazil', awayName: 'Scotland' },
    ]);
  });

  it('falls back to display-name matching when abbreviations differ', () => {
    const plan = planSync(
      [
        espnEvent({
          state: 'in',
          home: { abbr: 'MX', name: 'México', score: '1' },
          away: { abbr: 'SOU', name: 'South Africa', score: '1' },
        }),
      ],
      [M1],
    );
    expect(plan.actions).toEqual([{ kind: 'live', matchId: 1, liveHome: 1, liveAway: 1, firstScorer: null, firstScoringTeam: null, clock: null, liveHomePens: null, liveAwayPens: null }]);
  });

  // Regression: the 2026-06-30 Mexico–Ecuador R32 game kicked off 60 minutes
  // late; ESPN's event.date moved to the actual start and the exact-kickoff
  // lookup matched nothing, so the final never registered and nobody's picks
  // were scored. A unique team match within the drift tolerance must still
  // identify the fixture.
  describe('delayed kickoffs (feed date drifts from the fixture)', () => {
    it('banks the final of a game that started an hour late', () => {
      const plan = planSync(
        [
          espnEvent({
            date: '2026-06-11T20:00Z', // fixture says 19:00Z — delayed start
            state: 'post',
            completed: true,
            home: { score: '2' },
            away: { score: '0' },
            details: [{ clock: 1275, teamId: '100', athlete: 'Julián Quiñones' }],
          }),
        ],
        [M1],
      );
      expect(plan.actions).toEqual([
        {
          kind: 'result',
          matchId: 1,
          homeScore: 2,
          awayScore: 0,
          firstScorer: 'Julián Quiñones',
          firstScoringTeam: 'home',
          homePens: null,
          awayPens: null,
        },
      ]);
      expect(plan.notes.join(' ')).toMatch(/kickoff drift/);
    });

    it('keeps live scores flowing while the delayed game is in progress', () => {
      const plan = planSync(
        [
          espnEvent({
            date: '2026-06-11T20:00Z',
            state: 'in',
            home: { score: '1' },
            away: { score: '0' },
            shortDetail: "55'",
          }),
        ],
        [M1],
      );
      expect(plan.actions).toEqual([
        { kind: 'live', matchId: 1, liveHome: 1, liveAway: 0, firstScorer: null, firstScoringTeam: null, clock: "55'", liveHomePens: null, liveAwayPens: null },
      ]);
    });

    it('ignores a same-teams event beyond the drift tolerance (not our game)', () => {
      const plan = planSync(
        [
          espnEvent({
            date: '2026-06-12T09:00Z', // 14h after the fixture — outside tolerance
            state: 'post',
            completed: true,
            home: { score: '2' },
            away: { score: '0' },
            details: [{ teamId: '100', athlete: 'Somebody' }],
          }),
        ],
        [M1],
      );
      expect(plan.actions).toEqual([]);
      expect(plan.notes).toEqual([]); // silently not ours, same as before
    });

    it('identifies the delayed game by teams even when a TBD slot sits at the drifted instant', () => {
      const tbd = snap({
        id: 99,
        kickoffUtc: '2026-06-11T20:00:00Z',
        homeCode: null,
        awayCode: null,
        homeName: null,
        awayName: null,
      });
      const plan = planSync(
        [
          espnEvent({
            date: '2026-06-11T20:00Z',
            state: 'post',
            completed: true,
            home: { score: '2' },
            away: { score: '0' },
            details: [{ teamId: '100', athlete: 'Julián Quiñones' }],
          }),
        ],
        [M1, tbd],
      );
      // the known-teams fixture wins; the placeholder is never touched
      expect(plan.actions).toEqual([
        {
          kind: 'result',
          matchId: 1,
          homeScore: 2,
          awayScore: 0,
          firstScorer: 'Julián Quiñones',
          firstScoringTeam: 'home',
          homePens: null,
          awayPens: null,
        },
      ]);
    });

    it('refuses to guess when two fixtures with the same teams sit inside the tolerance', () => {
      const rematch = snap({ id: 2, kickoffUtc: '2026-06-11T22:00:00Z' });
      const plan = planSync(
        [
          espnEvent({
            date: '2026-06-11T20:00Z',
            state: 'post',
            completed: true,
            home: { score: '2' },
            away: { score: '0' },
            details: [{ teamId: '100', athlete: 'Somebody' }],
          }),
        ],
        [M1, rematch],
      );
      expect(plan.actions).toEqual([]);
      expect(plan.notes.join(' ')).toMatch(/ambiguous/);
    });
  });

  // Regression: the 2026-07-07 Switzerland–Colombia R16 tie was 0-0 after
  // extra time; the feed marks every shootout kick scoringPlay:true, so the
  // live board credited "First goal: Juan Fernando Quintero" (Colombia's first
  // kicker) and paid first-team points for a game with no goals.
  describe('penalty shootouts are not goals', () => {
    const shootoutKicks = [
      { clock: 7200, teamId: '200', athlete: 'Juan Fernando Quintero', shootout: true },
      { clock: 7200, teamId: '100', athlete: 'Granit Xhaka', shootout: true },
      { clock: 7200, teamId: '200', athlete: 'James Rodríguez', shootout: true },
    ];

    it('live: a 0-0 shootout reports no first goal, keeps the level score, and carries the tallies', () => {
      const plan = planSync(
        [
          espnEvent({
            state: 'in',
            home: { score: '0', shootoutScore: 1 },
            away: { score: '0', shootoutScore: 2 },
            shortDetail: 'Pens',
            details: shootoutKicks,
          }),
        ],
        [M1],
      );
      expect(plan.actions).toEqual([
        {
          kind: 'live',
          matchId: 1,
          liveHome: 0,
          liveAway: 0,
          firstScorer: null, // Quintero's kick is NOT the first goal
          firstScoringTeam: null,
          clock: 'Pens',
          liveHomePens: 1,
          liveAwayPens: 2,
        },
      ]);
    });

    it('final: a goalless tie decided on penalties records none/null plus the shootout tallies', () => {
      const plan = planSync(
        [
          espnEvent({
            state: 'post',
            completed: true,
            home: { score: '0', shootoutScore: 2 },
            away: { score: '0', shootoutScore: 4 },
            details: shootoutKicks,
          }),
        ],
        [M1],
      );
      expect(plan.actions).toEqual([
        {
          kind: 'result',
          matchId: 1,
          homeScore: 0,
          awayScore: 0,
          firstScorer: null,
          firstScoringTeam: 'none',
          homePens: 2,
          awayPens: 4,
        },
      ]);
    });

    it('final: a level tie WITH goals keeps the real first scorer and captures the shootout', () => {
      // Croatia 1-1 Brazil, 2022 QF shape: Neymar 105'+1', Petković 117',
      // then the shootout — all shootout entries parked at clock 7200.
      const plan = planSync(
        [
          espnEvent({
            state: 'post',
            completed: true,
            home: { score: '1', shootoutScore: 4 },
            away: { score: '1', shootoutScore: 2 },
            details: [
              { clock: 7200, teamId: '100', athlete: 'Nikola Vlašić', shootout: true },
              { clock: 6300, teamId: '200', athlete: 'Neymar' },
              { clock: 6962, teamId: '100', athlete: 'Bruno Petković' },
              { clock: 7200, teamId: '200', athlete: 'Casemiro', shootout: true },
            ],
          }),
        ],
        [M1],
      );
      expect(plan.actions).toEqual([
        {
          kind: 'result',
          matchId: 1,
          homeScore: 1,
          awayScore: 1,
          firstScorer: 'Neymar',
          firstScoringTeam: 'away',
          homePens: 4,
          awayPens: 2,
        },
      ]);
    });

    it('final: an own-goals-only tie never borrows a shootout kicker as the first scorer', () => {
      const plan = planSync(
        [
          espnEvent({
            state: 'post',
            completed: true,
            home: { score: '1', shootoutScore: 3 },
            away: { score: '1', shootoutScore: 5 },
            details: [
              { clock: 600, teamId: '200', ownGoal: true, athlete: 'Unlucky One' },
              { clock: 1800, teamId: '100', ownGoal: true, athlete: 'Unlucky Two' },
              ...shootoutKicks,
            ],
          }),
        ],
        [M1],
      );
      expect(plan.actions).toEqual([
        {
          kind: 'result',
          matchId: 1,
          homeScore: 1,
          awayScore: 1,
          firstScorer: null, // own goals never win the scorer market
          firstScoringTeam: 'away', // …but the own goal still credits the team
          homePens: 3,
          awayPens: 5,
        },
      ]);
    });

    it('re-writes a tie banked without shootout tallies (backfill) and is idempotent once they match', () => {
      const banked = snap({
        id: 1,
        kickoffUtc: '2026-06-11T19:00:00Z',
        status: 'finished',
        resultSource: 'auto',
        homeScore: 0,
        awayScore: 0,
        homePens: null,
        awayPens: null,
        firstScoringTeam: 'none',
      });
      const event = espnEvent({
        state: 'post',
        completed: true,
        home: { score: '0', shootoutScore: 2 },
        away: { score: '0', shootoutScore: 4 },
        details: shootoutKicks,
      });
      const backfill = planSync([event], [banked]);
      expect(backfill.actions).toEqual([
        {
          kind: 'result',
          matchId: 1,
          homeScore: 0,
          awayScore: 0,
          firstScorer: null,
          firstScoringTeam: 'none',
          homePens: 2,
          awayPens: 4,
        },
      ]);

      const healed = snap({ ...banked, homePens: 2, awayPens: 4 });
      expect(planSync([event], [healed]).actions).toEqual([]);
    });

    it('a feed gap never erases recorded tallies — no rewrite, no bracket flap', () => {
      const healed = snap({
        id: 1,
        kickoffUtc: '2026-06-11T19:00:00Z',
        status: 'finished',
        resultSource: 'auto',
        homeScore: 0,
        awayScore: 0,
        homePens: 4,
        awayPens: 3,
        firstScoringTeam: 'none',
      });
      // Same final, but this pass the feed omitted shootoutScore entirely.
      const gappyEvent = espnEvent({
        state: 'post',
        completed: true,
        home: { score: '0' },
        away: { score: '0' },
        details: shootoutKicks,
      });
      expect(planSync([gappyEvent], [healed]).actions).toEqual([]);

      // A CORRECTED feed tally still wins over the stored one.
      const corrected = espnEvent({
        state: 'post',
        completed: true,
        home: { score: '0', shootoutScore: 5 },
        away: { score: '0', shootoutScore: 4 },
        details: shootoutKicks,
      });
      expect(planSync([corrected], [healed]).actions).toEqual([
        {
          kind: 'result',
          matchId: 1,
          homeScore: 0,
          awayScore: 0,
          firstScorer: null,
          firstScoringTeam: 'none',
          homePens: 5,
          awayPens: 4,
        },
      ]);

      // A corrected SCORE drops the stale stored tallies (they belonged to
      // the old, wrong scoreline) rather than gluing them onto the new one.
      const scoreFix = espnEvent({
        state: 'post',
        completed: true,
        home: { score: '1' },
        away: { score: '0' },
        details: [{ clock: 1200, teamId: '100', athlete: 'Somebody' }],
      });
      expect(planSync([scoreFix], [healed]).actions).toEqual([
        {
          kind: 'result',
          matchId: 1,
          homeScore: 1,
          awayScore: 0,
          firstScorer: 'Somebody',
          firstScoringTeam: 'home',
          homePens: null,
          awayPens: null,
        },
      ]);
    });

    it('re-banks a post-FT scorer correction with an unchanged scoreline', () => {
      const banked = snap({
        id: 1,
        kickoffUtc: '2026-06-11T19:00:00Z',
        status: 'finished',
        resultSource: 'auto',
        homeScore: 2,
        awayScore: 1,
        firstScorer: 'Player A',
        firstScoringTeam: 'home',
      });
      // ESPN re-credits the opening goal (deflection) to Player B.
      const corrected = espnEvent({
        state: 'post',
        completed: true,
        home: { score: '2' },
        away: { score: '1' },
        details: [
          { clock: 600, teamId: '100', athlete: 'Player B' },
          { clock: 2400, teamId: '200', athlete: 'Player C' },
        ],
      });
      expect(planSync([corrected], [banked]).actions).toEqual([
        {
          kind: 'result',
          matchId: 1,
          homeScore: 2,
          awayScore: 1,
          firstScorer: 'Player B',
          firstScoringTeam: 'home',
          homePens: null,
          awayPens: null,
        },
      ]);

      // Reclassified as an own goal: the scorer market shifts off Player A
      // (next non-own scorer wins it) while the team credit stands.
      const ownGoal = espnEvent({
        state: 'post',
        completed: true,
        home: { score: '2' },
        away: { score: '1' },
        details: [
          { clock: 600, teamId: '100', ownGoal: true, athlete: 'Player A' },
          { clock: 2400, teamId: '100', athlete: 'Player D' },
        ],
      });
      expect(planSync([ownGoal], [banked]).actions).toEqual([
        {
          kind: 'result',
          matchId: 1,
          homeScore: 2,
          awayScore: 1,
          firstScorer: 'Player D',
          firstScoringTeam: 'home',
          homePens: null,
          awayPens: null,
        },
      ]);
    });

    it('a detail-less re-serve of a banked result never rewrites or erases the scorer facts', () => {
      const banked = snap({
        id: 1,
        kickoffUtc: '2026-06-11T19:00:00Z',
        status: 'finished',
        resultSource: 'auto',
        homeScore: 2,
        awayScore: 1,
        firstScorer: 'Player A',
        firstScoringTeam: 'home',
      });
      const gappy = espnEvent({
        state: 'post',
        completed: true,
        home: { score: '2' },
        away: { score: '1' },
        details: [], // this pass the feed dropped the goal detail
      });
      const plan = planSync([gappy], [banked]);
      expect(plan.actions).toEqual([]);
      // …and it is not the "unusable — enter manually" case either: the
      // result is already banked, so there is nothing for the admin to do.
      expect(plan.notes).toEqual([]);
    });

    it('ignores junk tallies: a decisive score or a level shootout parses as no shootout', () => {
      // decisive score with stray shootout numbers → pens stay null
      const decisive = planSync(
        [
          espnEvent({
            state: 'post',
            completed: true,
            home: { score: '2', shootoutScore: 4 },
            away: { score: '1', shootoutScore: 2 },
            details: [{ clock: 1200, teamId: '100', athlete: 'Somebody' }],
          }),
        ],
        [M1],
      );
      expect(decisive.actions).toMatchObject([
        { kind: 'result', homePens: null, awayPens: null },
      ]);

      // a "finished" shootout can't be level → treated as absent
      const levelPens = planSync(
        [
          espnEvent({
            state: 'post',
            completed: true,
            home: { score: '0', shootoutScore: 3 },
            away: { score: '0', shootoutScore: 3 },
          }),
        ],
        [M1],
      );
      expect(levelPens.actions).toMatchObject([
        { kind: 'result', homePens: null, awayPens: null },
      ]);
    });
  });

  it('handles the real captured ESPN payload for June 11 (pre-game: no actions, no errors)', () => {
    const raw = JSON.parse(
      readFileSync('tests/fixtures/espn-scoreboard-20260611.json', 'utf8'),
    ) as { events: EspnEvent[] };
    const matches: MatchSnapshot[] = [
      snap({ id: 1, kickoffUtc: '2026-06-11T19:00:00Z' }),
      snap({
        id: 2,
        kickoffUtc: '2026-06-12T02:00:00Z',
        homeCode: 'KOR',
        awayCode: 'CZE',
        homeName: 'Korea Republic',
        awayName: 'Czechia',
      }),
    ];
    const plan = planSync(raw.events, matches);
    // pre-game events now legitimately yield odds snapshots — but never
    // results, live scores, or team fills
    expect(plan.actions.every((a) => a.kind === 'odds')).toBe(true);
    expect(plan.notes).toEqual([]);
  });
});
