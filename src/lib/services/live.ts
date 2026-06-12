/**
 * "If it ended now" — the live provisional board.
 *
 * For every in-progress match, run the REAL scoring engine against the live
 * snapshot (current score + first-goal facts from the feed) for every entry's
 * pick, boosters and multipliers included. Pure display: nothing here is ever
 * written to matchPoints — real points settle only at full time, through the
 * exact same engine, which is why the provisional numbers equal the real ones
 * at the final whistle.
 *
 * Privacy: only matches that have KICKED OFF qualify, so every pick shown is
 * already public under the existing reveal-at-kickoff rule.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import { nowMs } from '@/lib/clock';
import {
  scorePick,
  type PointsBreakdown,
  type ResultInput,
  type ScoringRules,
  type Stage,
} from '@/lib/scoring';

export interface LiveBoardRow {
  entryId: number;
  label: string;
  displayName: string;
  pick: {
    predHome: number;
    predAway: number;
    predScorer: string | null;
    predFirstTeam: 'home' | 'away' | 'none' | null;
  } | null;
  boosted: boolean;
  /** Engine output against the live snapshot; null when the entry has no pick. */
  breakdown: PointsBreakdown | null;
  total: number;
}

export interface LiveBoard {
  matchId: number;
  stage: string;
  kickoffUtc: string;
  homeName: string;
  awayName: string;
  homeCode: string | null;
  awayCode: string | null;
  liveHome: number;
  liveAway: number;
  liveFirstScorer: string | null;
  /** Feed's match clock ("55'", "HT") — minutes accrued, soccer counts up. */
  liveClock: string | null;
  liveUpdatedAt: number | null;
  /** False while the match has kicked off but the feed hasn't reported yet. */
  hasLiveData: boolean;
  rows: LiveBoardRow[];
}

/** All in-progress matches (kicked off per the app clock, not finished). */
function liveMatches(db: Db) {
  const now = nowMs();
  return db
    .select()
    .from(schema.matches)
    .where(eq(schema.matches.status, 'scheduled'))
    .all()
    .filter((m) => now >= Date.parse(m.kickoffUtc));
}

