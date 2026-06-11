import Link from 'next/link';

/**
 * Friendly landing for an account with no player entry (instead of a dead-end
 * "no entry" message). The seeded admin account intentionally has no entry —
 * it referees, it doesn't play — and that needs explaining where the admin
 * actually lands after logging in.
 */
export default function CommissionerCard({
  slug,
  isAdmin,
}: {
  slug: string;
  isAdmin: boolean;
}) {
  if (!isAdmin) {
    return (
      <div className="rounded-2xl bg-zinc-900 p-6 text-center ring-1 ring-zinc-800">
        <p className="text-zinc-300">No player entry on this account yet.</p>
        <p className="mt-2 text-sm text-zinc-500">
          Ask the league admin for the invite link to get set up.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl bg-zinc-900 p-6 ring-1 ring-zinc-800">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
        Commissioner account
      </p>
      <h2 className="mt-1 text-xl font-bold">You run this league 🔴</h2>
      <p className="mt-2 text-sm leading-relaxed text-zinc-400">
        This account referees — it enters and corrects results, manages members,
        and controls the settings. It doesn&apos;t make picks, so there&apos;s
        nothing for it on the player screens.
      </p>
      <Link
        href={`/league/${slug}/admin`}
        data-testid="open-admin"
        className="mt-4 flex h-12 w-full items-center justify-center rounded-xl bg-emerald-400 font-semibold text-zinc-950 transition-transform active:scale-[.99]"
      >
        Open the Admin panel
      </Link>
      <p className="mt-3 text-xs leading-relaxed text-zinc-500">
        Want to play too? Join from the group invite link with a second, normal
        account — admin account is the whistle, player account is the boots.
      </p>
    </div>
  );
}
