import { randomBytes } from 'node:crypto';
import { compare, hash } from 'bcryptjs';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import { nowMs } from '@/lib/clock';
import { AppError } from '@/lib/errors';
import type { ScoringRules, Stage } from '@/lib/scoring';

export type League = typeof schema.leagues.$inferSelect;
export type Entry = typeof schema.entries.$inferSelect;

export interface PublicUser {
  id: number;
  username: string;
  displayName: string;
}

export interface LeagueMember {
  userId: number;
  displayName: string;
  role: 'admin' | 'member';
  entryCount: number;
}

export interface PrizePayout {
  place: number;
  percent: number;
  amountCents: number;
}

export interface LeagueSettingsPatch {
  name?: string;
  isPrivate?: 0 | 1;
  joinPassword?: string | null;
  entriesPerUser?: number;
  buyInCents?: number;
  payoutSplit?: number[];
  scoringRules?: ScoringRules;
  boosterMultiplier?: number;
  roundMultipliers?: Record<Stage, number>;
}

const USERNAME_RE = /^[a-z0-9_-]{3,30}$/;
const BCRYPT_ROUNDS = 10;
const SCORING_KEYS = ['exact', 'outcome', 'scorer', 'firstTeam', 'underdog'] as const;
const STAGES: readonly Stage[] = ['group', 'r32', 'r16', 'qf', 'sf', 'third', 'final'];

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function createUser(
  db: Db,
  input: { username: string; displayName: string; password: string },
): Promise<PublicUser> {
  const username = input.username.trim().toLowerCase();
  if (!USERNAME_RE.test(username)) {
    throw new AppError('username must be 3-30 characters using a-z, 0-9, _ or -', 400);
  }
  const displayName = input.displayName.trim();
  if (!displayName) throw new AppError('display name is required', 400);
  if (!input.password) throw new AppError('password is required', 400);

  const existing = db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.username, username))
    .get();
  if (existing) throw new AppError('username is already taken', 409);

  const passwordHash = await hash(input.password, BCRYPT_ROUNDS);
  const row = db
    .insert(schema.users)
    .values({ username, displayName, passwordHash, createdAt: nowMs() })
    .returning()
    .get();
  return { id: row.id, username: row.username, displayName: row.displayName };
}

export async function verifyLogin(
  db: Db,
  input: { username: string; password: string },
): Promise<PublicUser> {
  const username = input.username.trim().toLowerCase();
  const user = db
    .select()
    .from(schema.users)
    .where(eq(schema.users.username, username))
    .get();
  const ok = user ? await compare(input.password, user.passwordHash) : false;
  if (!user || !ok) throw new AppError('invalid username or password', 401);
  return { id: user.id, username: user.username, displayName: user.displayName };
}

// ---------------------------------------------------------------------------
// Leagues
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'league';
}

function uniqueSlug(db: Db, name: string): string {
  const base = slugify(name);
  let slug = base;
  for (let n = 2; ; n += 1) {
    const taken = db
      .select({ id: schema.leagues.id })
      .from(schema.leagues)
      .where(eq(schema.leagues.slug, slug))
      .get();
    if (!taken) return slug;
    slug = `${base}-${n}`;
  }
}

function newInviteToken(db: Db): string {
  for (;;) {
    const token = randomBytes(12).toString('hex'); // 24 hex chars
    const taken = db
      .select({ id: schema.leagues.id })
      .from(schema.leagues)
      .where(eq(schema.leagues.inviteToken, token))
      .get();
    if (!taken) return token;
  }
}

function getUserOr404(db: Db, userId: number) {
  const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!user) throw new AppError('user not found', 404);
  return user;
}

function membershipOf(db: Db, leagueId: number, userId: number) {
  return db
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.leagueId, leagueId), eq(schema.memberships.userId, userId)))
    .get();
}

function requireAdmin(db: Db, leagueId: number, userId: number): void {
  const membership = membershipOf(db, leagueId, userId);
  if (!membership || membership.role !== 'admin') {
    throw new AppError('admin access required', 403);
  }
}

function getLeagueByIdOr404(db: Db, leagueId: number): League {
  const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, leagueId)).get();
  if (!league) throw new AppError('league not found', 404);
  return league;
}

