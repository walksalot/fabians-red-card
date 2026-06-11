'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Shown by the league layout when a signed-in non-member visits a PUBLIC league. */
export default function JoinPrompt({
  slug,
  leagueName,
}: {
  slug: string;
  leagueName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(slug)}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json: { ok: boolean; error?: string } | null = await res
        .json()
        .catch(() => null);
      if (json?.ok) {
        router.refresh();
      } else {
        setError(json?.error ?? 'Could not join the league.');
      }
    } catch {
      setError('Network error — please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-center">
      <h2 className="text-lg font-semibold">Join {leagueName}?</h2>
      <p className="mt-1 text-sm text-zinc-400">
        You are signed in but not a member of this league yet. It is open to
        join.
      </p>
      <button
        type="button"
        onClick={join}
        disabled={busy}
        className="mt-4 rounded-lg bg-emerald-500 px-5 py-2 font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
      >
        {busy ? 'Joining…' : 'Join league'}
      </button>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
