import { z } from 'zod';
import { getDb } from '@/db';
import { requireUser } from '@/lib/session';
import { setMatchTeams } from '@/lib/services/results';
import { handle, jsonOk, readJson, requireAnyLeagueAdmin } from '@/lib/api-helpers';

const bodySchema = z.object({
  matchId: z.number().int().min(1).max(104),
  homeTeamId: z.number().int().positive(),
  awayTeamId: z.number().int().positive(),
});

export const POST = handle(async (req) => {
  const db = getDb();
  const user = await requireUser(db);
  requireAnyLeagueAdmin(db, user.id); // service enforces too
  const body = bodySchema.parse(await readJson(req));
  const match = await setMatchTeams(db, user.id, body);
  return jsonOk({ match: match ?? null });
});
