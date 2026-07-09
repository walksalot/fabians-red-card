/**
 * Shared types + tiny client helpers for the admin page module.
 * Plain module (no 'use client'): type-imported by the server page,
 * runtime-imported by the client components below.
 */

export const STAGES = ['group', 'r32', 'r16', 'qf', 'sf', 'third', 'final'] as const;
export type StageKey = (typeof STAGES)[number];

export const STAGE_LABELS: Record<StageKey, string> = {
  group: 'Group',
  r32: 'Round of 32',
  r16: 'Round of 16',
  qf: 'Quarter-final',
  sf: 'Semi-final',
  third: 'Third place',
  final: 'Final',
};

export interface AdminTeam {
  id: number;
  code: string;
  name: string;
}

export interface AdminMember {
  userId: number;
  username: string;
  displayName: string;
  role: string;
  entryCount: number;
}

export interface AdminMatch {
  id: number;
  stage: StageKey;
  matchday: string; // YYYY-MM-DD (America/New_York)
  kickoffUtc: string; // UTC ISO
  venue: string;
  city: string;
  status: 'scheduled' | 'finished';
  homeTeamId: number | null;
  awayTeamId: number | null;
  homeName: string; // team name or knockout placeholder label
  awayName: string;
  /** FIFA 3-letter codes (null for TBD/placeholder teams) — drive flag + code labels. */
  homeCode: string | null;
  awayCode: string | null;
  homeScore: number | null;
  awayScore: number | null;
  /** Shootout tallies of a level knockout final (never affect scoring). */
  homePens: number | null;
  awayPens: number | null;
  firstScorer: string | null;
  firstScoringTeam: 'home' | 'away' | 'none' | null;
  underdogTeamId: number | null;
}

export interface ScoringRulesShape {
  exact: number;
  outcome: number;
  scorer: number;
  firstTeam: number;
  underdog: number;
}

export interface LeagueSettings {
  name: string;
  isPrivate: boolean;
  hasJoinPassword: boolean; // never ship the hash to the client
  entriesPerUser: number;
  buyInCents: number;
  currency: string;
  payoutSplit: number[];
  scoringRules: ScoringRulesShape;
  boosterMultiplier: number;
  roundMultipliers: Record<StageKey, number>;
  autoSyncEnabled: boolean;
  autoUnderdogEnabled: boolean;
}

export type ApiResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

/** Fetch wrapper for the app's `{ ok, data | error }` envelope. Never throws. */
export async function apiSend<T = unknown>(
  url: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json: unknown = await res.json().catch(() => null);
    if (json !== null && typeof json === 'object' && 'ok' in json) {
      return json as ApiResult<T>;
    }
    return { ok: false, error: `Request failed (${res.status})` };
  } catch {
    return { ok: false, error: 'Network error — try again' };
  }
}

/** Group kickoff-ordered matches into consecutive matchday buckets. */
export function groupByMatchday(
  matches: AdminMatch[],
): Array<{ matchday: string; matches: AdminMatch[] }> {
  const days: Array<{ matchday: string; matches: AdminMatch[] }> = [];
  for (const m of matches) {
    const last = days[days.length - 1];
    if (last && last.matchday === m.matchday) last.matches.push(m);
    else days.push({ matchday: m.matchday, matches: [m] });
  }
  return days;
}

/** "Thu, Jun 11" from a YYYY-MM-DD matchday. Fixed locale/zone: SSR-safe. */
export function formatMatchday(matchday: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${matchday}T12:00:00Z`));
}

/** YYYY-MM-DD matchday (America/New_York) for a timestamp — for "today" checks. */
export function matchdayOf(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'America/New_York',
  }).format(new Date(ms));
}

/** Kickoff time in America/New_York (matchdays are NY dates). Fixed locale: SSR-safe. */
export function formatKickoffEt(kickoffUtc: string): string {
  const t = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  }).format(new Date(kickoffUtc));
  return `${t} ET`;
}
