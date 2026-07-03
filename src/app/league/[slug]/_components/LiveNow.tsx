'use client';

import { useEffect, useRef, useState } from 'react';
import type { LiveBoard } from '@/lib/services/live';
import { codeToFlagEmoji } from './flags';
import { formatPoints } from './format';

const POLL_MS = 20_000;

/**
 * "If it ended now" — live provisional standings for in-progress matches.
 * Mounted above Today and Table while a match is live; renders nothing
 * otherwise. Provisional numbers come from the real scoring engine run against
 * the live feed snapshot server-side; nothing here is banked until full time.
 */
export default function LiveNow({
  slug,
  initial,
}: {
  slug: string;
  initial: LiveBoard[];
}) {
  const [boards, setBoards] = useState<LiveBoard[]>(initial);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const failures = useRef(0);
  // GOAL detection: previous poll's goal totals per match. A poll that raises
  // a total bumps the flash counter, which re-keys the score span so the
  // goal-pop/goal-flash animations restart. First render never animates.
  const prevTotals = useRef<Map<number, number>>(
    new Map(initial.map((b) => [b.matchId, b.liveHome + b.liveAway])),
  );
  const [goalFlash, setGoalFlash] = useState<Record<number, number>>({});
  // Client clock for the freshness stamp — ticking state keeps render pure
  // (and hydration-safe: the stamp only appears after mount).
  const [nowVal, setNowVal] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNowVal(Date.now());
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(slug)}/live`, {
          cache: 'no-store',
        });
        const json: { ok: boolean; data?: { boards: LiveBoard[] } } | null = await res
          .json()
          .catch(() => null);
        if (!cancelled && json?.ok && json.data) {
          const fresh = json.data.boards;
          const bumps: number[] = [];
          for (const b of fresh) {
            const total = b.liveHome + b.liveAway;
            const prev = prevTotals.current.get(b.matchId);
            if (prev !== undefined && total > prev) bumps.push(b.matchId);
            prevTotals.current.set(b.matchId, total);
          }
          if (bumps.length > 0) {
            setGoalFlash((f) => {
              const next = { ...f };
              for (const id of bumps) next[id] = (next[id] ?? 0) + 1;
              return next;
            });
          }
          setBoards(fresh);
          failures.current = 0;
        }
      } catch {
        failures.current += 1; // keep last good data; polling continues
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
      } else stop();
    };
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [slug]);

  if (boards.length === 0) return null;

  return (
    <div className="space-y-2" data-testid="live-now">
      {boards.map((b) => {
        const expanded = open[b.matchId] ?? false;
        const flashKey = goalFlash[b.matchId] ?? 0;
        // Feed freshness for the caption line. Amber past ~3 minutes.
        const feedAgeMs =
          b.liveUpdatedAt !== null && nowVal !== null
            ? Math.max(0, nowVal - b.liveUpdatedAt)
            : null;
        const feedAgeLabel =
          feedAgeMs === null
            ? null
            : feedAgeMs < 60_000
              ? `${Math.max(5, Math.round(feedAgeMs / 5000) * 5)}s ago`
              : `${Math.round(feedAgeMs / 60_000)}m ago`;
        return (
          <div
            key={b.matchId}
            className="overflow-hidden rounded-2xl bg-zinc-900 ring-1 ring-inset ring-brand/30"
          >
            <button
              type="button"
              data-testid={`live-now-toggle-${b.matchId}`}
              aria-expanded={expanded}
              onClick={() => setOpen((o) => ({ ...o, [b.matchId]: !expanded }))}
              // key restarts the brand-red goal wash each time a goal lands
              key={`hdr-${flashKey}`}
              className={`flex min-h-12 w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-zinc-800/60 ${
                flashKey > 0 ? 'animate-goal-flash' : ''
              }`}
            >
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-zinc-100">
                  <span aria-hidden="true">{codeToFlagEmoji(b.homeCode) ?? ''}</span>{' '}
                  {b.homeCode ?? b.homeName}{' '}
                  <span
                    key={`score-${flashKey}`}
                    className={`inline-block font-display font-bold text-brand-bright tabular-nums ${
                      flashKey > 0 ? 'animate-goal-pop' : ''
                    }`}
                  >
                    {b.hasLiveData ? `${b.liveHome}–${b.liveAway}` : 'LIVE'}
                  </span>{' '}
                  {b.awayCode ?? b.awayName}{' '}
                  <span aria-hidden="true">{codeToFlagEmoji(b.awayCode) ?? ''}</span>
                  {b.liveClock ? (
                    // minutes accrued from the feed ("55'", "HT") — soccer
                    // counts up, so this reads as how deep into the game we are
                    <span
                      data-testid={`live-clock-${b.matchId}`}
                      className="ml-1.5 inline-block rounded-md bg-brand/15 px-1.5 py-0.5 align-middle text-[11px] font-bold tabular-nums text-brand-bright"
                    >
                      {b.liveClock}
                    </span>
                  ) : null}
                </span>
                <span className="block text-[11px] font-medium text-zinc-500">
                  Who&apos;s scoring right now — if it ended now
                  {feedAgeLabel ? (
                    <>
                      {' · '}
                      <span
                        className={
                          feedAgeMs !== null && feedAgeMs > 3 * 60_000
                            ? 'text-amber-300'
                            : undefined
                        }
                      >
                        updated {feedAgeLabel}
                      </span>
                    </>
                  ) : null}
                </span>
              </span>
              <svg
                viewBox="0 0 24 24"
                className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>

            {expanded ? (
              <div className="border-t border-white/5 px-3.5 pb-3 pt-2" data-testid={`live-board-${b.matchId}`}>
                {b.liveFirstScorer ? (
                  <p className="pb-1.5 text-[11px] text-zinc-500">
                    First goal: <span className="text-zinc-300">{b.liveFirstScorer}</span>
                  </p>
                ) : null}
                {!b.hasLiveData ? (
                  <p className="py-2 text-xs text-zinc-500">
                    Kicked off — waiting for the first feed update…
                  </p>
                ) : null}
                {b.rows.map((r, i) => (
                  <div
                    key={r.entryId}
                    data-testid="live-board-row"
                    className="flex items-center gap-2 border-b border-white/5 py-1.5 text-sm last:border-b-0"
                  >
                    <span className="w-5 shrink-0 text-right text-xs font-semibold tabular-nums text-zinc-500">
                      {r.pick ? i + 1 : '–'}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium text-zinc-200">
                      {r.label}
                      {r.boosted ? (
                        <span className="ml-1 text-[10px] font-bold text-amber-300">⚡×</span>
                      ) : null}
                    </span>
                    {r.pick ? (
                      <span className="shrink-0 rounded-md bg-zinc-950/60 px-1.5 py-0.5 text-xs font-bold tabular-nums text-zinc-300 ring-1 ring-inset ring-white/10">
                        {r.pick.predHome}–{r.pick.predAway}
                      </span>
                    ) : (
                      <span className="shrink-0 text-[11px] text-zinc-600">no pick</span>
                    )}
                    {r.breakdown ? (
                      // Chip discipline mirrors breakdown-chips.tsx: score
                      // components are emerald; amber stays the booster's, and
                      // brand red stays the live signal's.
                      <span className="flex shrink-0 gap-1 text-[10px] font-semibold">
                        {r.breakdown.exact > 0 ? <span className="text-emerald-400">EX</span> : null}
                        {r.breakdown.outcome > 0 ? <span className="text-emerald-400">W</span> : null}
                        {r.breakdown.scorer > 0 ? <span className="text-emerald-400">GS</span> : null}
                        {r.breakdown.firstTeam > 0 ? <span className="text-emerald-400">1st</span> : null}
                        {r.breakdown.underdog > 0 ? <span className="text-emerald-400">UD</span> : null}
                      </span>
                    ) : null}
                    <span
                      data-testid="live-board-total"
                      className={`w-10 shrink-0 text-right font-display font-bold tabular-nums ${
                        r.total > 0 ? 'text-emerald-400' : 'text-zinc-600'
                      }`}
                    >
                      {r.pick && b.hasLiveData ? `+${formatPoints(r.total)}` : '·'}
                    </span>
                  </div>
                ))}
                {/* One-line decoder for the compact component codes above —
                    they appear nowhere else spelled out mid-match. 11px
                    zinc-400, not 10px zinc-600: these lines carry meaning and
                    must clear the small-text contrast floor. */}
                {b.rows.some((r) => r.breakdown) ? (
                  <p className="pt-2 text-center text-[11px] text-zinc-400">
                    EX exact · W right result · GS goalscorer · 1st first team
                    · UD underdog
                  </p>
                ) : null}
                <p className="pt-2 text-center text-[11px] text-zinc-400">
                  Provisional — points bank at the final whistle.
                </p>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
