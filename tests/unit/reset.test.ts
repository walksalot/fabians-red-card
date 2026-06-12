import { beforeAll, describe, expect, it } from 'vitest';
import { schema, type Db } from '@/db';
import { createResetToken, verifyResetToken } from '@/lib/reset';
import { changePassword, createUser, setPassword, verifyLogin } from '@/lib/services/leagues';
import { freshDb } from '../helpers/db';

beforeAll(() => {
  process.env.SESSION_SECRET = 'vitest-secret-not-for-production';
});

async function seedUser(db: Db) {
  return createUser(db, {
    username: 'kaj',
    displayName: 'Kaj',
    password: 'original-pass',
  });
}

describe('password reset tokens', () => {
  it('round-trips: create → verify → set new password → login works', async () => {
    const db = freshDb();
    const user = await seedUser(db);
    const token = await createResetToken(db, user.id);
    const verified = await verifyResetToken(db, token);
    expect(verified.username).toBe('kaj');
    await setPassword(db, user.id, 'brand-new-pass');
    await expect(verifyLogin(db, { username: 'kaj', password: 'brand-new-pass' })).resolves.toMatchObject(
      { username: 'kaj' },
    );
  });

  it('self-destructs after use: once the password changes, the token is dead', async () => {
    const db = freshDb();
    const user = await seedUser(db);
    const token = await createResetToken(db, user.id);
    await setPassword(db, user.id, 'changed-by-reset');
    await expect(verifyResetToken(db, token)).rejects.toMatchObject({ status: 410 });
  });

  it('rejects tampered tokens and session JWTs used as reset tokens', async () => {
    const db = freshDb();
    const user = await seedUser(db);
    const token = await createResetToken(db, user.id);
    await expect(verifyResetToken(db, token.slice(0, -4) + 'AAAA')).rejects.toMatchObject({
      status: 410,
    });
    // a token without the reset purpose must not pass
    const { SignJWT } = await import('jose');
    const sessionLike = await new SignJWT({ uid: user.id })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(process.env.SESSION_SECRET));
    await expect(verifyResetToken(db, sessionLike)).rejects.toMatchObject({ status: 410 });
  });

  it('rejects tokens for deleted users', async () => {
    const db = freshDb();
    const user = await seedUser(db);
    const token = await createResetToken(db, user.id);
    const { eq } = await import('drizzle-orm');
    db.delete(schema.users).where(eq(schema.users.id, user.id)).run();
    await expect(verifyResetToken(db, token)).rejects.toMatchObject({ status: 410 });
  });
});

describe('changePassword', () => {
  it('requires the correct current password', async () => {
    const db = freshDb();
    const user = await seedUser(db);
    await expect(changePassword(db, user.id, 'wrong-pass!!', 'whatever-new')).rejects.toMatchObject(
      { status: 403 },
    );
    await changePassword(db, user.id, 'original-pass', 'fresh-new-pass');
    await expect(
      verifyLogin(db, { username: 'kaj', password: 'fresh-new-pass' }),
    ).resolves.toMatchObject({ username: 'kaj' });
  });

  it('enforces the 8-character minimum on the new password', async () => {
    const db = freshDb();
    const user = await seedUser(db);
    await expect(changePassword(db, user.id, 'original-pass', 'short')).rejects.toMatchObject({
      status: 400,
    });
  });
});
