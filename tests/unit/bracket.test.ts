import { describe, expect, it } from 'vitest';
import { buildBracket, type BracketMatchRow, type BracketTeamRef } from '@/lib/bracket';

const TEAMS = new Map<number, BracketTeamRef>([
  [1, { id: 1, code: 'MEX', name: 'Mexico' }],
  [2, { id: 2, code: 'ECU', name: 'Ecuador' }],
  [3, { id: 3, code: 'ENG', name: 'England' }],
  [4, { id: 4, code: 'COD', name: 'DR Congo' }],
  [5, { id: 5, code: 'GER', name: 'Germany' }],
  [6, { id: 6, code: 'PAR', name: 'Paraguay' }],
]);

function row(partial: Partial<BracketMatchRow> & { id: number; stage: string }): BracketMatchRow {
  return {
    kickoffUtc: '2026-07-01T01:00:00Z',
    matchday: '2026-06-30',
    venue: 'V',
    city: 'C',
    status: 'scheduled',
    homeTeamId: null,
    awayTeamId: null,
    homePlaceholder: null,
    awayPlaceholder: null,
    homeScore: null,
    awayScore: null,
    liveStatus: null,
    liveHome: null,
    liveAway: null,
    liveClock: null,
    ...partial,
  };
}

describe('buildBracket', () => {
  it('marks winner/loser from the score and propagates possible codes up the tree', () => {
    const nodes = buildBracket(
      [
        row({ id: 79, stage: 'r32', status: 'finished', homeTeamId: 1, awayTeamId: 2, homeScore: 2, awayScore: 0 }),
        row({ id: 80, stage: 'r32', status: 'finished', homeTeamId: 3, awayTeamId: 4, homeScore: 2, awayScore: 1 }),
        row({
          id: 92, stage: 'r16',
          homePlaceholder: 'Winners Match 79', awayPlaceholder: 'Winners Match 80',
        }),
      ],
      TEAMS,
    );
    const r79 = nodes.find((n) => n.matchId === 79)!;
    expect(r79.home.won).toBe(true);
    expect(r79.away.lost).toBe(true);
    const r92 = nodes.find((n) => n.matchId === 92)!;
    expect(r92.feeders).toEqual([79, 80]);
    // the empty R16 slot knows every team that could still arrive
    expect([...r92.possibleCodes].sort()).toEqual(['COD', 'ECU', 'ENG', 'MEX']);
  });

  it('level finished tie is flagged as penalties and stays undecided until the child fills', () => {
    const pending = buildBracket(
      [
        row({ id: 74, stage: 'r32', status: 'finished', homeTeamId: 5, awayTeamId: 6, homeScore: 1, awayScore: 1 }),
        row({ id: 89, stage: 'r16', homePlaceholder: 'Winners Match 74', awayPlaceholder: 'Winners Match 77' }),
      ],
      TEAMS,
    );
    const tie = pending.find((n) => n.matchId === 74)!;
    expect(tie.decidedOnPens).toBe(true);
    expect(tie.home.won).toBe(false);
    expect(tie.away.won).toBe(false);

    // once the R16 slot fills with Paraguay, the pens winner is inferred
    const decided = buildBracket(
      [
        row({ id: 74, stage: 'r32', status: 'finished', homeTeamId: 5, awayTeamId: 6, homeScore: 1, awayScore: 1 }),
        row({ id: 89, stage: 'r16', homeTeamId: 6, awayTeamId: null, homePlaceholder: 'Winners Match 74', awayPlaceholder: 'Winners Match 77' }),
      ],
      TEAMS,
    );
    const tie2 = decided.find((n) => n.matchId === 74)!;
    expect(tie2.away.won).toBe(true); // Paraguay advanced
    expect(tie2.home.lost).toBe(true); // Germany out
  });

  it('a child filled from elsewhere never eliminates a pens pair', () => {
    // R16 slot has a team, but it is NEITHER of the pens pair (data oddity):
    // nobody should be marked out.
    const nodes = buildBracket(
      [
        row({ id: 74, stage: 'r32', status: 'finished', homeTeamId: 5, awayTeamId: 6, homeScore: 1, awayScore: 1 }),
        row({ id: 89, stage: 'r16', homeTeamId: 1, homePlaceholder: 'Winners Match 74', awayPlaceholder: 'Winners Match 77' }),
      ],
      TEAMS,
    );
    const tie = nodes.find((n) => n.matchId === 74)!;
    expect(tie.home.won).toBe(false);
    expect(tie.home.lost).toBe(false);
    expect(tie.away.won).toBe(false);
    expect(tie.away.lost).toBe(false);
  });

  it('orders by stage then kickoff and marks live matches', () => {
    const nodes = buildBracket(
      [
        row({ id: 92, stage: 'r16', kickoffUtc: '2026-07-04T01:00:00Z' }),
        row({ id: 79, stage: 'r32', liveStatus: 'in', liveHome: 1, liveAway: 0, homeTeamId: 1, awayTeamId: 2 }),
      ],
      TEAMS,
    );
    expect(nodes.map((n) => n.matchId)).toEqual([79, 92]);
    expect(nodes[0].live).toBe(true);
  });
});
