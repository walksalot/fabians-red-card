/**
 * GET /api/leagues/[slug]/matches/[matchId]/picks — the "who picked what"
 * reveal. League MEMBERS only, and the picks service itself refuses until
 * kickoff (403 'Picks are hidden until kickoff'), so an open match can never
 * leak a pick. Read-only: picks, booster marks, and banked points.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '@/db';
import { handle, jsonOk, requireMember } from '@/lib/api-helpers';
import { AppError } from '@/lib/errors';
import { requireUser } from '@/lib/session';
import { getLeagueBySlug } from '@/lib/services/leagues';
import { getMatchPicksPublic } from '@/lib/services/picks';
import { squadDisplayNames } from '@/lib/services/squads';
import { canonicalScorer, type PointsBreakdown } from '@/lib/scoring';

type RouteCtx = { params: Promise<{ slug: string; matchId: string }> };

const paramsSchema = z.object({ matchId: z.coerce.number().int().positive() });

export const GET = handle<RouteCtx>(async (_req, { params }) => {
  const { slug, matchId: rawId } = await params;
  const { matchId } = paramsSchema.parse({ matchId: rawId });
  const db = getDb();
  const user = await requireUser(db);
  const league = await getLeagueBySlug(db, slug);
  if (!league) throw new AppError('League not found', 404);
  requireMember(db, league.id, user.id);

  const rows = await getMatchPicksPublic(db, league.id, matchId);
  const match = db
    .select()
    .from(schema.matches)
    .where(eq(schema.matches.id, matchId))
    .get()!;

  const entryIds = rows.map((r) => r.entryId);
  const boosted = new Set(
    entryIds.length > 0
      ? db
          .select()
          .from(schema.boosters)
          .where(
            and(
              eq(schema.boosters.matchday, match.matchday),
              eq(schema.boosters.matchId, matchId),
              inArray(schema.boosters.entryId, entryIds),
            ),
          )
          .all()
          .map((b) => b.entryId)
      : [],
  );
  const pointRows =
    match.status === 'finished' && entryIds.length > 0
      ? db
          .select()
          .from(schema.matchPoints)
          .where(
            and(
              eq(schema.matchPoints.matchId, matchId),
              inArray(schema.matchPoints.entryId, entryIds),
            ),
          )
          .all()
      : [];
  const pointsByEntry = new Map(pointRows.map((p) => [p.entryId, p]));

  // Canonical squad spellings for scorer picks — same rule as every other
  // scorer rendered in the app.
  const squads = [
    ...(match.homeTeamId !== null ? squadDisplayNames(db, match.homeTeamId) : []),
    ...(match.awayTeamId !== null ? squadDisplayNames(db, match.awayTeamId) : []),
  ];

  let exactCount = 0;
  const out = rows.map((r) => {
    const p = pointsByEntry.get(r.entryId);
    let exact = false;
    if (p) {
      try {
        exact = (JSON.parse(p.breakdown) as PointsBreakdown).exact > 0;
      } catch {
        exact = false;
      }
    }
    if (exact) exactCount += 1;
    return {
      entryId: r.entryId,
      label: r.label,
      predHome: r.pick.predHome,
      predAway: r.pick.predAway,
      predScorer: canonicalScorer(r.pick.predScorer, squads),
      predFirstTeam: r.pick.predFirstTeam,
      boosted: boosted.has(r.entryId),
      total: p ? p.total : null,
      exact,
    };
  });

  return jsonOk({
    matchId,
    finished: match.status === 'finished',
    rows: out,
    exactCount,
  });
});
