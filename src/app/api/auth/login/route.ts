import { z } from 'zod';
import { getDb } from '@/db';
import { createSession } from '@/lib/session';
import { verifyLogin } from '@/lib/services/leagues';
import { assertRateLimit, clearRateLimit, clientIp } from '@/lib/rate-limit';
import { handle, jsonOk, readJson } from '@/lib/api-helpers';

const bodySchema = z.object({
  username: z.string().trim().min(1).max(40),
  password: z.string().min(1).max(200),
});

// 10 attempts per (ip, username) per 15 minutes — kills password brute force
// without one friend's typos locking anyone else out.
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 15 * 60_000;

export const POST = handle(async (req) => {
  const body = bodySchema.parse(await readJson(req));
  const db = getDb();
  const key = `login:${clientIp(req)}:${body.username.trim().toLowerCase()}`;
  assertRateLimit(key, LOGIN_LIMIT, LOGIN_WINDOW_MS); // throws 429
  const user = await verifyLogin(db, body); // throws 401 on bad credentials
  clearRateLimit(key);
  await createSession(user.id);
  return jsonOk({ user });
});
