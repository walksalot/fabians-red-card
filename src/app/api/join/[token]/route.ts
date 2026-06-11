import { getDb } from '@/db';
import { requireUser } from '@/lib/session';
import { AppError } from '@/lib/errors';
import {
  getLeagueByInviteToken,
  joinByInviteToken,
} from '@/lib/services/leagues';
import {
  handle,
  isLeagueAdmin,
  jsonOk,
  memberCountOf,
  sanitizeLeague,
} from '@/lib/api-helpers';

type RouteCtx = { params: Promise<{ token: string }> };

/**
 * Public (no auth): invite-landing info for /join/[token] — league name and
 * player count only, so the page can render before register/login.
 */
export const GET = handle<RouteCtx>(async (_req, { params }) => {
  const { token } = await params;
  const db = getDb();
  const league = await getLeagueByInviteToken(db, token);
  if (!league) throw new AppError('Invite not found', 404);
  return jsonOk({
    league: {
      name: league.name,
      slug: league.slug,
      isPrivate: league.isPrivate,
    },
    memberCount: memberCountOf(db, league.id),
  });
});

/** Authenticated: join the league via invite link (no password needed). */
export const POST = handle<RouteCtx>(async (_req, { params }) => {
  const { token } = await params;
  const db = getDb();
  const user = await requireUser(db);
  const { league, entry } = await joinByInviteToken(db, user.id, token);
  const isAdmin = isLeagueAdmin(db, league.id, user.id);
  return jsonOk({ league: sanitizeLeague(league, isAdmin), entry });
});
