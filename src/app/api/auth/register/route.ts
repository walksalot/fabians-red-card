import { z } from 'zod';
import { getDb } from '@/db';
import { createSession } from '@/lib/session';
import { createUser } from '@/lib/services/leagues';
import { assertRateLimit, clientIp } from '@/lib/rate-limit';
import { handle, jsonOk, readJson } from '@/lib/api-helpers';

// Custom messages: these surface verbatim in the register form's error slot,
// so raw Zod copy ("Too small: expected string…") must never reach users.
const bodySchema = z.object({
  username: z
    .string('Enter a username.')
    .trim()
    .min(1, 'Enter a username.')
    .max(40, 'Usernames are 40 characters at most.'),
  displayName: z
    .string('Enter a display name.')
    .trim()
    .min(1, 'Enter a display name.')
    .max(80, 'Display names are 80 characters at most.'),
  // minimum length enforced here AND in createUser (boundary + service)
  password: z
    .string('Enter a password.')
    .min(8, 'Password must be at least 8 characters.')
    .max(200, 'Passwords are 200 characters at most.'),
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
