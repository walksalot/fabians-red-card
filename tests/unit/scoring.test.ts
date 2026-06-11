import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCORING_RULES,
  normalizeName,
  scorePick,
  scorerMatches,
  type PickInput,
  type ResultInput,
} from '@/lib/scoring';

const RULES = DEFAULT_SCORING_RULES;
const NO_MULT = { roundMultiplier: 1, boosted: false, boosterMultiplier: 2 };

function pick(p: Partial<PickInput> = {}): PickInput {
  return { predHome: 0, predAway: 0, predScorer: null, predFirstTeam: null, ...p };
}

function result(r: Partial<ResultInput> = {}): ResultInput {
  return {
    homeScore: 0,
    awayScore: 0,
    firstScorer: null,
    firstScoringTeam: 'none',
    underdogSide: null,
    stage: 'group',
    ...r,
  };
}

describe('scoring engine', () => {
  it('exact score scores 10 points', () => {
    const b = scorePick(
      pick({ predHome: 2, predAway: 1 }),
      result({ homeScore: 2, awayScore: 1, firstScoringTeam: 'home' }),
      RULES,
      NO_MULT,
    );
    expect(b.exact).toBe(10);
    expect(b.outcome).toBe(0); // exact does not also pay the consolation
  });

  it('correct outcome only (right winner or draw) scores 2 points', () => {
    const winner = scorePick(
      pick({ predHome: 3, predAway: 1 }),
      result({ homeScore: 2, awayScore: 0, firstScoringTeam: 'home' }),
      RULES,
      NO_MULT,
    );
    expect(winner.exact).toBe(0);
    expect(winner.outcome).toBe(2);

    const draw = scorePick(
      pick({ predHome: 1, predAway: 1 }),
      result({ homeScore: 2, awayScore: 2, firstScoringTeam: 'away' }),
      RULES,
      NO_MULT,
    );
    expect(draw.outcome).toBe(2);

    const wrong = scorePick(
      pick({ predHome: 0, predAway: 2 }),
      result({ homeScore: 2, awayScore: 0, firstScoringTeam: 'home' }),
      RULES,
      NO_MULT,
    );
    expect(wrong.outcome).toBe(0);
    expect(wrong.total).toBe(0);
  });

  it('first goalscorer scores 8 points', () => {
    const b = scorePick(
      pick({ predHome: 1, predAway: 0, predScorer: 'Kylian Mbappé' }),
      result({
        homeScore: 0,
        awayScore: 2,
        firstScorer: 'kylian mbappe', // diacritics + case must not matter
        firstScoringTeam: 'away',
      }),
      RULES,
      NO_MULT,
    );
    expect(b.scorer).toBe(8);

    const miss = scorePick(
      pick({ predHome: 1, predAway: 0, predScorer: 'Harry Kane' }),
      result({ homeScore: 1, awayScore: 0, firstScorer: 'Jude Bellingham', firstScoringTeam: 'home' }),
      RULES,
      NO_MULT,
    );
    expect(miss.scorer).toBe(0);
  });

  it('first team to score scores 2 points', () => {
    const b = scorePick(
      pick({ predHome: 2, predAway: 1, predFirstTeam: 'away' }),
      result({ homeScore: 1, awayScore: 1, firstScorer: 'X', firstScoringTeam: 'away' }),
      RULES,
      NO_MULT,
    );
    expect(b.firstTeam).toBe(2);

    const none = scorePick(
      pick({ predHome: 0, predAway: 0, predFirstTeam: 'none' }),
      result({ homeScore: 0, awayScore: 0, firstScoringTeam: 'none' }),
      RULES,
      NO_MULT,
    );
    expect(none.firstTeam).toBe(2); // correctly calling a goalless game counts

    const noPick = scorePick(
      pick({ predHome: 1, predAway: 0, predFirstTeam: null }),
      result({ homeScore: 1, awayScore: 0, firstScoringTeam: 'home' }),
      RULES,
      NO_MULT,
    );
    expect(noPick.firstTeam).toBe(0);
  });

  it('underdog pick bonus scores 5 points', () => {
    const hit = scorePick(
      pick({ predHome: 0, predAway: 1 }),
      result({
        homeScore: 1,
        awayScore: 2,
        firstScorer: 'X',
        firstScoringTeam: 'home',
        underdogSide: 'away',
      }),
      RULES,
      NO_MULT,
    );
    expect(hit.underdog).toBe(5);

    // predicted underdog win but favourite won: no bonus
    const upset = scorePick(
      pick({ predHome: 0, predAway: 1 }),
      result({ homeScore: 2, awayScore: 0, firstScoringTeam: 'home', underdogSide: 'away' }),
      RULES,
      NO_MULT,
    );
    expect(upset.underdog).toBe(0);

    // underdog won but pick didn't back them: no bonus
    const noBack = scorePick(
      pick({ predHome: 2, predAway: 0 }),
      result({ homeScore: 0, awayScore: 1, firstScoringTeam: 'away', underdogSide: 'away' }),
      RULES,
      NO_MULT,
    );
    expect(noBack.underdog).toBe(0);

    // no underdog designated: no bonus possible
    const noFlag = scorePick(
      pick({ predHome: 0, predAway: 1 }),
      result({ homeScore: 0, awayScore: 1, firstScoringTeam: 'away', underdogSide: null }),
      RULES,
      NO_MULT,
    );
    expect(noFlag.underdog).toBe(0);
  });

  it('components stack: exact + scorer + first team + underdog in one match', () => {
    const b = scorePick(
      pick({ predHome: 1, predAway: 2, predScorer: 'Lionel Messi', predFirstTeam: 'away' }),
      result({
        homeScore: 1,
        awayScore: 2,
        firstScorer: 'Lionel Messi',
        firstScoringTeam: 'away',
        underdogSide: 'away',
      }),
      RULES,
      NO_MULT,
    );
    expect(b.base).toBe(10 + 8 + 2 + 5);
    expect(b.total).toBe(25);
  });

  it('configurable round multipliers for knockout rounds multiply the base', () => {
    const b = scorePick(
      pick({ predHome: 2, predAway: 1, predFirstTeam: 'home' }),
      result({ homeScore: 2, awayScore: 1, firstScorer: 'X', firstScoringTeam: 'home', stage: 'final' }),
      RULES,
      { roundMultiplier: 3, boosted: false, boosterMultiplier: 2 },
    );
    expect(b.base).toBe(12);
    expect(b.total).toBe(36);
  });

  it('daily booster multiplies the points for the boosted match', () => {
    const boosted = scorePick(
      pick({ predHome: 2, predAway: 1 }),
      result({ homeScore: 2, awayScore: 1, firstScoringTeam: 'home' }),
      RULES,
      { roundMultiplier: 1, boosted: true, boosterMultiplier: 2 },
    );
    expect(boosted.total).toBe(20);

    const notBoosted = scorePick(
      pick({ predHome: 2, predAway: 1 }),
      result({ homeScore: 2, awayScore: 1, firstScoringTeam: 'home' }),
      RULES,
      { roundMultiplier: 1, boosted: false, boosterMultiplier: 2 },
    );
    expect(notBoosted.total).toBe(10);
  });

  it('booster and round multipliers stack multiplicatively', () => {
    const b = scorePick(
      pick({ predHome: 1, predAway: 0 }),
      result({ homeScore: 1, awayScore: 0, firstScoringTeam: 'home', stage: 'sf' }),
      RULES,
      { roundMultiplier: 2, boosted: true, boosterMultiplier: 2 },
    );
    expect(b.total).toBe(40);
  });

  it('zero base stays zero through multipliers', () => {
    const b = scorePick(
      pick({ predHome: 0, predAway: 3 }),
      result({ homeScore: 3, awayScore: 0, firstScorer: 'Y', firstScoringTeam: 'home' }),
      RULES,
      { roundMultiplier: 3, boosted: true, boosterMultiplier: 2 },
    );
    expect(b.total).toBe(0);
  });
});

