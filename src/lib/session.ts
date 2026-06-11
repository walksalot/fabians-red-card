import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { users } from '@/db/schema';
import { AppError } from '@/lib/errors';

const COOKIE_NAME = 'wc_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 45; // 45 days — covers the whole tournament

function secretKey(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s) {
    throw new Error(
      'SESSION_SECRET is not set. Run `npm run setup` to generate .env.local.',
    );
  }
  return new TextEncoder().encode(s);
}

export async function createSession(userId: number): Promise<void> {
  const token = await new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secretKey());
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: MAX_AGE_SECONDS,
    path: '/',
  });
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export async function getSessionUserId(): Promise<number | null> {
  try {
    const jar = await cookies();
    const token = jar.get(COOKIE_NAME)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secretKey());
    return typeof payload.uid === 'number' ? payload.uid : null;
  } catch {
    return null; // expired/tampered token == signed out
  }
}

export type SessionUser = { id: number; username: string; displayName: string };

export async function getSessionUser(db: Db): Promise<SessionUser | null> {
  const uid = await getSessionUserId();
  if (uid === null) return null;
  const row = db.select().from(users).where(eq(users.id, uid)).get();
  if (!row) return null;
  return { id: row.id, username: row.username, displayName: row.displayName };
}

export async function requireUser(db: Db): Promise<SessionUser> {
  const user = await getSessionUser(db);
  if (!user) throw new AppError('Not signed in', 401);
  return user;
}
