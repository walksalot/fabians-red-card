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
    homeScore: null,
    awayScore: null,
    ...partial,
  };
}

function espnEvent(over: {
  date?: string;
  name?: string;
  state?: 'pre' | 'in' | 'post';
  completed?: boolean;
  home?: { abbr?: string; name?: string; score?: string; id?: string };
  away?: { abbr?: string; name?: string; score?: string; id?: string };
  details?: Array<{
    scoringPlay?: boolean;
    ownGoal?: boolean;
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
          type: { completed: over.completed ?? false, state: over.state ?? 'pre' },
        },
        venue: over.venue ? { fullName: over.venue } : undefined,
        competitors: [
          {
            homeAway: 'home',
            score: over.home?.score,
            team: {
              id: over.home?.id ?? '100',
              abbreviation: over.home?.abbr ?? 'MEX',
              displayName: over.home?.name ?? 'Mexico',
            },
          },
          {
            homeAway: 'away',
            score: over.away?.score,
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
    expect(plan.actions).toEqual([{ kind: 'live', matchId: 1, liveHome: 1, liveAway: 0, firstScorer: null, firstScoringTeam: null }]);
  });

  it('is idempotent for already-applied auto results', () => {
    const done = snap({
      id: 1,
      kickoffUtc: '2026-06-11T19:00:00Z',
      status: 'finished',
      resultSource: 'auto',
      homeScore: 2,
      awayScore: 1,
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
      { kind: 'teams', matchId: 73, homeCode: 'BRA', awayCode: 'SCO' },
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
    expect(plan.actions).toEqual([{ kind: 'live', matchId: 1, liveHome: 1, liveAway: 1, firstScorer: null, firstScoringTeam: null }]);
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
    expect(plan.actions).toEqual([]);
    expect(plan.notes).toEqual([]);
  });
});
