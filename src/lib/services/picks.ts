import fs from 'node:fs';
import path from 'node:path';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import { nowMs } from '@/lib/clock';
import { AppError } from '@/lib/errors';
import { canonicalScorer, normalizeName } from '@/lib/scoring';

export type Pick = typeof schema.picks.$inferSelect;

const FIRST_TEAM_VALUES = ['home', 'away', 'none'] as const;
export type FirstTeam = (typeof FIRST_TEAM_VALUES)[number];

const MAX_GOALS = 20;
const MAX_SCORER_LENGTH = 80;

export interface UpsertPickInput {
  entryId: number;
  matchId: number;
  predHome: number;
  predAway: number;
  predScorer?: string | null;
  predFirstTeam?: FirstTeam | null;
}

export interface PublicMatchPick {
  entryId: number;
  label: string;
  pick: Pick;
}

function requireOwnedEntry(db: Db, userId: number, entryId: number) {
  const entry = db
    .select()
    .from(schema.entries)
    .where(eq(schema.entries.id, entryId))
    .get();
  // Missing entry gets the same 403 as a foreign one — don't leak which entries exist.
  if (!entry || entry.userId !== userId) {
    throw new AppError('Entry does not belong to you', 403);
  }
  return entry;
}

function getMatchOr404(db: Db, matchId: number) {
  const match = db
    .select()
    .from(schema.matches)
    .where(eq(schema.matches.id, matchId))
    .get();
  if (!match) throw new AppError('Match not found', 404);
  return match;
}

/** Locked from the kickoff instant onward (clock.now() >= kickoff). */
function hasKickedOff(kickoffUtc: string): boolean {
  return nowMs() >= Date.parse(kickoffUtc);
}

function validateScore(value: number, field: 'predHome' | 'predAway'): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_GOALS) {
    throw new AppError(
      `${field} must be a whole number between 0 and ${MAX_GOALS}`,
      400,
    );
  }
}

function normalizeScorer(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (trimmed.length > MAX_SCORER_LENGTH) {
    throw new AppError(
      `predScorer must be at most ${MAX_SCORER_LENGTH} characters`,
      400,
    );
  }
  return trimmed;
}

/** Bundled squad lists — fallback when the players table has no rows for a team. */
let rostersFile: Record<string, { name: string }[]> | null = null;
function rostersFromFile(code: string): string[] {
  if (rostersFile === null) {
    try {
      rostersFile = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), 'data', 'rosters.json'), 'utf8'),
      );
    } catch {
      rostersFile = {};
    }
  }
  return (rostersFile?.[code] ?? []).map((p) => p.name);
}

/** Normalized names of a team's squad: players table first, data file fallback. */
function squadNameKeys(db: Db, teamId: number): Set<string> {
  const rows = db
    .select({ name: schema.players.name })
    .from(schema.players)
    .where(eq(schema.players.teamId, teamId))
    .all();
  let names = rows.map((r) => r.name);
  if (names.length === 0) {
    const team = db
      .select({ code: schema.teams.code })
      .from(schema.teams)
      .where(eq(schema.teams.id, teamId))
      .get();
    if (team) names = rostersFromFile(team.code);
  }
  return new Set(names.map(normalizeName));
}

/**
 * League rule (announced 2026-06-12): a scorer pick must be a real player from
 * one of the match's two squads — full name, matched accent/case-insensitively.
 * Closes the bare-surname loophole ("martinez" covering three Martínezes).
 * Skipped while either team is unknown (knockout placeholders): there is no
 * squad to validate against yet.
 */
function requireScorerOnSquads(
  db: Db,
  match: { homeTeamId: number | null; awayTeamId: number | null },
  predScorer: string,
): void {
  if (match.homeTeamId === null || match.awayTeamId === null) return;
  const key = normalizeName(predScorer);
  const home = squadNameKeys(db, match.homeTeamId);
  const away = squadNameKeys(db, match.awayTeamId);
  // Fail-open when no squad data exists at all — missing squad data must
  // never lock players out of a pick component.
  if (home.size === 0 && away.size === 0) return;
  if (home.has(key) || away.has(key)) return;
  throw new AppError(
    'Scorer must be a player from one of the two squads — pick a name from the list',
    400,
  );
}

/**
 * Create or update the pick of one of the user's entries for a match.
 * Locked from kickoff (409). A 0-0 prediction coerces scorer to null and
 * first team to 'none' (nobody scores in a goalless game).
 */
