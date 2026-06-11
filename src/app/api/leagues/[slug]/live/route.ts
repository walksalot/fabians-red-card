import { getDb } from '@/db';
import { requireUser } from '@/lib/session';
import { AppError } from '@/lib/errors';
import { getLeagueBySlug } from '@/lib/services/leagues';
import { getLiveBoards } from '@/lib/services/live';
import { handle, jsonOk, requireMember } from '@/lib/api-helpers';

type RouteCtx = { params: Promise<{ slug: string }> };

/**
 * "If it ended now" boards for every in-progress match. Member-only; every
 * pick it exposes belongs to a match that has already kicked off (public per
 * the reveal-at-kickoff rule).
 */
export const GET = handle<RouteCtx>(async (_req, { params }) => {
  const { slug } = await params;
  const db = getDb();
  const user = await requireUser(db);
  const league = await getLeagueBySlug(db, slug);
  if (!league) throw new AppError('League not found', 404);
  requireMember(db, league.id, user.id);
  return jsonOk({ boards: getLiveBoards(db, league.id) });
});
