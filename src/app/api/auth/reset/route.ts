import { z } from 'zod';
import { getDb } from '@/db';
import { verifyResetToken } from '@/lib/reset';
import { setPassword } from '@/lib/services/leagues';
import { createSession } from '@/lib/session';
import { assertRateLimit, clientIp } from '@/lib/rate-limit';
import { handle, jsonOk, readJson } from '@/lib/api-helpers';

const bodySchema = z.object({
  token: z.string().min(10).max(2000),
  password: z.string().min(8).max(200),
});

/** Finish a reset link: set the new password and sign the user in. */
export const POST = handle(async (req) => {
  assertRateLimit(`reset:${clientIp(req)}`, 10, 15 * 60_000);
  const db = getDb();
  const body = bodySchema.parse(await readJson(req));
  const user = await verifyResetToken(db, body.token); // 410 when invalid/spent
  await setPassword(db, user.id, body.password);
  await createSession(user.id);
  return jsonOk({ user });
});
