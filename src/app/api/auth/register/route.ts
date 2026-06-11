import { z } from 'zod';
import { getDb } from '@/db';
import { createSession } from '@/lib/session';
import { createUser } from '@/lib/services/leagues';
import { assertRateLimit, clientIp } from '@/lib/rate-limit';
import { handle, jsonOk, readJson } from '@/lib/api-helpers';

const bodySchema = z.object({
  username: z.string().trim().min(1).max(40),
  displayName: z.string().trim().min(1).max(80),
  // minimum length enforced here AND in createUser (boundary + service)
  password: z.string().min(8).max(200),
});

// 20 registrations per ip per hour — plenty for a 15-friend pool, hostile to bots.
const REGISTER_LIMIT = 20;
const REGISTER_WINDOW_MS = 60 * 60_000;

export const POST = handle(async (req) => {
  assertRateLimit(`register:${clientIp(req)}`, REGISTER_LIMIT, REGISTER_WINDOW_MS);
  const body = bodySchema.parse(await readJson(req));
  const db = getDb();
  const user = await createUser(db, body);
  await createSession(user.id);
  return jsonOk({ user });
});
