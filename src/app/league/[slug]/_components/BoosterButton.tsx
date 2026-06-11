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
  /**
   * Match locks far out (>6h) — render the unarmed pill a touch quieter so
   * the next-to-lock card's booster reads as the most present one. Pure
   * styling; the control stays one tap either way.
   */
  subtle?: boolean;
}

/** Place (or move) the one-per-matchday booster onto this match. */
export default function BoosterButton({
  entryId,
  matchday,
  matchId,
  boosted,
  disabled,
  multiplier,
  subtle = false,
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

  // Affordance contract: AMBER belongs to the ARMED state (and to urgency
  // chips elsewhere on the card). The armable state is a quiet neutral control
  // — dashed zinc outline, zinc text — with only the bolt glyph hinting amber,
  // so the armed pill and the <1h countdown never compete with it.
  const tone = boosted
    ? 'animate-pulse-glow border border-transparent bg-amber-400 text-zinc-950 shadow-[0_0_16px_-4px_rgba(251,191,36,0.65)] font-bold'
    : disabled
      ? 'border border-white/5 bg-zinc-800/50 text-zinc-500 font-bold'
      : subtle
        ? // Far-from-lock cards: quieter weight + border so five identical
          // pills stop competing — the soonest match's pill leads the scan.
          'border border-dashed border-zinc-700 bg-transparent font-semibold text-zinc-300 hover:border-zinc-500 hover:bg-white/5 active:bg-white/10'
        : 'border border-dashed border-zinc-600 bg-transparent font-bold text-zinc-300 hover:border-zinc-500 hover:bg-white/5 active:bg-white/10';
  // The bolt stays the single amber accent on the unarmed pill.
  const boltTone = !boosted && !disabled ? 'text-amber-300' : '';

  return (
    <div className="flex flex-col items-end">
      <button
        data-testid="booster-toggle"
        type="button"
        aria-pressed={boosted}
        aria-label={boosted ? undefined : `Arm booster ×${multiplier}`}
        disabled={disabled || busy}
        onClick={activate}
        // Invisible hit-area expansion: the pill stays ~26px tall but the
        // tappable surface clears the 44px floor — this is the most
        // consequential single tap on the board (×2 your day).
        className={`-mx-2.5 -my-3 shrink-0 rounded-full px-2.5 py-3 transition-transform duration-200 focus-visible:outline-none focus-visible:ring-2 active:scale-[.96] disabled:cursor-not-allowed ${
          boosted
            ? 'focus-visible:ring-amber-400/70'
            : 'focus-visible:ring-emerald-400/60'
        }`}
      >
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] tabular-nums transition-colors duration-200 ${tone}`}
        >
          <svg
            viewBox="0 0 24 24"
            className={`h-3 w-3 ${boltTone}`}
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2Z" />
          </svg>
          {boosted
            ? `Booster ×${multiplier} active`
            : busy
              ? 'Arming…'
              : `Boost ×${multiplier}`}
        </span>
      </button>
      {error && <p className="mt-1 text-xs text-brand-bright">{error}</p>}
    </div>
  );
}