export function getLiveBoards(db: Db, leagueId: number): LiveBoard[] {
  const matches = liveMatches(db);
  if (matches.length === 0) return [];

  const league = db
    .select()
    .from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .get();
  if (!league) return [];
  const rules = JSON.parse(league.scoringRules) as ScoringRules;
  const multipliers = JSON.parse(league.roundMultipliers) as Record<string, number>;

  const teams = new Map(
    db.select().from(schema.teams).all().map((t) => [t.id, t]),
  );
  const entries = db
    .select({
      entryId: schema.entries.id,
      label: schema.entries.label,
      displayName: schema.users.displayName,
    })
    .from(schema.entries)
    .innerJoin(schema.users, eq(schema.users.id, schema.entries.userId))
    .where(eq(schema.entries.leagueId, leagueId))
    .all();
  if (entries.length === 0) return [];
  const entryIds = entries.map((e) => e.entryId);

  const matchIds = matches.map((m) => m.id);
  const picks = db
    .select()
    .from(schema.picks)
    .where(
      and(
        inArray(schema.picks.matchId, matchIds),
        inArray(schema.picks.entryId, entryIds),
      ),
    )
    .all();
  const pickBy = new Map(picks.map((p) => [`${p.entryId}:${p.matchId}`, p]));

  const matchdays = [...new Set(matches.map((m) => m.matchday))];
  const boosterRows = db
    .select()
    .from(schema.boosters)
    .where(
      and(
        inArray(schema.boosters.matchday, matchdays),
        inArray(schema.boosters.entryId, entryIds),
      ),
    )
    .all();
  const boosterBy = new Map(
    boosterRows.map((b) => [`${b.entryId}:${b.matchday}`, b.matchId]),
  );

  return matches.map((m) => {
    const hasLiveData = m.liveHome !== null && m.liveAway !== null;
    const underdogSide =
      m.underdogTeamId === null
        ? null
        : m.underdogTeamId === m.homeTeamId
          ? ('home' as const)
          : m.underdogTeamId === m.awayTeamId
            ? ('away' as const)
            : null;
    // Unknown first-scoring team (no goal yet, or feed didn't attribute it)
    // counts as 'none': first-team picks stay conservatively unscored until
    // the fact is known — provisional numbers should under-promise.
    const snapshot: ResultInput = {
      homeScore: m.liveHome ?? 0,
      awayScore: m.liveAway ?? 0,
      firstScorer: m.liveFirstScorer,
      firstScoringTeam: (m.liveFirstScoringTeam as 'home' | 'away' | null) ?? 'none',
      underdogSide,
      stage: m.stage as Stage,
    };
    const roundMultiplier = multipliers[m.stage] ?? 1;

    const rows: LiveBoardRow[] = entries.map((e) => {
      const p = pickBy.get(`${e.entryId}:${m.id}`);
      const boosted = boosterBy.get(`${e.entryId}:${m.matchday}`) === m.id;
      if (!p || !hasLiveData) {
        return {
          entryId: e.entryId,
          label: e.label,
          displayName: e.displayName,
          pick: p
            ? {
                predHome: p.predHome,
                predAway: p.predAway,
                predScorer: p.predScorer,
                predFirstTeam: p.predFirstTeam as 'home' | 'away' | 'none' | null,
              }
            : null,
          boosted,
          breakdown: null,
          total: 0,
        };
      }
      const breakdown = scorePick(
        {
          predHome: p.predHome,
          predAway: p.predAway,
          predScorer: p.predScorer,
          predFirstTeam: p.predFirstTeam as 'home' | 'away' | 'none' | null,
        },
        snapshot,
        rules,
        { roundMultiplier, boosted, boosterMultiplier: league.boosterMultiplier },
      );
      // Goals exist but the feed hasn't attributed the first one: nobody can
      // claim first-team points yet — strip the phantom 'none' award.
      if (
        (m.liveHome ?? 0) + (m.liveAway ?? 0) > 0 &&
        m.liveFirstScoringTeam === null &&
        breakdown.firstTeam > 0
      ) {
        breakdown.base -= breakdown.firstTeam;
        breakdown.total =
          breakdown.base * breakdown.roundMultiplier * breakdown.boosterMultiplier;
        breakdown.firstTeam = 0;
      }
      return {
        entryId: e.entryId,
        label: e.label,
        displayName: e.displayName,
        pick: {
          predHome: p.predHome,
          predAway: p.predAway,
          predScorer: p.predScorer,
          predFirstTeam: p.predFirstTeam as 'home' | 'away' | 'none' | null,
        },
        boosted,
        breakdown,
        total: breakdown.total,
      };
    });

    // Best provisional first; no-pick rows sink. Points ties break by the
    // documented tiebreaker chain (Rules: most exact scores, then most
    // first-goalscorer hits), applied to this snapshot; label keeps the
    // order stable when everything is level.
    rows.sort(
      (a, b) =>
        Number(b.pick !== null) - Number(a.pick !== null) ||
        b.total - a.total ||
        (b.breakdown?.exact ?? 0) - (a.breakdown?.exact ?? 0) ||
        (b.breakdown?.scorer ?? 0) - (a.breakdown?.scorer ?? 0) ||
        a.label.localeCompare(b.label),
    );

    const home = m.homeTeamId !== null ? teams.get(m.homeTeamId) : undefined;
    const away = m.awayTeamId !== null ? teams.get(m.awayTeamId) : undefined;
    return {
      matchId: m.id,
      stage: m.stage,
      kickoffUtc: m.kickoffUtc,
      homeName: home?.name ?? m.homePlaceholder ?? 'TBD',
      awayName: away?.name ?? m.awayPlaceholder ?? 'TBD',
      homeCode: home?.code ?? null,
      awayCode: away?.code ?? null,
      liveHome: m.liveHome ?? 0,
      liveAway: m.liveAway ?? 0,
      liveFirstScorer: m.liveFirstScorer,
      liveClock: m.liveClock,
      liveUpdatedAt: m.liveUpdatedAt,
      hasLiveData,
      rows,
    };
  });
}
