import { beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import { AppError } from '@/lib/errors';
import {
  addEntry,
  createLeague,
  createUser,
  getLeagueByInviteToken,
  getLeagueBySlug,
  joinByInviteToken,
  joinByPassword,
  listMembers,
  prizePool,
  removeMember,
  updateLeagueSettings,
  verifyLogin,
  type PublicUser,
} from '@/lib/services/leagues';
import { freshDb } from '../helpers/db';

vi.mock('@/lib/services/results', () => ({
  recomputeLeague: vi.fn(async () => {}),
  recomputeMatch: vi.fn(async () => {}),
}));

async function expectAppError(p: Promise<unknown>, status: number): Promise<AppError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).status).toBe(status);
  return err as AppError;
}

function makeUser(db: Db, username: string, displayName?: string): Promise<PublicUser> {
  return createUser(db, {
    username,
    displayName: displayName ?? username.toUpperCase(),
    password: `pw-${username}`,
  });
}

function membershipRow(db: Db, leagueId: number, userId: number) {
  return db
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.leagueId, leagueId), eq(schema.memberships.userId, userId)))
    .get();
}

function entryRows(db: Db, leagueId: number, userId: number) {
  return db
    .select()
    .from(schema.entries)
    .where(and(eq(schema.entries.leagueId, leagueId), eq(schema.entries.userId, userId)))
    .all();
}

function insertMatch(db: Db, id: number): void {
  db.insert(schema.matches)
    .values({
      id,
      stage: 'group',
      groupLetter: 'A',
      kickoffUtc: '2026-06-11T20:00:00Z',
      matchday: '2026-06-11',
      venue: 'Estadio Azteca',
      city: 'Mexico City',
    })
    .run();
}

let db: Db;

beforeEach(() => {
  db = freshDb();
  vi.clearAllMocks();
});

describe('createUser / verifyLogin', () => {
  it('lowercases and trims the username and never returns the hash', async () => {
    const user = await createUser(db, {
      username: '  KrIs_99 ',
      displayName: '  Kris  ',
      password: 'hunter2',
    });
    expect(user.username).toBe('kris_99');
    expect(user.displayName).toBe('Kris');
    expect(user).not.toHaveProperty('passwordHash');

    const row = db.select().from(schema.users).where(eq(schema.users.id, user.id)).get();
    expect(row?.passwordHash).toBeTruthy();
    expect(row?.passwordHash).not.toContain('hunter2');
  });

  it('rejects invalid usernames with 400', async () => {
    await expectAppError(
      createUser(db, { username: 'ab', displayName: 'X', password: 'p' }),
      400,
    );
    await expectAppError(
      createUser(db, { username: 'has space', displayName: 'X', password: 'p' }),
      400,
    );
    await expectAppError(
      createUser(db, { username: 'Ümläut!', displayName: 'X', password: 'p' }),
      400,
    );
    await expectAppError(
      createUser(db, { username: 'a'.repeat(31), displayName: 'X', password: 'p' }),
      400,
    );
  });

  it('rejects duplicate usernames with 409 (case-insensitive)', async () => {
    await makeUser(db, 'fabian');
    await expectAppError(
      createUser(db, { username: 'FABIAN', displayName: 'F2', password: 'p' }),
      409,
    );
  });

  it('verifyLogin succeeds with good credentials and throws 401 on bad ones', async () => {
    const created = await makeUser(db, 'fabian');
    const user = await verifyLogin(db, { username: ' Fabian ', password: 'pw-fabian' });
    expect(user.id).toBe(created.id);
    await expectAppError(verifyLogin(db, { username: 'fabian', password: 'wrong' }), 401);
    await expectAppError(verifyLogin(db, { username: 'nobody', password: 'pw' }), 401);
  });
});

