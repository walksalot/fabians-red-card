import { getDb, schema } from '@/db';
import { asc } from 'drizzle-orm';
import { buildCalendar } from '@/lib/calendar';

export const dynamic = 'force-dynamic';

/**
 * Public tournament calendar feed (.ics). Friends "subscribe" to this URL in
 * Apple/Google Calendar and get their own kickoff reminders. It exposes only the
 * public match schedule — no league or player data — so it needs no auth.
 */
export async function GET() {
  const db = getDb();
  const primary = db.select().from(schema.leagues).orderBy(asc(schema.leagues.id)).limit(1).get();
  const ics = buildCalendar(db, primary?.name ?? "Fabian's Red Card");
  return new Response(ics, {
    status: 200,
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'inline; filename="world-cup-2026.ics"',
      'cache-control': 'public, max-age=3600',
    },
  });
}
