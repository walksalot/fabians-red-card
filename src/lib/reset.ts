/**
 * Password reset for an email-less friend pool: the league admin is the
 * identity provider. They generate a one-time reset link for a member and
 * hand it over in the group chat; the member sets a new password themselves.
 *
 * Tokens are stateless JWTs (no table): {uid, purpose, ph} where `ph` is a
 * fragment of the CURRENT password hash. The moment the password changes, the
 * fragment stops matching and the token self-invalidates — one effective use,
 * with a 24h expiry as the outer bound.
 */
import { SignJWT, jwtVerify } from 'jose';
import { eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import { AppError } from '@/lib/errors';

const PURPOSE = 'pwreset';
const TTL = '24h';

function secretKey(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET is not set');
  return new TextEncoder().encode(s);
}

function hashFragment(passwordHash: string): string {
  return passwordHash.slice(-10);
}

export async function createResetToken(db: Db, userId: number): Promise<string> {
  const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!user) throw new AppError('user not found', 404);
  return new SignJWT({ uid: user.id, purpose: PURPOSE, ph: hashFragment(user.passwordHash) })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TTL)
    .sign(secretKey());
}

export interface ResetTokenUser {
  id: number;
  username: string;
  displayName: string;
}

/** Valid, unexpired, unused token → the user it belongs to; AppError otherwise. */
export async function verifyResetToken(db: Db, token: string): Promise<ResetTokenUser> {
  let payload: Record<string, unknown>;
  try {
    payload = (await jwtVerify(token, secretKey())).payload;
  } catch {
    throw new AppError('This reset link is invalid or has expired', 410);
  }
  if (payload.purpose !== PURPOSE || typeof payload.uid !== 'number') {
    throw new AppError('This reset link is invalid or has expired', 410);
  }
  const user = db.select().from(schema.users).where(eq(schema.users.id, payload.uid)).get();
  if (!user) throw new AppError('This reset link is invalid or has expired', 410);
  if (payload.ph !== hashFragment(user.passwordHash)) {
    // password already changed since the link was issued — link is spent
    throw new AppError('This reset link has already been used', 410);
  }
  return { id: user.id, username: user.username, displayName: user.displayName };
}
