/**
 * Pure planner for the optional ESPN auto-results sync. No I/O — takes the raw
 * scoreboard JSON plus a snapshot of our matches and returns the safe actions
 * to apply. The orchestrator (espn-sync.ts) does the fetching and DB writes.
 *
 * Safety rules encoded here:
 *  - a match whose result was entered manually (resultSource='manual') is NEVER touched
 *  - a completed game with unusable goal detail produces NO result action
 *    (admin enters that one by hand) — never half-guessed points
 *  - first-goalscorer follows the standard pool market: own goals don't count
 *    for the scorer pick, but they DO count for "first team to score"
 *  - events that can't be matched unambiguously to one fixture are skipped with a note
 */

import { parseScoreboardOdds, type MatchOdds } from '@/lib/odds';

export interface EspnTeamRef {
  id?: string;
  abbreviation?: string;
  displayName?: string;
}

export interface EspnCompetitor {
  homeAway?: string;
  score?: string | number;
  team?: EspnTeamRef;
}

export interface EspnDetail {
  scoringPlay?: boolean;
  ownGoal?: boolean;
  redCard?: boolean;
  clock?: { value?: number };
  team?: { id?: string };
  athletesInvolved?: Array<{ displayName?: string }>;
}

export interface EspnCompetition {
  status?: { type?: { completed?: boolean; state?: string } };
  odds?: unknown;
  competitors?: EspnCompetitor[];
  details?: EspnDetail[];
  venue?: { fullName?: string };
}

export interface EspnEvent {
  date?: string;
  name?: string;
  competitions?: EspnCompetition[];
}

/** Minimal view of our matches the planner needs. */
export interface MatchSnapshot {
  id: number;
  kickoffUtc: string; // YYYY-MM-DDTHH:MM:00Z
  homeCode: string | null;
  awayCode: string | null;
  homeName: string | null;
  awayName: string | null;
  status: string; // 'scheduled' | 'finished'
  resultSource: string | null; // 'auto' | 'manual' | null
  homeScore: number | null;
  awayScore: number | null;
}

export type SyncAction =
  | { kind: 'teams'; matchId: number; homeCode: string; awayCode: string }
  | { kind: 'odds'; matchId: number; odds: MatchOdds }
  | {
      kind: 'live';
      matchId: number;
      liveHome: number;
      liveAway: number;
      /** First-goal facts as they stand mid-match (null until the first goal). */
      firstScorer: string | null;
      firstScoringTeam: 'home' | 'away' | null;
    }
  | {
      kind: 'result';
      matchId: number;
      homeScore: number;
      awayScore: number;
      firstScorer: string | null;
      firstScoringTeam: 'home' | 'away' | 'none';
    };

export interface SyncPlan {
  actions: SyncAction[];
  notes: string[];
}

/** '2026-06-11T19:00Z' / '...T19:00:00Z' / '...T19:00:00.000Z' → '2026-06-11T19:00:00Z' */
export function normalizeKickoff(date: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2})?(?:\.\d+)?Z$/.exec(date.trim());
  if (!m) return null;
  return `${m[1]}T${m[2]}:${m[3]}:00Z`;
}

function plainName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseScore(v: string | number | undefined): number | null {
  if (v === undefined || v === null) return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isInteger(n) && n >= 0 && n <= 99 ? n : null;
}

interface Sides {
  home: EspnCompetitor;
  away: EspnCompetitor;
}

function sidesOf(comp: EspnCompetition): Sides | null {
  const home = comp.competitors?.find((c) => c.homeAway === 'home');
  const away = comp.competitors?.find((c) => c.homeAway === 'away');
  return home && away ? { home, away } : null;
}

/** True when the ESPN competitor refers to our team code/name. */
function refersTo(c: EspnCompetitor, code: string | null, name: string | null): boolean {
  if (!c.team) return false;
  if (code && c.team.abbreviation && c.team.abbreviation.toUpperCase() === code) return true;
  if (name && c.team.displayName && plainName(c.team.displayName) === plainName(name)) return true;
  return false;
}

function firstGoal(details: EspnDetail[] | undefined): {
  scorer: string | null;
  teamId: string | null;
} | null {
  const plays = (details ?? [])
    .filter((d) => d.scoringPlay === true)
    .sort((a, b) => (a.clock?.value ?? 0) - (b.clock?.value ?? 0));
  if (plays.length === 0) return null;
  const first = plays[0];
  const firstNonOwn = plays.find((d) => d.ownGoal !== true);
  return {
    scorer: firstNonOwn?.athletesInvolved?.[0]?.displayName ?? null,
    teamId: first.team?.id ?? null,
  };
}

