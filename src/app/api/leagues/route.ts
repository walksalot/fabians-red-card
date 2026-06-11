import { z } from 'zod';
import { getDb } from '@/db';
import { requireUser } from '@/lib/session';
import { createLeague } from '@/lib/services/leagues';
import { handle, jsonOk, readJson, sanitizeLeague } from '@/lib/api-helpers';

const bodySchema = z.object({
  name: z.string().trim().min(1).max(60),
  buyInCents: z.number().int().min(0).max(10_000_000).optional(),
  joinPassword: z.string().min(1).max(200).optional(),
});

export const POST = handle(async (req) => {
  const db = getDb();
  const user = await requireUser(db);
  const body = bodySchema.parse(await readJson(req));
  const league = await createLeague(db, user.id, body);
  // Creator is the league admin — invite token included so they can share it.
  return jsonOk({ league: sanitizeLeague(league, true) });
});
