import { z } from 'zod';
import { getDb } from '@/db';
import { requireUser } from '@/lib/session';
import { joinByPassword } from '@/lib/services/leagues';
import { handle, jsonOk, readJson } from '@/lib/api-helpers';

// Body is optional: public leagues need no password.
const bodySchema = z
  .object({ password: z.string().max(200).optional() })
  .optional();

type RouteCtx = { params: Promise<{ slug: string }> };

export const POST = handle<RouteCtx>(async (req, { params }) => {
  const { slug } = await params;
  const db = getDb();
  const user = await requireUser(db);
  const body = bodySchema.parse(await readJson(req)) ?? {};
  // throws 403 on bad password; idempotent when already a member
  const { entry } = await joinByPassword(db, user.id, slug, body.password ?? '');
  return jsonOk({ entry });
});