export function planSync(
  events: EspnEvent[],
  matches: MatchSnapshot[],
  nowMs = 0,
): SyncPlan {
  const actions: SyncAction[] = [];
  const notes: string[] = [];
  const byKickoff = new Map<string, MatchSnapshot[]>();
  for (const m of matches) {
    const list = byKickoff.get(m.kickoffUtc) ?? [];
    list.push(m);
    byKickoff.set(m.kickoffUtc, list);
  }

  for (const event of events) {
    const comp = event.competitions?.[0];
    const when = event.date ? normalizeKickoff(event.date) : null;
    const sides = comp ? sidesOf(comp) : null;
    if (!comp || !when || !sides) {
      notes.push(`skipped unparseable event: ${event.name ?? '(unnamed)'}`);
      continue;
    }
    const candidates = byKickoff.get(when) ?? [];
    if (candidates.length === 0) continue; // not one of ours (or kickoff moved — admin handles)

    // 1. exact team match (orientation-aware)
    let match = candidates.find(
      (m) =>
        m.homeCode &&
        m.awayCode &&
        refersTo(sides.home, m.homeCode, m.homeName) &&
        refersTo(sides.away, m.awayCode, m.awayName),
    );

    // 2. placeholder fill: a knockout slot at this kickoff with unknown teams
    if (!match) {
      const placeholders = candidates.filter((m) => !m.homeCode || !m.awayCode);
      if (placeholders.length === 1) {
        match = placeholders[0];
        const homeCode = sides.home.team?.abbreviation?.toUpperCase();
        const awayCode = sides.away.team?.abbreviation?.toUpperCase();
        if (homeCode && awayCode) {
          actions.push({ kind: 'teams', matchId: match.id, homeCode, awayCode });
        }
      } else if (placeholders.length > 1) {
        // same-instant knockout games: disambiguate by venue name
        const venue = comp.venue?.fullName ? plainName(comp.venue.fullName) : null;
        const byVenue = venue
          ? placeholders.filter((m) => m.homeName === null && venue.length > 0)
          : [];
        if (byVenue.length !== 1) {
          notes.push(
            `ambiguous: ${event.name ?? when} matches ${placeholders.length} fixtures at ${when} — fill teams in Admin`,
          );
          continue;
        }
        match = byVenue[0];
      }
    }

    if (!match) {
      notes.push(`no fixture for event "${event.name ?? when}" at ${when}`);
      continue;
    }
    if (match.resultSource === 'manual') continue; // admin owns this match — hands off

    const state = comp.status?.type?.state;
    const completed = comp.status?.type?.completed === true;

    // Betting-odds snapshot (display-only cheat sheet) — for any match that
    // hasn't banked a final result. Absent/incomplete markets parse to null.
    if (!completed && match.status !== 'finished') {
      const odds = parseScoreboardOdds(comp.odds, nowMs);
      if (odds) actions.push({ kind: 'odds', matchId: match.id, odds });
    }
    const homeScore = parseScore(sides.home.score);
    const awayScore = parseScore(sides.away.score);
    if (homeScore === null || awayScore === null) {
      if (completed) notes.push(`match ${match.id}: completed but scores unreadable — enter manually`);
      continue;
    }

    if (completed) {
      // already recorded identically → idempotent no-op
      if (
        match.status === 'finished' &&
        match.homeScore === homeScore &&
        match.awayScore === awayScore &&
        match.resultSource === 'auto'
      ) {
        continue;
      }
      if (homeScore + awayScore === 0) {
        actions.push({
          kind: 'result',
          matchId: match.id,
          homeScore: 0,
          awayScore: 0,
          firstScorer: null,
          firstScoringTeam: 'none',
        });
        continue;
      }
      const goal = firstGoal(comp.details);
      const homeId = sides.home.team?.id;
      const awayId = sides.away.team?.id;
      const firstScoringTeam =
        goal?.teamId && homeId && goal.teamId === homeId
          ? 'home'
          : goal?.teamId && awayId && goal.teamId === awayId
            ? 'away'
            : null;
      if (!goal || firstScoringTeam === null) {
        notes.push(
          `match ${match.id}: final ${homeScore}-${awayScore} but goal details unusable — enter result manually`,
        );
        continue;
      }
      actions.push({
        kind: 'result',
        matchId: match.id,
        homeScore,
        awayScore,
        firstScorer: goal.scorer,
        firstScoringTeam,
      });
    } else if (state === 'in') {
      // Same first-goal extraction as at full time, applied mid-match — it
      // feeds the display-only "if it ended now" board, never real points.
      const goal = firstGoal(comp.details);
      const homeId = sides.home.team?.id;
      const awayId = sides.away.team?.id;
      const firstScoringTeam =
        goal?.teamId && homeId && goal.teamId === homeId
          ? ('home' as const)
          : goal?.teamId && awayId && goal.teamId === awayId
            ? ('away' as const)
            : null;
      actions.push({
        kind: 'live',
        matchId: match.id,
        liveHome: homeScore,
        liveAway: awayScore,
        firstScorer: goal?.scorer ?? null,
        firstScoringTeam,
      });
    }
  }

  return { actions, notes };
}
