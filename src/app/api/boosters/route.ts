import { z } from 'zod';
import { getDb } from '@/db';
import { requireUser } from '@/lib/session';
import { setBooster } from '@/lib/services/boosters';
import { handle, jsonOk, readJson } from '@/lib/api-helpers';

const bodySchema = z.object({
  entryId: z.number().int().positive(),
  matchday: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'matchday must be YYYY-MM-DD'),
  matchId: z.number().int().min(1).max(104),
});

export const POST = handle(async (req) => {
  const db = getDb();
  const user = await requireUser(db);
  const body = bodySchema.parse(await readJson(req));
  // service validates ownership, matchday/match pairing and kickoff windows
  const booster = await setBooster(db, user.id, body);
  return jsonOk({ booster: booster ?? null });
});
