import { describe, expect, it } from 'vitest';
import { schema, type Db } from '@/db';
import { AppError } from '@/lib/errors';
import { requireOwnedEntry, sanitizeLeague } from '@/lib/api-helpers';
import { freshDb } from '../helpers/db';

// ---------------------------------------------------------------------------
// Fixtures via DIRECT drizzle inserts (never through other agents' services).
// ---------------------------------------------------------------------------

let seq = 0;

function makeUser(db: Db) {
  const username = `user${++seq}`;
  return db
    .insert(schema.users)
    .values({ username, displayName: username, passwordHash: 'test-hash', createdAt: 1 })
    .returning()
    .get();
}

function makeLeague(db: Db, adminUserId: number) {
  const n = ++seq;
  return db
    .insert(schema.leagues)
    .values({
      name: `League ${n}`,
      slug: `league-${n}`,
      inviteToken: `token-${n}`,
      joinPasswordHash: 'hash-of-join-password',
      adminUserId,
      createdAt: 1,
    })
    .returning()
    .get();
}

function makeEntry(db: Db, leagueId: number, userId: number) {
  return db
    .insert(schema.entries)
    .values({ leagueId, userId, label: `entry-${++seq}`, createdAt: 1 })
    .returning()
    .get();
}

function expectAppError(fn: () => unknown, status: number) {
  try {
    fn();
    expect.unreachable('expected AppError to be thrown');
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).status).toBe(status);
  }
}

// ---------------------------------------------------------------------------

describe('requireOwnedEntry', () => {
  function setup() {
    const db = freshDb();
    const owner = makeUser(db);
    const rival = makeUser(db);
    const league = makeLeague(db, owner.id);
    const otherLeague = makeLeague(db, rival.id);
    const ownEntry = makeEntry(db, league.id, owner.id);
    const rivalEntry = makeEntry(db, league.id, rival.id);
    const foreignLeagueEntry = makeEntry(db, otherLeague.id, rival.id);
    return { db, owner, rival, league, otherLeague, ownEntry, rivalEntry, foreignLeagueEntry };
  }

  it('returns the entry for its owner', () => {
    const { db, owner, league, ownEntry } = setup();
    const entry = requireOwnedEntry(db, owner.id, league.id, ownEntry.id);
    expect(entry.id).toBe(ownEntry.id);
    expect(entry.userId).toBe(owner.id);
  });

  it("throws 403 for another user's entry in the same league (pre-kickoff pick leak guard)", () => {
    const { db, owner, league, rivalEntry } = setup();
    // This is the ONLY user-ownership barrier on /today and /history — a
    // regression here lets a player read a rival's picks before kickoff.
    expectAppError(() => requireOwnedEntry(db, owner.id, league.id, rivalEntry.id), 403);
  });

  it('throws 404 for an entry belonging to a different league', () => {
    const { db, rival, league, foreignLeagueEntry } = setup();
    // Even its owner cannot address it through the wrong league's route.
    expectAppError(
      () => requireOwnedEntry(db, rival.id, league.id, foreignLeagueEntry.id),
      404,
    );
  });

  it('throws 404 for a missing entry id', () => {
    const { db, owner, league } = setup();
    expectAppError(() => requireOwnedEntry(db, owner.id, league.id, 99_999), 404);
  });
});

describe('sanitizeLeague', () => {
  const league = {
    id: 1,
    name: 'Pool',
    slug: 'pool',
    inviteToken: 'deadbeefdeadbeefdeadbeef',
    joinPasswordHash: '$2a$10$secret-hash',
    isPrivate: 1,
  };

  it('never contains joinPasswordHash, for admins or members', () => {
    expect(sanitizeLeague(league, true)).not.toHaveProperty('joinPasswordHash');
    expect(sanitizeLeague(league, false)).not.toHaveProperty('joinPasswordHash');
  });

  it('contains inviteToken only when isAdmin=true (the token is the join credential)', () => {
    expect(sanitizeLeague(league, true).inviteToken).toBe(league.inviteToken);
    expect(sanitizeLeague(league, false)).not.toHaveProperty('inviteToken');
  });

  it('does not mutate the input row', () => {
    const copy = { ...league };
    sanitizeLeague(copy, false);
    expect(copy).toEqual(league);
  });
});
