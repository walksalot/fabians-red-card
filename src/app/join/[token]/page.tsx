import Link from 'next/link';
import { getDb } from '@/db';
import { getSessionUser } from '@/lib/session';
// Built by the services agent; integrator reconciles (see CONTRACTS.md).
import { getLeagueByInviteToken, listMembers } from '@/lib/services/leagues';
import { Brand } from '@/components/Brand';
import { JoinLeagueClient } from '@/components/JoinLeagueClient';

interface InviteLeague {
  id: number;
  name: string;
  slug: string;
}

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const db = getDb();

  let league: InviteLeague | null = null;
  try {
    const found = (await getLeagueByInviteToken(db, token)) as unknown;
    league = (found ?? null) as InviteLeague | null;
  } catch {
    league = null; // unknown/expired token → friendly error below
  }

  if (!league) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-6 px-5 py-10 text-center">
        <Brand />
        <div className="space-y-2">
          <h1 className="text-xl font-bold text-zinc-100">
            That invite is a red card
          </h1>
          <p className="text-sm text-zinc-400">
            This invite link is not valid. Ask your friend to send a fresh one
            from the league admin page.
          </p>
        </div>
        <Link
          href="/"
          className="flex h-12 items-center justify-center rounded-xl bg-zinc-900 px-6 font-semibold text-zinc-100 ring-1 ring-zinc-800"
        >
          Go home
        </Link>
      </main>
    );
  }

  const members = ((await listMembers(db, league.id)) ?? []) as unknown[];
  const memberCount = members.length;
  const user = await getSessionUser(db);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-5 py-10">
      <header className="space-y-3">
        <Brand size="sm" />
        <div className="rounded-2xl bg-zinc-900 p-5 ring-1 ring-zinc-800">
          <p className="text-xs font-semibold tracking-wide text-emerald-400 uppercase">
            You are invited
          </p>
          <h1 className="mt-1 text-2xl font-bold text-zinc-100">
            {league.name}
          </h1>
          <p className="mt-1 text-sm text-zinc-400" data-testid="member-count">
            {memberCount} {memberCount === 1 ? 'player' : 'players'} already in
          </p>
        </div>
        {!user ? (
          <p className="text-sm text-zinc-400">
            Create an account to lock in your spot — it takes 20 seconds.
          </p>
        ) : null}
      </header>

      <JoinLeagueClient
        token={token}
        slug={league.slug}
        leagueName={league.name}
        signedIn={user !== null}
      />
    </main>
  );
}
