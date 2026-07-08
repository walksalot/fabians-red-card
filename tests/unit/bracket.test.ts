import { describe, expect, it } from 'vitest';
import {
  buildBracket,
  feederMapFromFixtures,
  type BracketMatchRow,
  type BracketTeamRef,
  type FeederMap,
} from '@/lib/bracket';

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

  it('recorded shootout tallies mark the pens winner immediately — no child fill needed', () => {
    const nodes = buildBracket(
      [
        row({
          id: 74, stage: 'r32', status: 'finished',
          homeTeamId: 5, awayTeamId: 6,
          homeScore: 1, awayScore: 1, homePens: 3, awayPens: 5,
        }),
        row({ id: 89, stage: 'r16', homePlaceholder: 'Winners Match 74', awayPlaceholder: 'Winners Match 77' }),
      ],
      TEAMS,
    );
    const tie = nodes.find((n) => n.matchId === 74)!;
    expect(tie.decidedOnPens).toBe(true);
    expect(tie.away.won).toBe(true); // Paraguay win the shootout 5-3
    expect(tie.home.lost).toBe(true);
    // The tallies ride on the sides for display ("1 (3)" / "1 (5)").
    expect(tie.home.pens).toBe(3);
    expect(tie.away.pens).toBe(5);
    // A decisive score keeps pens null on both sides.
    const child = nodes.find((n) => n.matchId === 89)!;
    expect(child.home.pens).toBeNull();
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

  it('keeps feeders and pens inference when auto-fill erased the placeholders', () => {
    // Production behavior: setMatchTeams NULLs home/away placeholders as it
    // fills team ids, which used to orphan the connectors. The fixtures-derived
    // feeder map is the fallback wiring.
    const feederMap: FeederMap = new Map([
      [
        89,
        [
          { match: 74, losers: false },
          { match: 77, losers: false },
        ] as const,
      ],
    ]);
    const nodes = buildBracket(
      [
        row({ id: 74, stage: 'r32', status: 'finished', homeTeamId: 5, awayTeamId: 6, homeScore: 1, awayScore: 1 }),
        row({ id: 77, stage: 'r32', status: 'finished', homeTeamId: 1, awayTeamId: 2, homeScore: 2, awayScore: 0 }),
        // Both slots filled, both placeholders gone — the broken-in-prod shape.
        row({ id: 89, stage: 'r16', homeTeamId: 6, awayTeamId: 1 }),
      ],
      TEAMS,
      undefined,
      feederMap,
    );
    const child = nodes.find((n) => n.matchId === 89)!;
    expect(child.feeders).toEqual([74, 77]);
    // Filled slots pin possible codes to the actual teams, not the feeders' losers.
    expect([...child.possibleCodes].sort()).toEqual(['MEX', 'PAR']);
    // Pens winner still inferred through the map: Paraguay advanced, Germany out.
    const tie = nodes.find((n) => n.matchId === 74)!;
    expect(tie.decidedOnPens).toBe(true);
    expect(tie.away.won).toBe(true);
    expect(tie.home.lost).toBe(true);
  });

  it('derives the feeder map from fixtures rows', () => {
    const map = feederMapFromFixtures([
      { n: 74, home: 'Group E winners', away: '3rd Group A/B/C/D/F' },
      { n: 89, home: 'Winners Match 74', away: 'Winners Match 77' },
      { n: 103, home: 'Losers Match 101', away: 'Losers Match 102' },
      { n: 104, home: 'Winners Match 101', away: 'Winners Match 102' },
    ]);
    expect(map.get(74)).toBeUndefined(); // group-sourced: no knockout feeders
    expect(map.get(89)).toEqual([
      { match: 74, losers: false },
      { match: 77, losers: false },
    ]);
    expect(map.get(103)).toEqual([
      { match: 101, losers: true },
      { match: 102, losers: true },
    ]);
    expect(map.get(104)).toEqual([
      { match: 101, losers: false },
      { match: 102, losers: false },
    ]);
  });

  it('third-place (losers) feed never counts as advancement for a tied semifinal', () => {
    // SF 101 goes to pens; both the final (104) and third-place tie (103) are
    // auto-filled. Only the FINAL identifies the semifinal winner — the
    // third-place teams are the losers and must not mark anyone as advanced.
    const nodes = buildBracket(
      [
        row({ id: 101, stage: 'sf', status: 'finished', homeTeamId: 5, awayTeamId: 6, homeScore: 2, awayScore: 2 }),
        row({ id: 102, stage: 'sf', status: 'finished', homeTeamId: 1, awayTeamId: 3, homeScore: 1, awayScore: 0 }),
        row({ id: 103, stage: 'third', homeTeamId: 5, awayTeamId: 3, homePlaceholder: 'Losers Match 101', awayPlaceholder: 'Losers Match 102' }),
        row({ id: 104, stage: 'final', homeTeamId: 6, awayTeamId: 1, homePlaceholder: 'Winners Match 101', awayPlaceholder: 'Winners Match 102' }),
      ],
      TEAMS,
    );
    const sf = nodes.find((n) => n.matchId === 101)!;
    expect(sf.decidedOnPens).toBe(true);
    expect(sf.away.won).toBe(true); // Paraguay reached the final
    expect(sf.home.lost).toBe(true); // Germany plays the third-place tie
    expect(sf.home.won).toBe(false);
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