export async function createLeague(
  db: Db,
  userId: number,
  input: { name: string; buyInCents?: number; joinPassword?: string },
): Promise<League> {
  const name = input.name.trim();
  if (!name) throw new AppError('league name is required', 400);
  const buyInCents = input.buyInCents ?? 0;
  if (!Number.isInteger(buyInCents) || buyInCents < 0) {
    throw new AppError('buy-in must be a non-negative integer amount of cents', 400);
  }
  const user = getUserOr404(db, userId);
  const joinPasswordHash = input.joinPassword
    ? await hash(input.joinPassword, BCRYPT_ROUNDS)
    : null;
  const slug = uniqueSlug(db, name);
  const inviteToken = newInviteToken(db);
  const ts = nowMs();

  return db.transaction((tx) => {
    const league = tx
      .insert(schema.leagues)
      .values({ name, slug, inviteToken, joinPasswordHash, buyInCents, adminUserId: userId, createdAt: ts })
      .returning()
      .get();
    tx.insert(schema.memberships)
      .values({ leagueId: league.id, userId, role: 'admin', createdAt: ts })
      .run();
    tx.insert(schema.entries)
      .values({ leagueId: league.id, userId, label: user.displayName, createdAt: ts })
      .run();
    return league;
  });
}

export async function getLeagueBySlug(db: Db, slug: string): Promise<League> {
  const league = db.select().from(schema.leagues).where(eq(schema.leagues.slug, slug)).get();
  if (!league) throw new AppError('league not found', 404);
  return league;
}

export async function getLeagueByInviteToken(db: Db, token: string): Promise<League> {
  const league = db
    .select()
    .from(schema.leagues)
    .where(eq(schema.leagues.inviteToken, token))
    .get();
  if (!league) throw new AppError('league not found', 404);
  return league;
}

// ---------------------------------------------------------------------------
// Joining
// ---------------------------------------------------------------------------

/** Membership + entry #1 for a user; idempotent if already a member. */
function joinLeague(db: Db, league: League, userId: number): Entry {
  const user = getUserOr404(db, userId);
  const existing = membershipOf(db, league.id, userId);
  if (existing) {
    const entry = db
      .select()
      .from(schema.entries)
      .where(and(eq(schema.entries.leagueId, league.id), eq(schema.entries.userId, userId)))
      .orderBy(asc(schema.entries.id))
      .get();
    if (entry) return entry;
  }
  const ts = nowMs();
  return db.transaction((tx) => {
    if (!existing) {
      tx.insert(schema.memberships)
        .values({ leagueId: league.id, userId, role: 'member', createdAt: ts })
        .run();
    }
    return tx
      .insert(schema.entries)
      .values({ leagueId: league.id, userId, label: user.displayName, createdAt: ts })
      .returning()
      .get();
  });
}

export async function joinByInviteToken(
  db: Db,
  userId: number,
  token: string,
): Promise<{ league: League; entry: Entry }> {
  const league = await getLeagueByInviteToken(db, token);
  const entry = joinLeague(db, league, userId);
  return { league, entry };
}

