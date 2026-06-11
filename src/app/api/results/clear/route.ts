import { z } from 'zod';
import { getDb } from '@/db';
import { requireUser } from '@/lib/session';
import { clearResult } from '@/lib/services/results';
import { handle, jsonOk, readJson, requireResultsAdmin } from '@/lib/api-helpers';

const bodySchema = z.object({
  matchId: z.number().int().min(1).max(104),
});

/** Undo a mistakenly entered result: match back to 'scheduled', points removed. */
export const POST = handle(async (req) => {
  const db = getDb();
  const user = await requireUser(db);
  requireResultsAdmin(db, user.id); // service enforces too
  const body = bodySchema.parse(await readJson(req));
  const match = await clearResult(db, user.id, body.matchId);
  return jsonOk({ match: match ?? null });
});
