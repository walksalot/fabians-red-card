'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatMatchdayShort, formatPoints } from './format';

/**
 * Morning-after headline on Today: yesterday's day winner, tappable through
 * to the full wrap in History. Dismissible per matchday per phone — the
 * banner never nags twice about the same day.
 */
export default function WrapBanner({
  slug,
  matchday,
  winnerLabels,
  winnerPoints,
}: {
  slug: string;
  matchday: string;
  winnerLabels: string[];
  winnerPoints: number;
}) {
  const storageKey = `frc:wrapSeen:${slug}`;
  // Hidden until mount confirms this day hasn't been dismissed (no flash).
  const [show, setShow] = useState(false);
  useEffect(() => {
    const adoptDismissal = () => {
      try {
        setShow(localStorage.getItem(storageKey) !== matchday);
      } catch {
        setShow(true);
      }
    };
    adoptDismissal();
  }, [storageKey, matchday]);
  if (!show || winnerLabels.length === 0) return null;

  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem(storageKey, matchday);
    } catch {
      // storage unavailable — banner returns next load, harmless
    }
  };

  return (
    <div className="flex items-center gap-2.5 rounded-2xl border border-white/5 bg-zinc-900 py-2.5 pl-3.5 pr-1.5">
      <span aria-hidden="true" className="text-lg leading-none">
        🏆
      </span>
      <Link
        href={`/league/${slug}/history`}
        data-testid="wrap-banner"
        className="min-w-0 flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
      >
        {/* Names truncate, the number never does (shrink-0 sibling) — and 3+
            winners collapse to a count, echoing WrapCard's biggest-haul rule. */}
        <span className="flex min-w-0 items-baseline gap-1.5 text-[13px] font-semibold text-zinc-100">
          <span className="min-w-0 truncate">
            {winnerLabels.length <= 2
              ? `${winnerLabels.join(' & ')} ${winnerLabels.length > 1 ? 'shared' : 'won'}`
              : `${winnerLabels.length} shared`}{' '}
            {formatMatchdayShort(matchday)}
          </span>
          <span className="shrink-0 font-bold tabular-nums text-emerald-400">
            +{formatPoints(winnerPoints)}
          </span>
        </span>
        <span className="block text-[11px] text-zinc-400">
          Full wrap in History →
        </span>
      </Link>
      <button
        type="button"
        aria-label="Dismiss yesterday's wrap"
        onClick={dismiss}
        // before: pseudo-element pads the 36px circle to the ~44px tap floor
        // without growing the visual (DayNav's arrow recipe).
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 before:absolute before:-inset-1 before:content-[''] hover:bg-white/5 hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  );
}
