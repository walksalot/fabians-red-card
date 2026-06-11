import Link from 'next/link';
import { getDb } from '@/db';
import { getSessionUser } from '@/lib/session';
// Built by the services agent; integrator reconciles (see CONTRACTS.md).
import { getLeagueByInviteToken, listMembers } from '@/lib/services/leagues';
import AuthFooter from '@/components/AuthFooter';
import AuthGlow from '@/components/AuthGlow';
import { Brand } from '@/components/Brand';
import { JoinLeagueClient } from '@/components/JoinLeagueClient';
import Monogram from '@/components/Monogram';

/** How many member avatars to show before collapsing into a "+N" chip. */
const AVATAR_STACK_MAX = 5;

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
      <main className="relative isolate mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-6 px-5 py-10 text-center">
        <AuthGlow />
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
  // Display names for the avatar stack — validated at the boundary since the
  // service result is treated as unknown here.
  const memberNames = members
    .map((m) =>
      m !== null &&
      typeof m === 'object' &&
      'displayName' in m &&
      typeof (m as { displayName: unknown }).displayName === 'string'
        ? (m as { displayName: string }).displayName
        : null,
    )
    .filter((n): n is string => n !== null && n.trim().length > 0);
  const user = await getSessionUser(db);

  return (
    <main className="relative isolate mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-10">
      <AuthGlow />
      {/* my-auto centers the invite card in the space above the pinned footer,
          so the tagline strip anchors the viewport bottom like a splash. */}
      <div className="my-auto space-y-8 py-6">
      <header className="space-y-3">
        {/* Bigger than the old sm chip, but the invite card stays the hero. */}
        <Brand size="lg" />
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
          {/* The strongest conversion lever: your friends are already here. */}
          {memberNames.length > 0 ? (
            // Proper facepile: tight overlap + near-black rings (the card is
            // zinc-900, so a zinc-950 ring reads as a crisp cutout) makes the
            // row read as one crowd of friends, not separate tokens.
            <div className="mt-3 flex items-center" aria-hidden="true">
              <div className="flex -space-x-1.5">
                {memberNames.slice(0, AVATAR_STACK_MAX).map((n, i) => (
                  <Monogram
                    key={`${n}-${i}`}
                    name={n}
                    size="md"
                    className="ring-2 ring-zinc-950"
                  />
                ))}
              </div>
              {memberNames.length > AVATAR_STACK_MAX ? (
                <span className="-ml-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[11px] font-bold text-zinc-300 ring-2 ring-zinc-950">
                  +{memberNames.length - AVATAR_STACK_MAX}
                </span>
              ) : null}
            </div>
          ) : null}
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
      </div>
      <AuthFooter />
    </main>
  );
}
