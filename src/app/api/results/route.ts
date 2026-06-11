import { z } from 'zod';
import { getDb } from '@/db';
import { requireUser } from '@/lib/session';
import { enterResult } from '@/lib/services/results';
import { handle, jsonOk, readJson, requireAnyLeagueAdmin } from '@/lib/api-helpers';

const bodySchema = z.object({
  matchId: z.number().int().min(1).max(104),
  homeScore: z.number().int().min(0).max(99),
  awayScore: z.number().int().min(0).max(99),
  firstScorer: z
    .string()
    .trim()
    .max(120)
    .nullable()
    .default(null)
    .transform((value) => (value === '' ? null : value)),
  firstScoringTeam: z.enum(['home', 'away', 'none']),
});

export const POST = handle(async (req) => {
  const db = getDb();
  const user = await requireUser(db);
  requireAnyLeagueAdmin(db, user.id); // service enforces too
  const body = bodySchema.parse(await readJson(req));
  const match = await enterResult(db, user.id, body);
  return jsonOk({ match: match ?? null });
});
