/**
 * Thin helpers shared by all API route handlers.
 *
 * Envelope (CONTRACTS.md): success `{ ok: true, data }`, failure
 * `{ ok: false, error }` with a proper HTTP status.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { and, count, eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import { AppError } from '@/lib/errors';

/** Success envelope. */
export function jsonOk<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ ok: true, data }, { status });
}

/** Failure envelope. */
export function jsonErr(error: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}

/** Flatten a ZodError into a single human-readable message. */
function zodMessage(err: ZodError): string {
  return err.issues
    .map((issue) =>
      issue.path.length > 0
        ? `${issue.path.map(String).join('.')}: ${issue.message}`
        : issue.message,
    )
    .join('; ');
}

/**
 * Wrap a route handler with uniform error mapping:
 * - AppError  -> { ok:false, error: message } with its status
 * - ZodError  -> 400 with flattened message
 * - other     -> 500 generic message (real error logged, never leaked)
 */
export function handle<Ctx = unknown>(
  fn: (req: NextRequest, ctx: Ctx) => Promise<Response>,
): (req: NextRequest, ctx: Ctx) => Promise<Response> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof AppError) return jsonErr(err.message, err.status);
      if (err instanceof ZodError) return jsonErr(zodMessage(err), 400);
      console.error('[api] unhandled error:', err);
      return jsonErr('Something went wrong', 500);
    }
  };
}

/**
 * Read a JSON body without throwing on empty/malformed input.
 * Returns `undefined` in that case so zod produces a clean 400.
 */
export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

/**
 * League row safe for the wire: `joinPasswordHash` NEVER leaves the server;
 * `inviteToken` is included only for that league's admin.
 */
export function sanitizeLeague(
  league: Record<string, unknown>,
  isAdmin: boolean,
): Record<string, unknown> {
  const safe: Record<string, unknown> = { ...league };
  delete safe.joinPasswordHash;
  if (!isAdmin) delete safe.inviteToken;
  return safe;
}

/** Membership row of a user in a league, or undefined. */
export function membershipOf(db: Db, leagueId: number, userId: number) {
  return db
    .select()
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.leagueId, leagueId),
        eq(schema.memberships.userId, userId),
      ),
    )
    .get();
}

/** True when the user is an admin member of the league. */
export function isLeagueAdmin(db: Db, leagueId: number, userId: number): boolean {
  return membershipOf(db, leagueId, userId)?.role === 'admin';
}

/** Throws 403 unless the user is an admin of this league (belt-and-braces with services). */
export function requireLeagueAdmin(db: Db, leagueId: number, userId: number): void {
  if (!isLeagueAdmin(db, leagueId, userId)) {
    throw new AppError('Admin only', 403);
  }
}

/** Throws 403 unless the user is a member (any role) of this league. */
export function requireMember(db: Db, leagueId: number, userId: number): void {
  if (!membershipOf(db, leagueId, userId)) {
    throw new AppError('Members only', 403);
  }
}

/**
 * Throws 403 unless the user may write GLOBAL match data (results, knockout
 * teams, underdog flags): an admin of the primary (seeded) league. League
 * creation is open to everyone, so "admin of any league" must never count.
 * Single implementation lives in the results service.
 */
export { requireResultsAdmin } from '@/lib/services/results';

/** Number of memberships in a league. */
export function memberCountOf(db: Db, leagueId: number): number {
  const row = db
    .select({ n: count() })
    .from(schema.memberships)
    .where(eq(schema.memberships.leagueId, leagueId))
    .get();
  return row?.n ?? 0;
}

/** Number of entries in a league (drives the prize pool). */
export function entryCountOf(db: Db, leagueId: number): number {
  const row = db
    .select({ n: count() })
    .from(schema.entries)
    .where(eq(schema.entries.leagueId, leagueId))
    .get();
  return row?.n ?? 0;
}

/**
 * Loads an entry and asserts it belongs to this league (404) and to the
 * calling user (403). Returns the entry row.
 */
export function requireOwnedEntry(
  db: Db,
  userId: number,
  leagueId: number,
  entryId: number,
) {
  const entry = db
    .select()
    .from(schema.entries)
    .where(eq(schema.entries.id, entryId))
    .get();
  if (!entry || entry.leagueId !== leagueId) {
    throw new AppError('Entry not found', 404);
  }
  if (entry.userId !== userId) throw new AppError('Not your entry', 403);
  return entry;
}