export async function upsertPick(
  db: Db,
  userId: number,
  input: UpsertPickInput,
): Promise<Pick> {
  validateScore(input.predHome, 'predHome');
  validateScore(input.predAway, 'predAway');
  const rawFirstTeam = input.predFirstTeam ?? null;
  if (rawFirstTeam !== null && !FIRST_TEAM_VALUES.includes(rawFirstTeam)) {
    throw new AppError("predFirstTeam must be 'home', 'away' or 'none'", 400);
  }

  requireOwnedEntry(db, userId, input.entryId);
  const match = getMatchOr404(db, input.matchId);
  // Locked at kickoff — and also once a result exists. The admin may enter a
  // result ahead of kickoff; from that moment the result is public, so an
  // unkicked-but-finished match must never accept a "prediction".
  if (match.status === 'finished' || hasKickedOff(match.kickoffUtc)) {
    throw new AppError('Picks are locked for this match', 409);
  }
  if (match.homeTeamId === null || match.awayTeamId === null) {
    throw new AppError('Teams for this match are not set yet', 409);
  }

  let predScorer = normalizeScorer(input.predScorer);
  // Store the canonical squad spelling when the typed name unambiguously
  // matches one player ("Raul Jimenez" → "Raúl Jiménez") — every later
  // display (reveals, history, live board) then shows the same spelling the
  // squad list and results use. Ambiguous or unknown names stay as typed so
  // the forgiving suffix matching at scoring time keeps its semantics.
  if (predScorer !== null) {
    const squad = db
      .select({ name: schema.players.name })
      .from(schema.players)
      .where(
        inArray(schema.players.teamId, [match.homeTeamId, match.awayTeamId]),
      )
      .all();
    predScorer = canonicalScorer(
      predScorer,
      squad.map((p) => p.name),
    );
  }
  let predFirstTeam: FirstTeam | null = rawFirstTeam;
  if (input.predHome === 0 && input.predAway === 0) {
    predScorer = null;
    predFirstTeam = 'none';
  }

  // Identical re-save: change nothing — especially not updatedAt. (Re-saving
  // an unchanged pick used to silently refresh the timestamp.)
  const existing = db
    .select()
    .from(schema.picks)
    .where(
      and(
        eq(schema.picks.entryId, input.entryId),
        eq(schema.picks.matchId, input.matchId),
      ),
    )
    .get();
  if (
    existing &&
    existing.predHome === input.predHome &&
    existing.predAway === input.predAway &&
    existing.predScorer === predScorer &&
    existing.predFirstTeam === predFirstTeam
  ) {
    return existing;
  }

  if (predScorer !== null) requireScorerOnSquads(db, match, predScorer);

  const ts = nowMs();
  return db
    .insert(schema.picks)
    .values({
      entryId: input.entryId,
      matchId: input.matchId,
      predHome: input.predHome,
      predAway: input.predAway,
      predScorer,
      predFirstTeam,
      createdAt: ts,
      updatedAt: ts,
    })
    .onConflictDoUpdate({
      target: [schema.picks.entryId, schema.picks.matchId],
      set: {
        predHome: input.predHome,
        predAway: input.predAway,
        predScorer,
        predFirstTeam,
        updatedAt: ts, // createdAt deliberately preserved
      },
    })
    .returning()
    .get();
}

/** All picks for one entry, in match order. */
export async function getEntryPicks(db: Db, entryId: number): Promise<Pick[]> {
  return db
    .select()
    .from(schema.picks)
    .where(eq(schema.picks.entryId, entryId))
    .orderBy(asc(schema.picks.matchId))
    .all();
}

/**
 * Everyone's picks for a match within a league, labelled by entry.
 * Hidden until the match kicks off so nobody can copy picks (403 before).
 */
export async function getMatchPicksPublic(
  db: Db,
  leagueId: number,
  matchId: number,
): Promise<PublicMatchPick[]> {
  const match = getMatchOr404(db, matchId);
  if (!hasKickedOff(match.kickoffUtc)) {
    throw new AppError('Picks are hidden until kickoff', 403);
  }
  return db
    .select({
      entryId: schema.entries.id,
      label: schema.entries.label,
      pick: schema.picks,
    })
    .from(schema.picks)
    .innerJoin(schema.entries, eq(schema.picks.entryId, schema.entries.id))
    .where(
      and(eq(schema.entries.leagueId, leagueId), eq(schema.picks.matchId, matchId)),
    )
    .orderBy(asc(schema.entries.id))
    .all();
}
