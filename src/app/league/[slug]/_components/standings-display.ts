/**
 * Pure display helpers for the standings table (LiveTable) — extracted so the
 * shared-rank rules are unit-testable without rendering.
 */

/**
 * Rank that gets the red-card easter egg: the LAST row's rank, but only when a
 * genuine bottom group exists — more than one row AND the last rank is worse
 * than the first. When everyone shares one rank (a full tie) there is no last
 * place, so nobody holds the card.
 */
export function lastPlaceRank(rows: { rank: number }[]): number | null {
  if (rows.length <= 1) return null;
  const last = rows[rows.length - 1].rank;
  return last > rows[0].rank ? last : null;
}