describe('createLeague', () => {
  it('creator gets admin membership and a first entry labelled with their display name', async () => {
    const admin = await makeUser(db, 'fabian', 'Fabian');
    const league = await createLeague(db, admin.id, {
      name: "Fabian's Red Card!",
      buyInCents: 2000,
    });

    expect(league.slug).toBe('fabian-s-red-card');
    expect(league.inviteToken).toMatch(/^[0-9a-f]{24}$/);
    expect(league.adminUserId).toBe(admin.id);
    expect(league.buyInCents).toBe(2000);
    expect(league.joinPasswordHash).toBeNull();
    expect(league.isPrivate).toBe(1);

    expect(membershipRow(db, league.id, admin.id)?.role).toBe('admin');
    const entries = entryRows(db, league.id, admin.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.label).toBe('Fabian');
  });

  it('uniquifies slugs with -2/-3 suffixes', async () => {
    const admin = await makeUser(db, 'fabian');
    const a = await createLeague(db, admin.id, { name: 'Same Name' });
    const b = await createLeague(db, admin.id, { name: 'Same  Name' });
    const c = await createLeague(db, admin.id, { name: 'same name' });
    expect(a.slug).toBe('same-name');
    expect(b.slug).toBe('same-name-2');
    expect(c.slug).toBe('same-name-3');
  });

  it('getLeagueBySlug / getLeagueByInviteToken find the league or throw 404', async () => {
    const admin = await makeUser(db, 'fabian');
    const league = await createLeague(db, admin.id, { name: 'Pool' });
    expect((await getLeagueBySlug(db, 'pool')).id).toBe(league.id);
    expect((await getLeagueByInviteToken(db, league.inviteToken)).id).toBe(league.id);
    await expectAppError(getLeagueBySlug(db, 'missing'), 404);
    await expectAppError(getLeagueByInviteToken(db, 'deadbeefdeadbeefdeadbeef'), 404);
  });
});

