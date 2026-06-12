import { and, eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import { nowMs } from '@/lib/clock';
import { AppError } from '@/lib/errors';

export type Booster = typeof schema.boosters.$inferSelect;

export interface SetBoosterInput {
  entryId: number;
  matchday: string; // YYYY-MM-DD (America/New_York calendar date, precomputed)
  matchId: number;
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

/**
 * Choose (or move) the entry's daily booster: exactly one boosted match per
 * matchday. The target match must be on that matchday, unkicked AND without a
 * result (mirrors the pick lock: a match with a known result is never a valid
 * target for a "prediction" amplifier). An existing booster can be replaced
 * only while its current match is also unkicked and resultless — once either
 * happens, the booster is locked for the day.
 */
export async function setBooster(
  db: Db,
  userId: number,
  input: SetBoosterInput,
): Promise<Booster> {
  requireOwnedEntry(db, userId, input.entryId);
  const match = getMatchOr404(db, input.matchId);
  if (match.matchday !== input.matchday) {
    throw new AppError('Match is not on the requested matchday', 400);
  }
  // Same lock rule as picks (picks.ts): kicked off OR finished = locked. The
  // finished check closes the "park ×2 on a known result" hole when an admin
  // enters a result ahead of kickoff — so the message says "locked", not
  // "kicked off" (a finished-early match never kicked off).
  if (match.status === 'finished' || hasKickedOff(match.kickoffUtc)) {
    throw new AppError('Booster is locked for this match', 409);
  }
  // Mirrors the upsertPick guard: the daily booster must not be spendable on
  // a knockout slot whose teams are still unknown ("Bracket pending").
  if (match.homeTeamId === null || match.awayTeamId === null) {
    throw new AppError('Teams for this match are not set yet', 409);
  }

  const existing = db
    .select()
    .from(schema.boosters)
    .where(
      and(
        eq(schema.boosters.entryId, input.entryId),
        eq(schema.boosters.matchday, input.matchday),
      ),
    )
    .get();

  if (existing && existing.matchId !== input.matchId) {
    const previous = db
      .select()
      .from(schema.matches)
      .where(eq(schema.matches.id, existing.matchId))
      .get();
    if (
      previous &&
      (previous.status === 'finished' || hasKickedOff(previous.kickoffUtc))
    ) {
      throw new AppError('Booster already locked for this matchday', 409);
    }
  }

  // No recompute path needed here anymore: boosters can no longer be placed on
  // or moved off matches that have results, so stored points never go stale.
  const ts = nowMs();
  return existing
    ? db
        .update(schema.boosters)
        .set({ matchId: input.matchId, updatedAt: ts }) // createdAt preserved
        .where(eq(schema.boosters.id, existing.id))
        .returning()
        .get()
    : db
        .insert(schema.boosters)
        .values({
          entryId: input.entryId,
          matchday: input.matchday,
          matchId: input.matchId,
          createdAt: ts,
          updatedAt: ts,
        })
        .returning()
        .get();
}

/** The entry's booster for a matchday, or null when none is set. */
export async function getBooster(
  db: Db,
  entryId: number,
  matchday: string,
): Promise<Booster | null> {
  const row = db
    .select()
    .from(schema.boosters)
    .where(
      and(
        eq(schema.boosters.entryId, entryId),
        eq(schema.boosters.matchday, matchday),
      ),
    )
    .get();
  return row ?? null;
}

export interface ClearBoosterInput {
  entryId: number;
  matchday: string;
}

/**
 * Remove the entry's booster for a matchday — the toggle-off. Allowed in the
 * same window in which the booster could be moved: until its current match
 * kicks off or has a result (whichever comes first).
 */
export async function clearBooster(
  db: Db,
  userId: number,
  input: ClearBoosterInput,
): Promise<void> {
  requireOwnedEntry(db, userId, input.entryId);
  const existing = db
    .select()
    .from(schema.boosters)
    .where(
      and(
        eq(schema.boosters.entryId, input.entryId),
        eq(schema.boosters.matchday, input.matchday),
      ),
    )
    .get();
  if (!existing) throw new AppError('No booster set for this matchday', 404);

  const match = getMatchOr404(db, existing.matchId);
  if (match.status === 'finished' || hasKickedOff(match.kickoffUtc)) {
    throw new AppError('Booster already locked for this matchday', 409);
  }

  db.delete(schema.boosters).where(eq(schema.boosters.id, existing.id)).run();
}
