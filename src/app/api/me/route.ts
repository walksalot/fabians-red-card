import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { requireUser } from '@/lib/session';
import { handle, jsonOk } from '@/lib/api-helpers';

export const GET = handle(async () => {
  const db = getDb();
  const user = await requireUser(db);
  const leagues = db
    .select({
      slug: schema.leagues.slug,
      name: schema.leagues.name,
      role: schema.memberships.role,
    })
    .from(schema.memberships)
    .innerJoin(schema.leagues, eq(schema.memberships.leagueId, schema.leagues.id))
    .where(eq(schema.memberships.userId, user.id))
    .all();
  return jsonOk({ user, leagues });
});
