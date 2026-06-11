import { z } from 'zod';
import { getDb } from '@/db';
import { requireUser } from '@/lib/session';
import { joinByPassword } from '@/lib/services/leagues';
import { assertRateLimit, clearRateLimit, clientIp } from '@/lib/rate-limit';
import { handle, jsonOk, readJson } from '@/lib/api-helpers';

// Body is optional: public leagues need no password.
const bodySchema = z
  .object({ password: z.string().max(200).optional() })
  .optional();

// 10 attempts per (ip, league) per 15 minutes — the league password is a join
// credential and must not be brute-forceable.
const JOIN_LIMIT = 10;
const JOIN_WINDOW_MS = 15 * 60_000;

type RouteCtx = { params: Promise<{ slug: string }> };

export const POST = handle<RouteCtx>(async (req, { params }) => {
  const { slug } = await params;
  const db = getDb();
  const user = await requireUser(db);
  const body = bodySchema.parse(await readJson(req)) ?? {};
  const key = `join:${clientIp(req)}:${slug}`;
  assertRateLimit(key, JOIN_LIMIT, JOIN_WINDOW_MS); // throws 429
  // throws 403 on bad password; idempotent when already a member
  const { entry } = await joinByPassword(db, user.id, slug, body.password ?? '');
  clearRateLimit(key);
  return jsonOk({ entry });
});
