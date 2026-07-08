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
  /** Penalty-shootout tally — present only when the game went (or is going) to penalties. */
  shootoutScore?: string | number;
  team?: EspnTeamRef;
}

export interface EspnDetail {
  scoringPlay?: boolean;
  ownGoal?: boolean;
  redCard?: boolean;
  /** In-game spot kick (a real goal) — distinct from a shootout kick. */
  penaltyKick?: boolean;
  /** Post-extra-time shootout kick: scoringPlay in the feed, never a goal here. */
  shootout?: boolean;
  clock?: { value?: number };
  team?: { id?: string };
  athletesInvolved?: Array<{ displayName?: string }>;
}

export interface EspnCompetition {
  status?: {
    displayClock?: string;
    type?: { completed?: boolean; state?: string; shortDetail?: string };
  };
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
  /** Stored shootout tallies — lets the planner backfill a tie recorded before pens support. */
  homePens: number | null;
  awayPens: number | null;
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
      /** Match clock as the feed shows it ("55'", "HT", "90'+3'"); null when absent. */
      clock: string | null;
      /** Running shootout tallies while penalties are being taken; null otherwise. */
      liveHomePens: number | null;
      liveAwayPens: number | null;
    }
  | {
      kind: 'result';
      matchId: number;
      homeScore: number;
      awayScore: number;
      firstScorer: string | null;
      firstScoringTeam: 'home' | 'away' | 'none';
      /** Shootout tallies for a level knockout final; null when no shootout. */
      homePens: number | null;
      awayPens: number | null;
    };

export interface SyncPlan {
  actions: SyncAction[];
  notes: string[];
}

/**
 * How far the feed's kickoff may drift from the fixture's scheduled one and
 * still identify the same game (by teams). Delayed starts move ESPN's
 * `event.date` to the ACTUAL kickoff while our fixture keeps the scheduled
 * time — without a tolerance a delayed game silently drops out of the sync
 * (no live scores, no final result, no points), which is exactly what
 * happened to the 2026-06-30 Mexico–Ecuador R32 game (scheduled 01:00Z,
 * started 02:00Z). 12h covers any same-night delay yet stays far below the
 * multi-day gap between two real meetings of the same team pair, so a
 * team-pair match inside the window can never confuse two fixtures.
 */
export const KICKOFF_DRIFT_MAX_MS = 12 * 3600_000;

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

/**
 * Match clock from the feed's status, for the live display. shortDetail is the
 * human form ("55'", "HT", "45'+2'"); displayClock is the raw fallback. Both
 * are untrusted feed text, so anything not clock-shaped is dropped.
 */
function parseLiveClock(status: EspnCompetition['status']): string | null {
  const raw = (status?.type?.shortDetail ?? status?.displayClock ?? '').trim();
  return /^[0-9A-Za-z'’+ ]{1,12}$/.test(raw) ? raw : null;
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
  // Shootout kicks arrive as scoringPlay:true (clock parked at 120') but are
  // NOT goals: they decide who advances, never the scoreline, the first
  // scorer, or the first team to score. Without this filter a 0-0 tie that
  // went to penalties credited "first goal" to the first shootout kicker.
  const plays = (details ?? [])
    .filter((d) => d.scoringPlay === true && d.shootout !== true)
    .sort((a, b) => (a.clock?.value ?? 0) - (b.clock?.value ?? 0));
  if (plays.length === 0) return null;
  const first = plays[0];
  const firstNonOwn = plays.find((d) => d.ownGoal !== true);
  return {
    scorer: firstNonOwn?.athletesInvolved?.[0]?.displayName ?? null,
    teamId: first.team?.id ?? null,
  };
}

/**
 * Shootout tallies from the competitors, for a FINAL result. Only a level
 * score can have gone to penalties, and a finished shootout always has a
 * winner — anything else is feed junk and parses to null (no shootout).
 */
function finalShootout(
  sides: Sides,
  homeScore: number,
  awayScore: number,
): { home: number; away: number } | null {
  if (homeScore !== awayScore) return null;
  const home = parseScore(sides.home.shootoutScore);
  const away = parseScore(sides.away.shootoutScore);
  if (home === null || away === null || home === away) return null;
  return { home, away };
}

/** Mid-shootout tallies (may legitimately be level while kicks are being taken). */
function liveShootout(sides: Sides): { home: number; away: number } | null {
  const home = parseScore(sides.home.shootoutScore);
  const away = parseScore(sides.away.shootoutScore);
  return home !== null && away !== null ? { home, away } : null;
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
    // NOTE: candidates may be empty — a delayed game's feed kickoff matches
    // no fixture instant, and rule 1b below is what still identifies it.
    const candidates = byKickoff.get(when) ?? [];

    // 1. exact team match (orientation-aware)
    let match = candidates.find(
      (m) =>
        m.homeCode &&
        m.awayCode &&
        refersTo(sides.home, m.homeCode, m.homeName) &&
        refersTo(sides.away, m.awayCode, m.awayName),
    );

    // 1b. delayed kickoff: no fixture at the feed's instant, so look for THE
    // fixture with these two teams (same orientation) within the drift
    // tolerance. Runs BEFORE the placeholder fill so a delayed known-teams
    // game landing on some TBD slot's kickoff instant can never be mistaken
    // for that slot. A unique hit is a positive identification; anything
    // ambiguous is left for the admin, never guessed.
    if (!match) {
      const whenMs = Date.parse(when);
      const drifted = matches.filter(
        (m) =>
          m.homeCode &&
          m.awayCode &&
          Math.abs(Date.parse(m.kickoffUtc) - whenMs) <= KICKOFF_DRIFT_MAX_MS &&
          refersTo(sides.home, m.homeCode, m.homeName) &&
          refersTo(sides.away, m.awayCode, m.awayName),
      );
      if (drifted.length === 1) {
        match = drifted[0];
        notes.push(
          `match ${match.id}: kickoff drift — fixture ${match.kickoffUtc}, feed ${when} (delayed start?)`,
        );
      } else if (drifted.length > 1) {
        notes.push(
          `ambiguous: event "${event.name ?? when}" team-matches ${drifted.length} fixtures near ${when} — enter result in Admin`,
        );
        continue;
      }
    }

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
      // an event with fixtures at its instant that matched none of them is
      // worth a note; an event matching nothing at all is simply not ours
      if (candidates.length > 0) {
        notes.push(`no fixture for event "${event.name ?? when}" at ${when}`);
      }
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
      const pens = finalShootout(sides, homeScore, awayScore);
      // already recorded identically → idempotent no-op. Pens are part of the
      // identity: a tie banked before pens support (stored NULLs) re-writes
      // once so the shootout tallies backfill.
      if (
        match.status === 'finished' &&
        match.homeScore === homeScore &&
        match.awayScore === awayScore &&
        match.homePens === (pens?.home ?? null) &&
        match.awayPens === (pens?.away ?? null) &&
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
          homePens: pens?.home ?? null,
          awayPens: pens?.away ?? null,
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
        homePens: pens?.home ?? null,
        awayPens: pens?.away ?? null,
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
      const pens = liveShootout(sides);
      actions.push({
        kind: 'live',
        matchId: match.id,
        liveHome: homeScore,
        liveAway: awayScore,
        firstScorer: goal?.scorer ?? null,
        firstScoringTeam,
        clock: parseLiveClock(comp.status),
        liveHomePens: pens?.home ?? null,
        liveAwayPens: pens?.away ?? null,
      });
    }
  }

  return { actions, notes };
}
