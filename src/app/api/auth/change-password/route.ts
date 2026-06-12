import { z } from 'zod';
import { getDb } from '@/db';
import { requireUser } from '@/lib/session';
import { changePassword } from '@/lib/services/leagues';
import { handle, jsonOk, readJson } from '@/lib/api-helpers';

const bodySchema = z.object({
  current: z.string().min(1).max(200),
  next: z.string().min(8).max(200),
});

export const POST = handle(async (req) => {
  const db = getDb();
  const user = await requireUser(db);
  const body = bodySchema.parse(await readJson(req));
  await changePassword(db, user.id, body.current, body.next);
  return jsonOk({ changed: true });
});
