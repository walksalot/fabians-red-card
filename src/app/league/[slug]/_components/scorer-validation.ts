import { normalizeName } from '@/lib/scoring';

/**
 * Client mirror of the server's squad rule (picks.ts requireScorerOnSquads):
 * a non-empty scorer pick must normalize-match the FULL name of a player on
 * one of the match's two squads. Accents, capitalization, periods and extra
 * whitespace are forgiven (same normalizeName as the server) — bare last
 * names are not.
 *
 * A squad of `null` means that side's team is unknown (knockout TBD). The
 * client allows and lets the server be authoritative (it rejects picks on
 * TBD matches outright with a 409; the all-squads union rule survives only
 * in the boot scrub for legacy TBD picks). Both squads non-null but EMPTY
 * (no squad data at all) also passes: the server fails open there too.
 */
export function scorerOnSquads(
  scorer: string,
  homeSquad: string[] | null,
  awaySquad: string[] | null,
): boolean {
  if (scorer.trim() === '') return true;
  if (homeSquad === null || awaySquad === null) return true;
  if (homeSquad.length === 0 && awaySquad.length === 0) return true;
  const key = normalizeName(scorer);
  return (
    homeSquad.some((n) => normalizeName(n) === key) ||
    awaySquad.some((n) => normalizeName(n) === key)
  );
}
