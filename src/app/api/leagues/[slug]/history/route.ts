import { z } from 'zod';
import { asc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { requireUser } from '@/lib/session';
import { AppError } from '@/lib/errors';
import { getLeagueBySlug } from '@/lib/services/leagues';
import { handle, jsonOk, requireOwnedEntry } from '@/lib/api-helpers';

const querySchema = z.object({
  entryId: z.coerce.number().int().positive(),
});

type RouteCtx = { params: Promise<{ slug: string }> };

/**
 * Finished matches (kickoff order) with team names, plus this entry's pick
 * and matchPoints breakdown for each — the History screen's data.
 */
export const GET = handle<RouteCtx>(async (req, { params }) => {
  const { slug } = await params;
  const db = getDb();
  const user = await requireUser(db);
  const league = await getLeagueBySlug(db, slug);
  if (!league) throw new AppError('League not found', 404);
  const { entryId } = querySchema.parse({
    entryId: req.nextUrl.searchParams.get('entryId') ?? undefined,
  });
  requireOwnedEntry(db, user.id, league.id, entryId);

  const finished = db
    .select()
    .from(schema.matches)
    .where(eq(schema.matches.status, 'finished'))
    .orderBy(asc(schema.matches.kickoffUtc), asc(schema.matches.id))
    .all();
  const teamById = new Map(
    db.select().from(schema.teams).all().map((t) => [t.id, t]),
  );
  const pickByMatch = new Map(
    db
      .select()
      .from(schema.picks)
      .where(eq(schema.picks.entryId, entryId))
      .all()
      .map((p) => [p.matchId, p]),
  );
  const pointsByMatch = new Map(
    db
      .select()
      .from(schema.matchPoints)
      .where(eq(schema.matchPoints.entryId, entryId))
      .all()
      .map((mp) => [mp.matchId, mp]),
  );

  const matches = finished.map((match) => {
    const points = pointsByMatch.get(match.id);
    return {
      match,
      homeTeamName:
        (match.homeTeamId !== null
          ? teamById.get(match.homeTeamId)?.name
          : undefined) ??
        match.homePlaceholder ??
        'TBD',
      awayTeamName:
        (match.awayTeamId !== null
          ? teamById.get(match.awayTeamId)?.name
          : undefined) ??
        match.awayPlaceholder ??
        'TBD',
      pick: pickByMatch.get(match.id) ?? null,
      points: points
        ? { breakdown: JSON.parse(points.breakdown) as unknown, total: points.total }
        : null,
    };
  });

  return jsonOk({ matches });
});
