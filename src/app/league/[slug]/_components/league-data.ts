/**
 * Server-only loader shared by the league layout and every league page.
 * Each page re-loads its own data (server components), so this centralizes the
 * session / league / membership / entries boilerplate and the access rules:
 *  - not signed in            → redirect to /login?next=/league/<slug>/today
 *  - unknown slug             → notFound()
 *  - non-member, private      → redirect('/')
 *  - non-member, public       → isMember=false (layout shows a join prompt)
 *
 * NEVER import this from a 'use client' component (it touches the db).
 */
import { notFound, redirect } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { getDb, schema, type Db } from '@/db';
import { getSessionUser, type SessionUser } from '@/lib/session';

export type LeagueRow = typeof schema.leagues.$inferSelect;
export type EntryRow = typeof schema.entries.$inferSelect;
export type MatchRow = typeof schema.matches.$inferSelect;
export type PickRow = typeof schema.picks.$inferSelect;

export interface LeagueContext {
  db: Db;
  user: SessionUser;
  league: LeagueRow;
  isMember: boolean;
  /** League admin (role or league.adminUserId) — drives the header Admin button. */
  isAdmin: boolean;
  /** The signed-in user's entries in this league, oldest first. Empty if not a member. */
  entries: EntryRow[];
}

export async function loadLeagueContext(slug: string): Promise<LeagueContext> {
  const db = getDb();
  const user = await getSessionUser(db);
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/league/${slug}/today`)}`);
  }

  const league = db
    .select()
    .from(schema.leagues)
    .where(eq(schema.leagues.slug, slug))
    .get();
  if (!league) notFound();

  const membership = db
    .select()
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.leagueId, league.id),
        eq(schema.memberships.userId, user.id),
      ),
    )
    .get();

  if (!membership) {
    // Private + has a join password → let them reach the password door.
    // Private + invite-only (no password) → nothing to show, send home.
    if (league.isPrivate && league.joinPasswordHash === null) redirect('/');
    return { db, user, league, isMember: false, isAdmin: false, entries: [] };
  }

  const entries = db
    .select()
    .from(schema.entries)
    .where(
      and(
        eq(schema.entries.leagueId, league.id),
        eq(schema.entries.userId, user.id),
      ),
    )
    .orderBy(asc(schema.entries.id))
    .all();

  const isAdmin =
    membership.role === 'admin' || league.adminUserId === user.id;
  return { db, user, league, isMember: true, isAdmin, entries };
}

/**
 * Resolve the ?entry= query param to one of the user's own entries.
 * Untrusted input: anything that is not an owned entry id falls back to entry #1.
 */
export function pickSelectedEntry(
  entries: EntryRow[],
  entryParam: string | string[] | undefined,
): EntryRow | null {
  if (entries.length === 0) return null;
  const raw = Array.isArray(entryParam) ? entryParam[0] : entryParam;
  if (raw !== undefined && raw !== '') {
    const id = Number(raw);
    const found = entries.find((e) => e.id === id);
    if (found) return found;
  }
  return entries[0];
}
