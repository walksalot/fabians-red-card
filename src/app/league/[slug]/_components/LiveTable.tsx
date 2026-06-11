'use client';

import { useEffect, useState } from 'react';
import { formatCents, formatPoints, ordinal } from './format';
import type { LeaderboardRowView, PrizePoolView } from './types';

interface Props {
  slug: string;
  initialRows: LeaderboardRowView[];
  initialPool: PrizePoolView;
  initialMemberCount: number;
  buyInCents: number;
  currency: string;
}

const POLL_MS = 30_000;

/** Server-rendered leaderboard that re-fetches every 30s while the tab is visible. */
export default function LiveTable({
  slug,
  initialRows,
  initialPool,
  initialMemberCount,
  buyInCents,
  currency,
}: Props) {
  const [rows, setRows] = useState(initialRows);
  const [pool, setPool] = useState(initialPool);
  const [memberCount, setMemberCount] = useState(initialMemberCount);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(
          `/api/leagues/${encodeURIComponent(slug)}/leaderboard`,
          { cache: 'no-store' },
        );
        const json: {
          ok: boolean;
          data?: {
            rows: LeaderboardRowView[];
            prizePool: PrizePoolView;
            memberCount: number;
          };
        } | null = await res.json().catch(() => null);
        if (!cancelled && json?.ok && json.data) {
          setRows(json.data.rows);
          setPool(json.data.prizePool);
          setMemberCount(json.data.memberCount);
        }
      } catch {
        // Network blip — keep showing the last good data.
      }
    };

    const start = () => {
      if (timer === null) timer = setInterval(load, POLL_MS);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void load();
        start();
      } else {
        stop();
      }
    };

    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [slug]);

  return (
    <div className="space-y-4">
      <div
        data-testid="prize-pool"
        className="rounded-xl border border-zinc-800 bg-zinc-900 p-4"
      >
        <h2 className="text-sm font-semibold text-zinc-400">Prize pool</h2>
        <p className="mt-1 text-3xl font-bold text-emerald-400">
          {formatCents(pool.totalCents, currency)}
        </p>
        <p className="mt-1 text-sm text-zinc-400">
          Buy-in {formatCents(buyInCents, currency)} per entry ·{' '}
          <span data-testid="member-count">{memberCount}</span> members
        </p>
        {pool.payouts.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-sm text-zinc-300">
            {pool.payouts.map((p) => (
              <li key={p.place}>
                {ordinal(p.place)} place — {p.percent}% (
                {formatCents(p.amountCents, currency)})
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
        <div className="grid grid-cols-[2.5rem_1fr_3.5rem_2.5rem_2.5rem] gap-1 border-b border-zinc-800 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          <span>#</span>
          <span>Entry</span>
          <span className="text-right">Pts</span>
          <span className="text-right" title="Exact scores">
            EX
          </span>
          <span className="text-right" title="Scorer hits">
            GS
          </span>
        </div>
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-zinc-500">
            No entries yet.
          </p>
        ) : (
          rows.map((r) => (
            <div
              key={r.entryId}
              data-testid="leaderboard-row"
              className="grid grid-cols-[2.5rem_1fr_3.5rem_2.5rem_2.5rem] items-center gap-1 border-b border-zinc-800/60 px-4 py-2.5 text-sm last:border-b-0"
            >
              <span className="font-semibold text-zinc-400">{r.rank}</span>
              <span className="truncate font-medium">{r.label}</span>
              <span className="text-right font-bold text-emerald-400">
                {formatPoints(r.total)}
              </span>
              <span className="text-right text-zinc-300">{r.exactCount}</span>
              <span className="text-right text-zinc-300">{r.scorerHits}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
