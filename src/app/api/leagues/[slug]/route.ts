import { getDb } from '@/db';
import { requireUser } from '@/lib/session';
import { AppError } from '@/lib/errors';
import { getLeagueBySlug } from '@/lib/services/leagues';
import {
  handle,
  isLeagueAdmin,
  jsonOk,
  memberCountOf,
  sanitizeLeague,
} from '@/lib/api-helpers';

type RouteCtx = { params: Promise<{ slug: string }> };

export const GET = handle<RouteCtx>(async (_req, { params }) => {
  const { slug } = await params;
  const db = getDb();
  const user = await requireUser(db);
  const league = await getLeagueBySlug(db, slug);
  if (!league) throw new AppError('League not found', 404);
  const isAdmin = isLeagueAdmin(db, league.id, user.id);
  return jsonOk({
    league: sanitizeLeague(league, isAdmin),
    memberCount: memberCountOf(db, league.id),
  });
});
