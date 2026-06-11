import { z } from 'zod';
import { getDb } from '@/db';
import { requireUser } from '@/lib/session';
import { upsertPick } from '@/lib/services/picks';
import { handle, jsonOk, readJson } from '@/lib/api-helpers';

const bodySchema = z.object({
  entryId: z.number().int().positive(),
  matchId: z.number().int().min(1).max(104),
  predHome: z.number().int().min(0).max(20),
  predAway: z.number().int().min(0).max(20),
  predScorer: z
    .string()
    .trim()
    .max(120)
    .nullable()
    .default(null)
    .transform((value) => (value === '' ? null : value)),
  predFirstTeam: z.enum(['home', 'away', 'none']).nullable().default(null),
});

export const POST = handle(async (req) => {
  const db = getDb();
  const user = await requireUser(db);
  const body = bodySchema.parse(await readJson(req));
  // throws 403 if entry not owned, 409 when locked (kickoff reached)
  const pick = await upsertPick(db, user.id, body);
  return jsonOk({ pick: pick ?? null });
});
