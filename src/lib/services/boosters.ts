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
 * matchday. The target match must be on that matchday and unkicked. An
 * existing booster can be replaced only while its current match is also
 * unkicked — once that match kicks off, the booster is locked for the day.
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
  if (hasKickedOff(match.kickoffUtc)) {
    throw new AppError('Match has already kicked off', 409);
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

  const changed = !existing || existing.matchId !== input.matchId;
  const finishedMatchIds = new Set<number>();
  if (changed && match.status === 'finished') finishedMatchIds.add(match.id);

  const ts = nowMs();
  let row: Booster;
  if (existing) {
    if (existing.matchId !== input.matchId) {
      const previous = db
        .select()
        .from(schema.matches)
        .where(eq(schema.matches.id, existing.matchId))
        .get();
      if (previous && hasKickedOff(previous.kickoffUtc)) {
        throw new AppError('Booster already locked for this matchday', 409);
      }
      if (previous?.status === 'finished') finishedMatchIds.add(previous.id);
    }
    row = db
      .update(schema.boosters)
      .set({ matchId: input.matchId, updatedAt: ts }) // createdAt preserved
      .where(eq(schema.boosters.id, existing.id))
      .returning()
      .get();
  } else {
    row = db
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

  // Per CONTRACTS.md: if either the old or new match is already finished
  // (admin can enter results ahead of kickoff), points must not go stale.
  // results.ts owns recomputation; imported lazily because it statically
  // depends on this module (boosted-match lookup) — avoids an import cycle.
  if (finishedMatchIds.size > 0) {
    const results = await import('./results');
    for (const id of finishedMatchIds) {
      await results.recomputeMatch(db, id);
    }
  }

  return row;
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