export async function joinByPassword(
  db: Db,
  userId: number,
  slug: string,
  password: string,
): Promise<{ league: League; entry: Entry }> {
  const league = await getLeagueBySlug(db, slug);
  const existing = membershipOf(db, league.id, userId);
  if (!existing) {
    if (league.joinPasswordHash !== null) {
      const ok = await compare(password, league.joinPasswordHash);
      if (!ok) throw new AppError('wrong league password', 403);
    } else if (league.isPrivate !== 0) {
      // Private league without a join password is only joinable via invite link.
      throw new AppError('this league can only be joined via invite link', 403);
    }
    // Public league (isPrivate=0) with no join password: joinable with empty password.
  }
  const entry = joinLeague(db, league, userId);
  return { league, entry };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function parsedNumbersEqual<K extends string>(
  storedJson: string,
  next: Record<K, number>,
  keys: readonly K[],
): boolean {
  let stored: Record<string, unknown>;
  try {
    stored = JSON.parse(storedJson) as Record<string, unknown>;
  } catch {
    return false;
  }
  return keys.every((k) => stored[k] === next[k]);
}

function validateNumberRecord<K extends string>(
  value: Record<K, number>,
  keys: readonly K[],
  what: string,
): void {
  for (const k of keys) {
    const v = value[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      throw new AppError(`${what}.${k} must be a non-negative number`, 400);
    }
  }
}

export async function updateLeagueSettings(
  db: Db,
  leagueId: number,
  adminUserId: number,
  patch: LeagueSettingsPatch,
): Promise<League> {
  const league = getLeagueByIdOr404(db, leagueId);
  requireAdmin(db, leagueId, adminUserId);

  const updates: Partial<typeof schema.leagues.$inferInsert> = {};
  let scoringChanged = false;

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new AppError('league name is required', 400);
    updates.name = name;
  }
  if (patch.isPrivate !== undefined) {
    if (patch.isPrivate !== 0 && patch.isPrivate !== 1) {
      throw new AppError('isPrivate must be 0 or 1', 400);
    }
    updates.isPrivate = patch.isPrivate;
  }
  if (patch.joinPassword !== undefined) {
    if (patch.joinPassword === null) {
      updates.joinPasswordHash = null;
    } else {
      if (typeof patch.joinPassword !== 'string' || patch.joinPassword.length === 0) {
        throw new AppError('join password must be a non-empty string (or null to clear)', 400);
      }
      updates.joinPasswordHash = await hash(patch.joinPassword, BCRYPT_ROUNDS);
    }
  }
  if (patch.entriesPerUser !== undefined) {
    if (
      !Number.isInteger(patch.entriesPerUser) ||
      patch.entriesPerUser < 1 ||
      patch.entriesPerUser > 10
    ) {
      throw new AppError('entriesPerUser must be an integer between 1 and 10', 400);
    }
    updates.entriesPerUser = patch.entriesPerUser;
  }
  if (patch.buyInCents !== undefined) {
    if (!Number.isInteger(patch.buyInCents) || patch.buyInCents < 0) {
      throw new AppError('buy-in must be a non-negative integer amount of cents', 400);
    }
    updates.buyInCents = patch.buyInCents;
  }
  if (patch.payoutSplit !== undefined) {
    const split = patch.payoutSplit;
    const valid =
      Array.isArray(split) &&
      split.length >= 1 &&
      split.every((p) => Number.isInteger(p) && p >= 0) &&
      split.reduce((a, b) => a + b, 0) === 100;
    if (!valid) {
      throw new AppError('payoutSplit must be non-negative integers summing to 100', 400);
    }
    updates.payoutSplit = JSON.stringify(split);
  }
  if (patch.scoringRules !== undefined) {
    validateNumberRecord(patch.scoringRules, SCORING_KEYS, 'scoringRules');
    const canonical: ScoringRules = {
      exact: patch.scoringRules.exact,
      outcome: patch.scoringRules.outcome,
      scorer: patch.scoringRules.scorer,
      firstTeam: patch.scoringRules.firstTeam,
      underdog: patch.scoringRules.underdog,
    };
    if (!parsedNumbersEqual(league.scoringRules, canonical, SCORING_KEYS)) scoringChanged = true;
    updates.scoringRules = JSON.stringify(canonical);
  }
  if (patch.boosterMultiplier !== undefined) {
    if (typeof patch.boosterMultiplier !== 'number' || !Number.isFinite(patch.boosterMultiplier) || patch.boosterMultiplier <= 0) {
      throw new AppError('boosterMultiplier must be a positive number', 400);
    }
    if (patch.boosterMultiplier !== league.boosterMultiplier) scoringChanged = true;
    updates.boosterMultiplier = patch.boosterMultiplier;
  }
  if (patch.roundMultipliers !== undefined) {
    validateNumberRecord(patch.roundMultipliers, STAGES, 'roundMultipliers');
    const canonical = Object.fromEntries(
      STAGES.map((s) => [s, patch.roundMultipliers![s]]),
    ) as Record<Stage, number>;
    if (!parsedNumbersEqual(league.roundMultipliers, canonical, STAGES)) scoringChanged = true;
    updates.roundMultipliers = JSON.stringify(canonical);
  }

  const updated =
    Object.keys(updates).length > 0
      ? db
          .update(schema.leagues)
          .set(updates)
          .where(eq(schema.leagues.id, leagueId))
          .returning()
          .get()
      : league;

  if (scoringChanged) {
    // Lazy import avoids a hard module-load dependency cycle with the results service.
    const { recomputeLeague } = await import('@/lib/services/results');
    await recomputeLeague(db, leagueId);
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Members & entries
// ---------------------------------------------------------------------------

export async function removeMember(
  db: Db,
  leagueId: number,
  adminUserId: number,
  targetUserId: number,
): Promise<void> {
  getLeagueByIdOr404(db, leagueId);
  requireAdmin(db, leagueId, adminUserId);
  if (targetUserId === adminUserId) throw new AppError('admin cannot remove themselves', 400);
  const target = membershipOf(db, leagueId, targetUserId);
  if (!target) throw new AppError('member not found in this league', 404);

  db.transaction((tx) => {
    const entryIds = tx
      .select({ id: schema.entries.id })
      .from(schema.entries)
      .where(and(eq(schema.entries.leagueId, leagueId), eq(schema.entries.userId, targetUserId)))
      .all()
      .map((r) => r.id);
    if (entryIds.length > 0) {
      tx.delete(schema.matchPoints).where(inArray(schema.matchPoints.entryId, entryIds)).run();
      tx.delete(schema.boosters).where(inArray(schema.boosters.entryId, entryIds)).run();
      tx.delete(schema.picks).where(inArray(schema.picks.entryId, entryIds)).run();
      tx.delete(schema.entries).where(inArray(schema.entries.id, entryIds)).run();
    }
    tx.delete(schema.memberships).where(eq(schema.memberships.id, target.id)).run();
  });
}

export async function addEntry(
  db: Db,
  userId: number,
  leagueId: number,
  label: string,
): Promise<Entry> {
  const league = getLeagueByIdOr404(db, leagueId);
  const membership = membershipOf(db, leagueId, userId);
  if (!membership) throw new AppError('not a member of this league', 403);
  const trimmed = label.trim();
  if (!trimmed) throw new AppError('entry label is required', 400);

  const count =
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.entries)
      .where(and(eq(schema.entries.leagueId, leagueId), eq(schema.entries.userId, userId)))
      .get()?.n ?? 0;
  if (count >= league.entriesPerUser) {
    throw new AppError(`entry limit reached (${league.entriesPerUser} per player)`, 403);
  }

  return db
    .insert(schema.entries)
    .values({ leagueId, userId, label: trimmed, createdAt: nowMs() })
    .returning()
    .get();
}

export async function listMembers(db: Db, leagueId: number): Promise<LeagueMember[]> {
  const rows = db
    .select({
      userId: schema.memberships.userId,
      displayName: schema.users.displayName,
      role: schema.memberships.role,
      entryCount: sql<number>`count(${schema.entries.id})`,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .leftJoin(
      schema.entries,
      and(
        eq(schema.entries.leagueId, schema.memberships.leagueId),
        eq(schema.entries.userId, schema.memberships.userId),
      ),
    )
    .where(eq(schema.memberships.leagueId, leagueId))
    .groupBy(schema.memberships.id)
    .orderBy(asc(schema.memberships.createdAt), asc(schema.memberships.id))
    .all();
  return rows.map((r) => ({ ...r, role: r.role as 'admin' | 'member' }));
}

// ---------------------------------------------------------------------------
// Prize pool (pure)
// ---------------------------------------------------------------------------

export function prizePool(
  league: Pick<League, 'buyInCents' | 'payoutSplit'>,
  entryCount: number,
): { totalCents: number; payouts: PrizePayout[] } {
  const totalCents = league.buyInCents * entryCount;
  const split = JSON.parse(league.payoutSplit) as number[];
  const payouts = split.map((percent, i) => ({
    place: i + 1,
    percent,
    amountCents: Math.floor((totalCents * percent) / 100),
  }));
  return { totalCents, payouts };
}
