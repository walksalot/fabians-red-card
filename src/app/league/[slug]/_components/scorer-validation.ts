import { normalizeName } from '@/lib/scoring';

/**
 * Client mirror of the server's squad rule (picks.ts requireScorerOnSquads):
 * a non-empty scorer pick must normalize-match the FULL name of a player on
 * one of the match's two squads. Accents, capitalization, periods and extra
 * whitespace are forgiven (same normalizeName as the server) — bare last
 * names are not. When both squad lists are empty (knockout TBD), free text
 * passes: there is no squad to validate against yet, and the server skips
 * validation then too.
 */
export function scorerOnSquads(
  scorer: string,
  homeSquad: string[],
  awaySquad: string[],
): boolean {
  if (scorer.trim() === '') return true;
  if (homeSquad.length === 0 && awaySquad.length === 0) return true;
  const key = normalizeName(scorer);
  return (
    homeSquad.some((n) => normalizeName(n) === key) ||
    awaySquad.some((n) => normalizeName(n) === key)
  );
}
