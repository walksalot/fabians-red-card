import { z } from 'zod';
import { getDb } from '@/db';
import { requireUser } from '@/lib/session';
import { AppError } from '@/lib/errors';
import { getLeagueBySlug } from '@/lib/services/leagues';
import { createResetToken } from '@/lib/reset';
import { handle, jsonOk, requireLeagueAdmin, requireMember } from '@/lib/api-helpers';

type RouteCtx = { params: Promise<{ slug: string; userId: string }> };

/**
 * Admin-issued one-time password reset link for a member (24h, single use).
 * The admin hands the link over in chat — the league's identity model.
 */
export const POST = handle<RouteCtx>(async (_req, { params }) => {
  const { slug, userId } = await params;
  const targetId = z.coerce.number().int().positive().parse(userId);
  const db = getDb();
  const caller = await requireUser(db);
  const league = await getLeagueBySlug(db, slug);
  if (!league) throw new AppError('League not found', 404);
  requireLeagueAdmin(db, league.id, caller.id);
  requireMember(db, league.id, targetId); // only members of this league
  const token = await createResetToken(db, targetId);
  return jsonOk({ path: `/reset/${token}` });
});
