/**
 * One-shot, idempotent data repairs, run at server boot (instrumentation.ts).
 *
 * "<Name> null": ESPN's roster API returns fullName "Casemiro null" for
 * mononym players (their lastName is the literal string "null"). Those names
 * leaked into the players table and into saved picks via the dropdown — and a
 * pick "Casemiro null" scores ZERO against the result string "Casemiro"
 * (scorerMatches treats the extra token as a mismatch). Strip the artifact
 * everywhere so honest picks of these players count again.
 *
 * HARD RULE for every repair here: nothing may change already-banked
 * match_points, directly or via a later recompute side-effect. Pick repairs
 * therefore only ever touch picks on matches that are still 'scheduled' AND
 * have not kicked off — picks on finished/kicked-off matches stay
 * byte-identical.
 */
import { and, eq, isNotNull, like } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import { nowMs } from '@/lib/clock';
import { normalizeName } from '@/lib/scoring';
import { allSquadNameKeys, squadNameKeys } from '@/lib/services/squads';

const NULL_SUFFIX = /\s+null$/i;

export interface NullSurnameFixResult {
  playersFixed: number;
  picksFixed: number;
}

export function fixNullSurnameArtifacts(db: Db): NullSurnameFixResult {
  let playersFixed = 0;
  let picksFixed = 0;

  // Players repair in its OWN transaction so the two repairs can never roll
  // each other back. A players-side failure is re-thrown only AFTER the picks
  // repair has committed.
  let playersError: unknown;
  try {
    db.transaction(() => {
      const players = db
        .select({
          id: schema.players.id,
          teamId: schema.players.teamId,
          name: schema.players.name,
        })
        .from(schema.players)
        .where(like(schema.players.name, '% null'))
        .all();
      for (const p of players) {
        const fixed = p.name.replace(NULL_SUFFIX, '').trim();
        if (fixed === p.name || fixed.length === 0) continue;
        const clean = db
          .select({ id: schema.players.id })
          .from(schema.players)
          .where(
            and(eq(schema.players.teamId, p.teamId), eq(schema.players.name, fixed)),
          )
          .get();
        if (clean) {
          // The prod seed inserts clean names BEFORE this runs — renaming would
          // collide with the (team_id, name) unique key. The artifact row is a
          // pure duplicate (picks/scorer_odds reference names, not player ids),
          // so delete it.
          db.delete(schema.players).where(eq(schema.players.id, p.id)).run();
        } else {
          db.update(schema.players)
            .set({ name: fixed })
            .where(eq(schema.players.id, p.id))
            .run();
        }
        playersFixed += 1;
      }
    });
  } catch (err) {
    playersError = err;
  }

  // Picks repair: separate transaction, and ONLY picks on matches that are
  // still 'scheduled' and unkicked — a finished/kicked-off match's picks must
  // stay byte-identical so no later recompute can shift banked points.
  const now = nowMs();
  db.transaction(() => {
    const picks = db
      .select({
        id: schema.picks.id,
        predScorer: schema.picks.predScorer,
        status: schema.matches.status,
        kickoffUtc: schema.matches.kickoffUtc,
      })
      .from(schema.picks)
      .innerJoin(schema.matches, eq(schema.picks.matchId, schema.matches.id))
      .where(like(schema.picks.predScorer, '% null'))
      .all();
    for (const pk of picks) {
      if (pk.status !== 'scheduled' || Date.parse(pk.kickoffUtc) <= now) continue;
      const fixed = pk.predScorer!.replace(NULL_SUFFIX, '').trim();
      if (fixed !== pk.predScorer && fixed.length > 0) {
        // deliberately does NOT touch updatedAt: this is a repair, not an edit
        db.update(schema.picks)
          .set({ predScorer: fixed })
          .where(eq(schema.picks.id, pk.id))
          .run();
        picksFixed += 1;
      }
    }
  });

  // Surface the players-side failure (instrumentation logs it) — but only now
  // that the picks heal has committed.
  if (playersError !== undefined) throw playersError;

  return { playersFixed, picksFixed };
}

export interface ScrubInvalidScorersResult {
  scorersCleared: number;
}

/**
 * Boot scrub: NULL every invalid predScorer on a FUTURE match (status
 * 'scheduled' AND kickoff after clock.now()) using the same rules as
 * picks.ts requireScorerOnSquads:
 *   - both teams known → scorer must be on either squad
 *   - both squads empty → skip (fail-open, no data to validate against)
 *   - either team TBD → scorer must be in the all-squads union
 * Only predScorer is touched — predFirstTeam, scoreline and updatedAt stay
 * as the player left them. Idempotent: a NULL scorer is never re-examined.
 */
export function scrubInvalidFutureScorers(db: Db): ScrubInvalidScorersResult {
  const now = nowMs();
  let scorersCleared = 0;
  // Per-team key cache: one squad resolution per team, not per pick.
  const squadCache = new Map<number, Set<string>>();
  const squadOf = (teamId: number): Set<string> => {
    let keys = squadCache.get(teamId);
    if (!keys) {
      keys = squadNameKeys(db, teamId);
      squadCache.set(teamId, keys);
    }
    return keys;
  };
  let allKeys: Set<string> | null = null;

  db.transaction(() => {
    const rows = db
      .select({
        id: schema.picks.id,
        predScorer: schema.picks.predScorer,
        status: schema.matches.status,
        kickoffUtc: schema.matches.kickoffUtc,
        homeTeamId: schema.matches.homeTeamId,
        awayTeamId: schema.matches.awayTeamId,
      })
      .from(schema.picks)
      .innerJoin(schema.matches, eq(schema.picks.matchId, schema.matches.id))
      .where(
        and(eq(schema.matches.status, 'scheduled'), isNotNull(schema.picks.predScorer)),
      )
      .all();
    for (const row of rows) {
      if (Date.parse(row.kickoffUtc) <= now) continue;
      const key = normalizeName(row.predScorer!);
      let valid: boolean;
      if (row.homeTeamId === null || row.awayTeamId === null) {
        allKeys ??= allSquadNameKeys(db);
        valid = allKeys.size === 0 || allKeys.has(key);
      } else {
        const home = squadOf(row.homeTeamId);
        const away = squadOf(row.awayTeamId);
        valid =
          (home.size === 0 && away.size === 0) || home.has(key) || away.has(key);
      }
      if (!valid) {
        // Only the scorer goes — the rest of the pick (and updatedAt) is theirs.
        db.update(schema.picks)
          .set({ predScorer: null })
          .where(eq(schema.picks.id, row.id))
          .run();
        scorersCleared += 1;
      }
    }
  });

  return { scorersCleared };
}
