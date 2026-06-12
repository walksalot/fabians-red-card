/**
 * Pure scoring engine. No imports, no I/O — everything needed to score a pick
 * is passed in, which keeps this exhaustively unit-testable.
 *
 * Base points (league-configurable, defaults in parentheses):
 *  - exact score (10): predicted scoreline identical to the result
 *  - outcome (2): consolation when NOT exact but the result tendency
 *    (home win / draw / away win) was right
 *  - scorer (8): first goalscorer matches (normalized name comparison)
 *  - firstTeam (2): first team to score matches ('none' = correctly called no goals)
 *  - underdog (5): match has a designated underdog, the pick predicted the
 *    underdog to win, and the underdog won
 *
 * total = (sum of base points) × round multiplier × booster multiplier (if boosted)
 */

export type Stage = 'group' | 'r32' | 'r16' | 'qf' | 'sf' | 'third' | 'final';

export interface ScoringRules {
  exact: number;
  outcome: number;
  scorer: number;
  firstTeam: number;
  underdog: number;
}

export interface PickInput {
  predHome: number;
  predAway: number;
  predScorer: string | null;
  predFirstTeam: 'home' | 'away' | 'none' | null;
}

export interface ResultInput {
  homeScore: number;
  awayScore: number;
  firstScorer: string | null;
  firstScoringTeam: 'home' | 'away' | 'none';
  underdogSide: 'home' | 'away' | null;
  stage: Stage;
}

export interface PointsBreakdown {
  exact: number;
  outcome: number;
  scorer: number;
  firstTeam: number;
  underdog: number;
  base: number;
  roundMultiplier: number;
  boosterMultiplier: number;
  total: number;
}

export const DEFAULT_SCORING_RULES: ScoringRules = {
  exact: 10,
  outcome: 2,
  scorer: 8,
  firstTeam: 2,
  underdog: 5,
};

export const DEFAULT_ROUND_MULTIPLIERS: Record<Stage, number> = {
  group: 1,
  r32: 1,
  r16: 1,
  qf: 1,
  sf: 1,
  third: 1,
  final: 1,
};

/** Case-, whitespace-, diacritic- and period-insensitive name comparison key. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\./g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function sign(d: number): -1 | 0 | 1 {
  return d > 0 ? 1 : d < 0 ? -1 : 0;
}

/**
 * Forgiving scorer comparison ("the 90% match" the pool asked for, kept safe):
 * after normalization, a pick matches the actual scorer when it is the full
 * name OR a whole-token suffix of it — so "mbappe", "jiménez", and "van Dijk"
 * all count for "Kylian Mbappé", "Raúl Jiménez", "Virgil van Dijk". Suffix-only
 * (surnames identify players; first names alone — "kylian" — do not count).
 */
export function scorerMatches(pick: string, actual: string): boolean {
  const p = normalizeName(pick);
  const a = normalizeName(actual);
  if (p === '' || a === '') return false;
  if (p === a) return true;
  const pT = p.split(' ');
  const aT = a.split(' ');
  if (pT.length >= aT.length) return false;
  return aT.slice(aT.length - pT.length).join(' ') === p;
}

/**
 * Canonical squad spelling for a typed scorer pick: when the typed name
 * unambiguously matches exactly one squad player ("Raul Jimenez" →
 * "Raúl Jiménez"), return the squad spelling so every display shows the same
 * name the squad list and results use. Ambiguous or unknown names stay as
 * typed — the forgiving matching at scoring time keeps its semantics.
 */
export function canonicalScorer(
  typed: string | null,
  squad: readonly string[],
): string | null {
  if (typed === null) return null;
  const hits = squad.filter((name) => scorerMatches(typed, name));
  return hits.length === 1 ? hits[0] : typed;
}

export function scorePick(
  pick: PickInput,
  result: ResultInput,
  rules: ScoringRules,
  opts: { roundMultiplier: number; boosted: boolean; boosterMultiplier: number },
): PointsBreakdown {
  const isExact =
    pick.predHome === result.homeScore && pick.predAway === result.awayScore;
  const exact = isExact ? rules.exact : 0;

  const outcome =
    !isExact &&
    sign(pick.predHome - pick.predAway) === sign(result.homeScore - result.awayScore)
      ? rules.outcome
      : 0;

  const scorer =
    pick.predScorer !== null &&
    result.firstScorer !== null &&
    scorerMatches(pick.predScorer, result.firstScorer)
      ? rules.scorer
      : 0;

  const firstTeam =
    pick.predFirstTeam !== null && pick.predFirstTeam === result.firstScoringTeam
      ? rules.firstTeam
      : 0;

  let underdog = 0;
  if (result.underdogSide !== null) {
    const predictedUnderdogWin =
      result.underdogSide === 'home'
        ? pick.predHome > pick.predAway
        : pick.predAway > pick.predHome;
    const underdogWon =
      result.underdogSide === 'home'
        ? result.homeScore > result.awayScore
        : result.awayScore > result.homeScore;
    if (predictedUnderdogWin && underdogWon) underdog = rules.underdog;
  }

  const base = exact + outcome + scorer + firstTeam + underdog;
  const boosterMultiplier = opts.boosted ? opts.boosterMultiplier : 1;
  const total = base * opts.roundMultiplier * boosterMultiplier;

  return {
    exact,
    outcome,
    scorer,
    firstTeam,
    underdog,
    base,
    roundMultiplier: opts.roundMultiplier,
    boosterMultiplier,
    total,
  };
}