describe('normalizeName', () => {
  it('ignores case, whitespace, periods and diacritics', () => {
    expect(normalizeName('  Kylian  MBAPPÉ. ')).toBe(normalizeName('kylian mbappe'));
    expect(normalizeName('Müller')).toBe(normalizeName('muller'));
    expect(normalizeName('St. Juste')).toBe(normalizeName('st juste'));
  });
});

describe('scorerMatches (forgiving scorer comparison)', () => {
  it('full name matches with accents/case ignored', () => {
    expect(scorerMatches('raul jimenez', 'Raúl Jiménez')).toBe(true);
  });
  it('surname alone counts', () => {
    expect(scorerMatches('Mbappé', 'Kylian Mbappé')).toBe(true);
    expect(scorerMatches('jimenez', 'Raúl Jiménez')).toBe(true);
  });
  it('multi-word surnames count as a token suffix', () => {
    expect(scorerMatches('van Dijk', 'Virgil van Dijk')).toBe(true);
  });
  it('first name alone does NOT count', () => {
    expect(scorerMatches('Kylian', 'Kylian Mbappé')).toBe(false);
    expect(scorerMatches('Raúl', 'Raúl Jiménez')).toBe(false);
  });
  it('different players never match', () => {
    expect(scorerMatches('Messi', 'Cristiano Ronaldo')).toBe(false);
    expect(scorerMatches('Jiménez González', 'Raúl Jiménez')).toBe(false);
  });
  it('empty strings never match', () => {
    expect(scorerMatches('', 'Anyone')).toBe(false);
    expect(scorerMatches('  ', 'Anyone')).toBe(false);
  });
});
