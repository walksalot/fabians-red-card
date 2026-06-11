import { z } from 'zod';
import { getDb } from '@/db';
import { requireUser } from '@/lib/session';
import { clearBooster } from '@/lib/services/boosters';
import { handle, jsonOk, readJson } from '@/lib/api-helpers';

const bodySchema = z.object({
  entryId: z.number().int().positive(),
  matchday: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'matchday must be YYYY-MM-DD'),
});

/** Toggle-off for the daily booster (allowed until its match kicks off). */
export const POST = handle(async (req) => {
  const db = getDb();
  const user = await requireUser(db);
  const body = bodySchema.parse(await readJson(req));
  await clearBooster(db, user.id, body);
  return jsonOk({ cleared: true });
});
