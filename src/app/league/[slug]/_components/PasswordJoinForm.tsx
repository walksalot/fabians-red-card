'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Shown by the league layout to a signed-in non-member of a PRIVATE league that
 * has a join password. The other door in (CONTRACTS.md) alongside invite links.
 */
export default function PasswordJoinForm({
  slug,
  leagueName,
}: {
  slug: string;
  leagueName: string;
}) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(slug)}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const json: { ok: boolean; error?: string } | null = await res
        .json()
        .catch(() => null);
      if (json?.ok) {
        router.refresh();
      } else {
        setError(json?.error ?? 'Could not join the league.');
        setBusy(false);
      }
    } catch {
      setError('Network error — please try again.');
      setBusy(false);
    }
  }

  return (
    <div className="card p-6 text-center">
      <h2 className="text-lg font-semibold">Join {leagueName}</h2>
      <p className="mt-1 text-sm text-zinc-400">
        This is a private league. Enter the join password your friend shared.
      </p>
      <form onSubmit={onSubmit} className="mt-4 space-y-3">
        {/* Same field recipe as PickForm's wideInputClass — one input
            language app-wide. */}
        <input
          data-testid="join-password"
          type="password"
          autoComplete="off"
          placeholder="League password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-12 w-full rounded-xl border border-zinc-700 bg-zinc-950/60 px-4 text-center text-zinc-100 transition-colors focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
        />
        <button
          data-testid="join-submit"
          type="submit"
          disabled={busy || password.length === 0}
          className="h-11 w-full rounded-xl bg-emerald-400 font-semibold text-zinc-950 transition-transform active:scale-[.99] disabled:opacity-50"
        >
          {busy ? 'Joining…' : 'Join league'}
        </button>
        {error && (
          <p className="text-sm text-brand-bright" role="alert">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
