import { z } from 'zod';
import { getDb } from '@/db';
import { createSession } from '@/lib/session';
import { createUser } from '@/lib/services/leagues';
import { handle, jsonOk, readJson } from '@/lib/api-helpers';

const bodySchema = z.object({
  username: z.string().trim().min(1).max(40),
  displayName: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(200),
});

export const POST = handle(async (req) => {
  const body = bodySchema.parse(await readJson(req));
  const db = getDb();
  const user = await createUser(db, body);
  await createSession(user.id);
  return jsonOk({ user });
});
