'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  entryId: number;
  matchday: string;
  matchId: number;
  /** This match currently holds the entry's booster for its matchday. */
  boosted: boolean;
  /** Locked match, finished match, or booster stuck on an already-kicked-off match. */
  disabled: boolean;
  multiplier: number;
}

/** Place (or move) the one-per-matchday booster onto this match. */
export default function BoosterButton({
  entryId,
  matchday,
  matchId,
  boosted,
  disabled,
  multiplier,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function activate() {
    if (boosted || disabled || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/boosters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryId, matchday, matchId }),
      });
      const json: { ok: boolean; error?: string } | null = await res
        .json()
        .catch(() => null);
      if (json?.ok) {
        router.refresh();
      } else {
        setError(json?.error ?? 'Could not set the booster.');
      }
    } catch {
      setError('Network error — booster not set.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        data-testid="booster-toggle"
        type="button"
        aria-pressed={boosted}
        disabled={disabled || busy}
        onClick={activate}
        className={
          boosted
            ? 'rounded-lg border border-emerald-500 bg-emerald-500/15 px-3 py-1.5 text-sm font-semibold text-emerald-400'
            : 'rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-300 hover:border-emerald-500 hover:text-emerald-400 disabled:cursor-not-allowed disabled:opacity-40'
        }
      >
        {boosted
          ? `Booster ×${multiplier} active`
          : busy
            ? 'Setting…'
            : `Use booster ×${multiplier}`}
      </button>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}
