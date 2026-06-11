import { z } from 'zod';
import { getDb } from '@/db';
import { requireUser } from '@/lib/session';
import { AppError } from '@/lib/errors';
import { getLeagueBySlug, removeMember } from '@/lib/services/leagues';
import { handle, jsonOk, requireLeagueAdmin } from '@/lib/api-helpers';

const paramsSchema = z.object({
  slug: z.string().min(1),
  userId: z.coerce.number().int().positive(),
});

type RouteCtx = { params: Promise<{ slug: string; userId: string }> };

export const DELETE = handle<RouteCtx>(async (_req, { params }) => {
  const { slug, userId: targetUserId } = paramsSchema.parse(await params);
  const db = getDb();
  const user = await requireUser(db);
  const league = await getLeagueBySlug(db, slug);
  if (!league) throw new AppError('League not found', 404);
  requireLeagueAdmin(db, league.id, user.id); // service enforces too
  await removeMember(db, league.id, user.id, targetUserId);
  return jsonOk(null);
});
