'use client';

import { useState } from 'react';

/**
 * "Who picked what" — the post-kickoff reveal on a match card. Collapsed by
 * default; the panel lazy-fetches on first expand (the payload exists only
 * for kicked-off matches — the server 403s before kickoff by design, so
 * nothing here can ever leak an open pick). Groups the league by scoreline,
 * biggest camp first; exact camps go emerald at full time.
 */

interface RevealRow {
  entryId: number;
  label: string;
  predHome: number;
  predAway: number;
  predScorer: string | null;
  predFirstTeam: 'home' | 'away' | 'none' | null;
  boosted: boolean;
  total: number | null;
  exact: boolean;
}

interface RevealData {
  finished: boolean;
  rows: RevealRow[];
  exactCount: number;
}

function Bolt() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="inline-block h-3 w-3 align-[-1.5px] text-amber-300"
      fill="currentColor"
      aria-label="boosted"
      role="img"
    >
      <path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2Z" />
    </svg>
  );
}

export default function LeaguePicksReveal({
  slug,
  matchId,
  myEntryId,
}: {
  slug: string;
  matchId: number;
  myEntryId: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<RevealData | null>(null);
  // 'hidden' = the server's 403 (picks stay private until kickoff) — an
  // expected state, never dressed up as a transient network failure.
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'hidden'>('idle');

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && data === null && state !== 'loading') {
      setState('loading');
      try {
        const res = await fetch(
          `/api/leagues/${encodeURIComponent(slug)}/matches/${matchId}/picks`,
          { cache: 'no-store' },
        );
        const json: { ok: boolean; data?: RevealData } | null = await res
          .json()
          .catch(() => null);
        if (json?.ok && json.data) {
          setData(json.data);
          setState('idle');
        } else {
          setState(res.status === 403 ? 'hidden' : 'error');
        }
      } catch {
        setState('error');
      }
    }
  }

  // Group by scoreline, biggest camp first; stable label order inside.
  const groups = data
    ? [...data.rows
        .reduce((m, r) => {
          const k = `${r.predHome}–${r.predAway}`;
          const g = m.get(k) ?? [];
          g.push(r);
          m.set(k, g);
          return m;
        }, new Map<string, RevealRow[]>())
        .entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    : [];

  return (
    <div className="mt-3 border-t border-white/5 pt-3">
      <button
        type="button"
        data-testid={`league-picks-${matchId}`}
        aria-expanded={open}
        onClick={toggle}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-white/5 bg-black/25 px-3.5 py-2.5 text-left text-[13px] font-bold text-zinc-300 transition-colors hover:bg-black/40"
      >
        <span>League picks</span>
        <span
          aria-hidden="true"
          className={`text-zinc-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      {open ? (
        <div className="pt-1">
          {state === 'loading' ? (
            <p className="px-1 py-2 text-xs text-zinc-500">Loading picks…</p>
          ) : state === 'hidden' ? (
            <p className="px-1 py-2 text-xs text-zinc-500">
              Picks stay hidden until kickoff.
            </p>
          ) : state === 'error' ? (
            <p className="px-1 py-2 text-xs text-zinc-500">
              Couldn&apos;t load picks — try again in a moment.
            </p>
          ) : data ? (
            <>
              {data.finished && data.exactCount > 0 ? (
                <p className="mt-2 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-300">
                  {data.exactCount} of {data.rows.length} called the exact score
                </p>
              ) : null}
              {data.rows.length === 0 ? (
                <p className="px-1 py-2 text-xs text-zinc-500">
                  Nobody picked this match.
                </p>
              ) : (
                groups.map(([score, rows]) => {
                  const hit = data.finished && rows[0].exact;
                  const lone = rows.length === 1;
                  // Compact scorer summary: "Quiñones ×3 · Jiménez"
                  const scorerCounts = new Map<string, number>();
                  for (const r of rows) {
                    if (r.predScorer) {
                      scorerCounts.set(
                        r.predScorer,
                        (scorerCounts.get(r.predScorer) ?? 0) + 1,
                      );
                    }
                  }
                  const scorerMeta = [...scorerCounts.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([n, c]) => (c > 1 ? `${n} ×${c}` : n))
                    .join(' · ');
                  return (
                    <div key={score} className="mt-2.5">
                      <div className="flex items-start gap-2">
                        <span
                          className={`shrink-0 rounded-lg border px-2 py-0.5 text-[13px] font-extrabold tabular-nums ${
                            hit
                              ? 'border-emerald-400/40 bg-black/35 text-emerald-400'
                              : 'border-white/10 bg-black/35 text-zinc-200'
                          }`}
                        >
                          {score}
                        </span>
                        <span className="min-w-0 pt-0.5 text-xs leading-relaxed text-zinc-300">
                          {rows.map((r, i) => (
                            <span key={r.entryId}>
                              <span
                                className={
                                  r.entryId === myEntryId
                                    ? 'font-bold text-zinc-50'
                                    : lone
                                      ? 'font-semibold text-amber-300'
                                      : ''
                                }
                              >
                                {r.entryId === myEntryId ? 'You' : r.label}
                              </span>
                              {r.boosted ? <> <Bolt /></> : null}
                              {i < rows.length - 1 ? ', ' : ''}
                            </span>
                          ))}
                          {lone && !hit ? (
                            <span className="text-zinc-500"> — alone on it</span>
                          ) : null}
                        </span>
                      </div>
                      {scorerMeta ? (
                        <p className="ml-[52px] mt-0.5 text-[11px] text-zinc-500">
                          First scorer: {scorerMeta}
                        </p>
                      ) : null}
                    </div>
                  );
                })
              )}
              <p className="mt-3 text-center text-[10px] text-zinc-500">
                Picks unlock here the moment a match kicks off — never before.
              </p>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
