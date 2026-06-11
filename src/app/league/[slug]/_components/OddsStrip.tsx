'use client';

import { useState } from 'react';
import type { MatchOdds } from '@/lib/odds';
import { formatPct } from '@/lib/odds';
import { formatTimeEt } from './format';

/**
 * The betting-odds cheat sheet on an unlocked pick card. Quiet context, not a
 * betting module: leads with de-vigged win probabilities (the language casuals
 * read), tucks american odds + line movement behind a tap, names the source
 * with freshness, and never links anywhere.
 */
export default function OddsStrip({
  matchId,
  odds,
  homeCode,
  awayCode,
  homeName,
  awayName,
}: {
  matchId: number;
  odds: MatchOdds;
  homeCode: string | null;
  awayCode: string | null;
  homeName: string;
  awayName: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const home = homeCode ?? homeName;
  const away = awayCode ?? awayName;
  // Same fixed-ET treatment as the kickoff label on the card: SSR-safe and
  // never read as a different timezone than "10:00 PM ET" two lines up.
  const asOf = formatTimeEt(odds.updatedAtMs);
  // The favored side gets the brighter segment; everything stays neutral so
  // the strip never competes with emerald (points) / amber (booster) / red (live).
  const seg = (p: number, favored: boolean) =>
    `${favored ? 'bg-zinc-600/80 text-zinc-100' : 'bg-zinc-800/80 text-zinc-400'} flex items-center justify-center overflow-hidden whitespace-nowrap text-[10px] font-bold tabular-nums`;
  const maxProb = Math.max(odds.homeProb, odds.drawProb, odds.awayProb);

  return (
    <div data-testid={`odds-strip-${matchId}`} className="mt-2.5">
      <button
        type="button"
        data-testid="odds-expand"
        aria-expanded={expanded}
        aria-label="Betting odds cheat sheet"
        onClick={() => setExpanded((e) => !e)}
        className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 rounded-lg"
      >
        {/* divide-x keeps the draw|away edge visible even when both unfavored
            segments share the same neutral fill */}
        <span className="flex h-6 w-full divide-x divide-white/10 overflow-hidden rounded-lg ring-1 ring-inset ring-white/10">
          <span
            className={seg(odds.homeProb, odds.homeProb === maxProb)}
            style={{ width: `${odds.homeProb * 100}%` }}
          >
            {home} {formatPct(odds.homeProb)}
          </span>
          <span
            className={seg(odds.drawProb, false)}
            style={{ width: `${odds.drawProb * 100}%` }}
          >
            ✕ {formatPct(odds.drawProb)}
          </span>
          <span
            className={seg(odds.awayProb, odds.awayProb === maxProb)}
            style={{ width: `${odds.awayProb * 100}%` }}
          >
            {away} {formatPct(odds.awayProb)}
          </span>
        </span>
        <span className="mt-1 flex items-center justify-between text-[10px] text-zinc-500">
          <span>
            Odds: {odds.provider} via ESPN · as of {asOf}
            {odds.overUnder !== null ? ` · ~${odds.overUnder} goals` : ''}
          </span>
          <span className="text-zinc-400">{expanded ? 'less ▴' : 'details ▾'}</span>
        </span>
      </button>

      {expanded ? (
        <div
          data-testid="odds-details"
          className="mt-1.5 rounded-lg bg-zinc-950/60 px-3 py-2 text-[11px] ring-1 ring-inset ring-white/5"
        >
          <div className="grid grid-cols-3 gap-1 text-center tabular-nums">
            <div>
              <p className="text-zinc-500">{home} win</p>
              <p className="font-bold text-zinc-200">{odds.homeML}</p>
              {odds.openHomeML && odds.openHomeML !== odds.homeML ? (
                <p className="text-[10px] text-zinc-600">opened {odds.openHomeML}</p>
              ) : null}
            </div>
            <div>
              <p className="text-zinc-500">Draw</p>
              <p className="font-bold text-zinc-200">{odds.drawML}</p>
              {odds.openDrawML && odds.openDrawML !== odds.drawML ? (
                <p className="text-[10px] text-zinc-600">opened {odds.openDrawML}</p>
              ) : null}
            </div>
            <div>
              <p className="text-zinc-500">{away} win</p>
              <p className="font-bold text-zinc-200">{odds.awayML}</p>
              {odds.openAwayML && odds.openAwayML !== odds.awayML ? (
                <p className="text-[10px] text-zinc-600">opened {odds.openAwayML}</p>
              ) : null}
            </div>
          </div>
          {odds.overUnder !== null && odds.overOdds && odds.underOdds ? (
            <p className="mt-1.5 border-t border-white/5 pt-1.5 text-center text-zinc-500">
              Total goals: over {odds.overUnder} <span className="text-zinc-300">{odds.overOdds}</span>{' '}
              · under <span className="text-zinc-300">{odds.underOdds}</span>
            </p>
          ) : null}
          <p className="mt-1.5 text-center text-[10px] text-zinc-600">
            Context, not advice.
          </p>
        </div>
      ) : null}
    </div>
  );
}