describe('joining a league', () => {
  it('joining via invite link creates membership and entry', async () => {
    const admin = await makeUser(db, 'fabian', 'Fabian');
    const league = await createLeague(db, admin.id, { name: 'Pool' });
    const kris = await makeUser(db, 'kris', 'Kris');

    const result = await joinByInviteToken(db, kris.id, league.inviteToken);

    expect(result.league.id).toBe(league.id);
    expect(membershipRow(db, league.id, kris.id)?.role).toBe('member');
    const entries = entryRows(db, league.id, kris.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe(result.entry.id);
    expect(entries[0]!.label).toBe('Kris');
  });

  it('joining via league password creates membership and entry', async () => {
    const admin = await makeUser(db, 'fabian');
    const league = await createLeague(db, admin.id, { name: 'Pool', joinPassword: 'redcard' });
    const kris = await makeUser(db, 'kris', 'Kris');

    const result = await joinByPassword(db, kris.id, league.slug, 'redcard');

    expect(result.league.id).toBe(league.id);
    expect(membershipRow(db, league.id, kris.id)?.role).toBe('member');
    const entries = entryRows(db, league.id, kris.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.label).toBe('Kris');
  });

  it('wrong league password is rejected', async () => {
    const admin = await makeUser(db, 'fabian');
    const league = await createLeague(db, admin.id, { name: 'Pool', joinPassword: 'redcard' });
    const kris = await makeUser(db, 'kris');

    await expectAppError(joinByPassword(db, kris.id, league.slug, 'yellowcard'), 403);
    expect(membershipRow(db, league.id, kris.id)).toBeUndefined();
    expect(entryRows(db, league.id, kris.id)).toHaveLength(0);
  });

  it('joining twice is idempotent (no duplicate membership or entry)', async () => {
    const admin = await makeUser(db, 'fabian');
    const league = await createLeague(db, admin.id, { name: 'Pool', joinPassword: 'redcard' });
    const kris = await makeUser(db, 'kris');

    const first = await joinByInviteToken(db, kris.id, league.inviteToken);
    const second = await joinByInviteToken(db, kris.id, league.inviteToken);
    const third = await joinByPassword(db, kris.id, league.slug, 'redcard');

    expect(second.entry.id).toBe(first.entry.id);
    expect(third.entry.id).toBe(first.entry.id);
    expect(entryRows(db, league.id, kris.id)).toHaveLength(1);
    expect(
      db.select().from(schema.memberships).where(eq(schema.memberships.leagueId, league.id)).all(),
    ).toHaveLength(2); // admin + kris
  });

  it('public league with no password is joinable with an empty password', async () => {
    const admin = await makeUser(db, 'fabian');
    const league = await createLeague(db, admin.id, { name: 'Open Pool' });
    await updateLeagueSettings(db, league.id, admin.id, { isPrivate: 0 });
    const kris = await makeUser(db, 'kris');

    const result = await joinByPassword(db, kris.id, league.slug, '');
    expect(result.entry.leagueId).toBe(league.id);
    expect(membershipRow(db, league.id, kris.id)?.role).toBe('member');
  });

  it('private league with no password cannot be joined by password', async () => {
    const admin = await makeUser(db, 'fabian');
    const league = await createLeague(db, admin.id, { name: 'Closed Pool' });
    const kris = await makeUser(db, 'kris');

    await expectAppError(joinByPassword(db, kris.id, league.slug, ''), 403);
    expect(membershipRow(db, league.id, kris.id)).toBeUndefined();
  });
});

describe('entries per user', () => {
  it('one entry per user per league by default', async () => {
    const admin = await makeUser(db, 'fabian');
    const league = await createLeague(db, admin.id, { name: 'Pool' });
    const kris = await makeUser(db, 'kris');
    await joinByInviteToken(db, kris.id, league.inviteToken);

    await expectAppError(addEntry(db, kris.id, league.id, 'Kris #2'), 403);
    expect(entryRows(db, league.id, kris.id)).toHaveLength(1);
  });

  it('admin can raise entries per user and extra entries become allowed', async () => {
    const admin = await makeUser(db, 'fabian');
    const league = await createLeague(db, admin.id, { name: 'Pool' });
    const kris = await makeUser(db, 'kris');
    await joinByInviteToken(db, kris.id, league.inviteToken);

    await updateLeagueSettings(db, league.id, admin.id, { entriesPerUser: 3 });

    const e2 = await addEntry(db, kris.id, league.id, 'Kris #2');
    const e3 = await addEntry(db, kris.id, league.id, 'Kris #3');
    expect(e2.label).toBe('Kris #2');
    expect(e3.label).toBe('Kris #3');
    await expectAppError(addEntry(db, kris.id, league.id, 'Kris #4'), 403);
    expect(entryRows(db, league.id, kris.id)).toHaveLength(3);
  });

  it('non-members cannot add entries', async () => {
    const admin = await makeUser(db, 'fabian');
    const league = await createLeague(db, admin.id, { name: 'Pool' });
    const stranger = await makeUser(db, 'stranger');
    await expectAppError(addEntry(db, stranger.id, league.id, 'Sneaky'), 403);
  });
});

describe('league settings', () => {
  it('only admin can update settings', async () => {
    const admin = await makeUser(db, 'fabian');
    const league = await createLeague(db, admin.id, { name: 'Pool' });
    const kris = await makeUser(db, 'kris');
    await joinByInviteToken(db, kris.id, league.inviteToken);

    await expectAppError(
      updateLeagueSettings(db, league.id, kris.id, { entriesPerUser: 5 }),
      403,
    );
    const stranger = await makeUser(db, 'stranger');
    await expectAppError(
      updateLeagueSettings(db, league.id, stranger.id, { entriesPerUser: 5 }),
      403,
    );

    const updated = await updateLeagueSettings(db, league.id, admin.id, {
      name: 'Renamed Pool',
      buyInCents: 1500,
    });
    expect(updated.name).toBe('Renamed Pool');
    expect(updated.buyInCents).toBe(1500);
  });

  it('validates payoutSplit and entriesPerUser', async () => {
    const admin = await makeUser(db, 'fabian');
    const league = await createLeague(db, admin.id, { name: 'Pool' });

    await expectAppError(
      updateLeagueSettings(db, league.id, admin.id, { payoutSplit: [60, 30] }),
      400,
    );
    await expectAppError(
      updateLeagueSettings(db, league.id, admin.id, { payoutSplit: [60.5, 29.5, 10] }),
      400,
    );
    await expectAppError(
      updateLeagueSettings(db, league.id, admin.id, { payoutSplit: [-10, 60, 50] }),
      400,
    );
    await expectAppError(updateLeagueSettings(db, league.id, admin.id, { entriesPerUser: 0 }), 400);
    await expectAppError(
      updateLeagueSettings(db, league.id, admin.id, { entriesPerUser: 11 }),
      400,
    );

    const updated = await updateLeagueSettings(db, league.id, admin.id, {
      payoutSplit: [50, 30, 20],
    });
    expect(JSON.parse(updated.payoutSplit)).toEqual([50, 30, 20]);
  });

  it('join password can be set and cleared', async () => {
    const admin = await makeUser(db, 'fabian');
    const league = await createLeague(db, admin.id, { name: 'Pool' });

    const withPw = await updateLeagueSettings(db, league.id, admin.id, {
      joinPassword: 'newsecret',
    });
    expect(withPw.joinPasswordHash).toBeTruthy();
    expect(withPw.joinPasswordHash).not.toContain('newsecret');

    const kris = await makeUser(db, 'kris');
    await joinByPassword(db, kris.id, league.slug, 'newsecret');
    expect(membershipRow(db, league.id, kris.id)).toBeDefined();

    const cleared = await updateLeagueSettings(db, league.id, admin.id, { joinPassword: null });
    expect(cleared.joinPasswordHash).toBeNull();
  });

  it('changing scoring settings triggers a league recompute (and unrelated changes do not)', async () => {
    const { recomputeLeague } = await import('@/lib/services/results');
    const admin = await makeUser(db, 'fabian');
    const league = await createLeague(db, admin.id, { name: 'Pool' });

    await updateLeagueSettings(db, league.id, admin.id, { name: 'Still Pool', buyInCents: 100 });
    expect(recomputeLeague).not.toHaveBeenCalled();

    await updateLeagueSettings(db, league.id, admin.id, {
      scoringRules: { exact: 12, outcome: 2, scorer: 8, firstTeam: 2, underdog: 5 },
    });
    expect(recomputeLeague).toHaveBeenCalledTimes(1);
    expect(recomputeLeague).toHaveBeenCalledWith(db, league.id);

    await updateLeagueSettings(db, league.id, admin.id, { boosterMultiplier: 3 });
    expect(recomputeLeague).toHaveBeenCalledTimes(2);

    await updateLeagueSettings(db, league.id, admin.id, {
      roundMultipliers: { group: 1, r32: 1, r16: 1, qf: 1.5, sf: 2, third: 1, final: 3 },
    });
    expect(recomputeLeague).toHaveBeenCalledTimes(3);

    // Re-submitting identical scoring settings is not a change.
    await updateLeagueSettings(db, league.id, admin.id, { boosterMultiplier: 3 });
    expect(recomputeLeague).toHaveBeenCalledTimes(3);
  });
});

describe('removeMember', () => {
  it('admin can remove a member and their data', async () => {
    const admin = await makeUser(db, 'fabian', 'Fabian');
    const league = await createLeague(db, admin.id, { name: 'Pool' });
    const kris = await makeUser(db, 'kris', 'Kris');
    const { entry: krisEntry } = await joinByInviteToken(db, kris.id, league.inviteToken);
    const adminEntry = entryRows(db, league.id, admin.id)[0]!;

    insertMatch(db, 1);
    const ts = Date.now();
    for (const entryId of [krisEntry.id, adminEntry.id]) {
      db.insert(schema.picks)
        .values({ entryId, matchId: 1, predHome: 2, predAway: 1, createdAt: ts, updatedAt: ts })
        .run();
      db.insert(schema.boosters)
        .values({ entryId, matchday: '2026-06-11', matchId: 1, createdAt: ts, updatedAt: ts })
        .run();
      db.insert(schema.matchPoints)
        .values({ entryId, matchId: 1, breakdown: '{}', total: 10 })
        .run();
    }

    await removeMember(db, league.id, admin.id, kris.id);

    expect(membershipRow(db, league.id, kris.id)).toBeUndefined();
    expect(entryRows(db, league.id, kris.id)).toHaveLength(0);
    for (const table of [schema.picks, schema.boosters, schema.matchPoints] as const) {
      expect(
        db.select().from(table).where(eq(table.entryId, krisEntry.id)).all(),
      ).toHaveLength(0);
      expect(
        db.select().from(table).where(eq(table.entryId, adminEntry.id)).all(),
      ).toHaveLength(1); // admin's data untouched
    }
    expect(membershipRow(db, league.id, admin.id)?.role).toBe('admin');
  });

  it('admin cannot remove themselves', async () => {
    const admin = await makeUser(db, 'fabian');
    const league = await createLeague(db, admin.id, { name: 'Pool' });
    await expectAppError(removeMember(db, league.id, admin.id, admin.id), 400);
    expect(membershipRow(db, league.id, admin.id)).toBeDefined();
  });

  it('non-admins cannot remove members', async () => {
    const admin = await makeUser(db, 'fabian');
    const league = await createLeague(db, admin.id, { name: 'Pool' });
    const kris = await makeUser(db, 'kris');
    await joinByInviteToken(db, kris.id, league.inviteToken);

    await expectAppError(removeMember(db, league.id, kris.id, admin.id), 403);
    expect(membershipRow(db, league.id, admin.id)).toBeDefined();
  });

  it('removing a non-member throws 404', async () => {
    const admin = await makeUser(db, 'fabian');
    const league = await createLeague(db, admin.id, { name: 'Pool' });
    const stranger = await makeUser(db, 'stranger');
    await expectAppError(removeMember(db, league.id, admin.id, stranger.id), 404);
  });
});

describe('listMembers', () => {
  it('lists members with role and entry count', async () => {
    const admin = await makeUser(db, 'fabian', 'Fabian');
    const league = await createLeague(db, admin.id, { name: 'Pool' });
    await updateLeagueSettings(db, league.id, admin.id, { entriesPerUser: 2 });
    const kris = await makeUser(db, 'kris', 'Kris');
    await joinByInviteToken(db, kris.id, league.inviteToken);
    await addEntry(db, kris.id, league.id, 'Kris B-side');

    const members = await listMembers(db, league.id);
    expect(members).toHaveLength(2);
    expect(members[0]).toEqual({
      userId: admin.id,
      displayName: 'Fabian',
      role: 'admin',
      entryCount: 1,
    });
    expect(members[1]).toEqual({
      userId: kris.id,
      displayName: 'Kris',
      role: 'member',
      entryCount: 2,
    });
  });
});

describe('prizePool', () => {
  it('prize pool = buy-in x player count with 1st/2nd/3rd payout split', async () => {
    const admin = await makeUser(db, 'fabian');
    const league = await createLeague(db, admin.id, { name: 'Pool', buyInCents: 2000 });

    const pool = prizePool(league, 15);

    expect(pool.totalCents).toBe(30000);
    expect(pool.payouts).toEqual([
      { place: 1, percent: 60, amountCents: 18000 },
      { place: 2, percent: 30, amountCents: 9000 },
      { place: 3, percent: 10, amountCents: 3000 },
    ]);
  });

  it('payout amounts floor to whole cents', () => {
    const pool = prizePool({ buyInCents: 333, payoutSplit: '[60,30,10]' }, 3); // total 999
    expect(pool.totalCents).toBe(999);
    expect(pool.payouts.map((p) => p.amountCents)).toEqual([599, 299, 99]);
  });
});
