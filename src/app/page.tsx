import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { getSessionUser } from '@/lib/session';
import { Badge } from '@/components/Badge';
import { Brand } from '@/components/Brand';
import { CreateLeagueForm } from '@/components/CreateLeagueForm';

export default async function HomePage() {
  const db = getDb();
  const user = await getSessionUser(db);
  if (!user) redirect('/login');

  const memberships = db
    .select({
      slug: schema.leagues.slug,
      name: schema.leagues.name,
      role: schema.memberships.role,
    })
    .from(schema.memberships)
    .innerJoin(
      schema.leagues,
      eq(schema.memberships.leagueId, schema.leagues.id),
    )
    .where(eq(schema.memberships.userId, user.id))
    .all();

  if (memberships.length === 1) {
    redirect(`/league/${memberships[0].slug}/today`);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-8 px-5 py-10">
      <header className="space-y-2">
        <Brand />
        <p className="text-sm text-zinc-400">
          Hey {user.displayName} — pick a league or start a new one.
        </p>
      </header>

      {memberships.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-wide text-zinc-400 uppercase">
            Your leagues
          </h2>
          <ul className="space-y-2">
            {memberships.map((m) => (
              <li key={m.slug}>
                <Link
                  href={`/league/${m.slug}/today`}
                  data-testid="league-link"
                  className="flex min-h-14 items-center justify-between gap-3 rounded-2xl bg-zinc-900 px-4 py-3 ring-1 ring-zinc-800 transition-colors hover:ring-emerald-400/50"
                >
                  <span className="min-w-0 truncate font-semibold text-zinc-100">
                    {m.name}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {m.role === 'admin' ? <Badge>Admin</Badge> : null}
                    <span aria-hidden className="text-zinc-500">
                      →
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-400 uppercase">
          {memberships.length > 0 ? 'Create another league' : 'Create a league'}
        </h2>
        <div className="rounded-2xl bg-zinc-900 p-4 ring-1 ring-zinc-800">
          <CreateLeagueForm />
        </div>
      </section>

      <p className="text-center text-xs text-zinc-500">
        Got an invite link from a friend? Just open it to join their league.
      </p>
    </main>
  );
}
