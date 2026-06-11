import { z } from 'zod';
import { getDb } from '@/db';
import { requireUser } from '@/lib/session';
import { AppError } from '@/lib/errors';
import { getLeagueBySlug } from '@/lib/services/leagues';
import { getTodayBoard } from '@/lib/services/today';
import { handle, jsonOk, requireOwnedEntry } from '@/lib/api-helpers';

const querySchema = z.object({
  entryId: z.coerce.number().int().positive(),
});

type RouteCtx = { params: Promise<{ slug: string }> };

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
  const board = await getTodayBoard(db, league.id, entryId);
  return jsonOk(board);
});
