'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { RedCardMark } from '@/components/Brand';
import EmptyState from '@/components/EmptyState';
import Monogram from '@/components/Monogram';
import { CHIP_TONES, breakdownChips } from './breakdown-chips';
import { codeToFlagEmoji, shortTeamName } from './flags';
import {
  MEDAL_TONES,
  formatCents,
  formatMatchdayShort,
  formatPoints,
  ordinal,
} from './format';
import { lastPlaceRank } from './standings-display';
import type {
  LeaderboardRowView,
  LockedPickView,
  PrizePoolView,
} from './types';

interface Props {
  slug: string;
  initialRows: LeaderboardRowView[];
  initialPool: PrizePoolView;
  initialMemberCount: number;
  initialEntryCount: number;
  buyInCents: number;
  currency: string;
  /** Signed-in user's id — highlights their row(s). */
  meUserId: number;
}

const POLL_MS = 30_000;

// Podium rows (1-3) get a faint medal-toned row tint + inset left edge — the
// same treatment in gold, silver and bronze so the top zone reads as a podium.
// (Medal chip tones live in ./format, shared with payouts and the header.)
const PODIUM_ROW_TONES: Record<number, string> = {
  1: 'bg-amber-300/[0.04] shadow-[inset_2px_0_0_0_rgba(252,211,77,0.6)]',
  2: 'bg-slate-300/[0.05] shadow-[inset_2px_0_0_0_rgba(203,213,225,0.55)]',
  3: 'bg-orange-400/[0.04] shadow-[inset_2px_0_0_0_rgba(251,146,60,0.55)]',
};

function RankBadge({ rank }: { rank: number }) {
  const medal = MEDAL_TONES[rank];
  if (medal) {
    return (
      <span
        className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-extrabold tabular-nums ring-1 ring-inset ${medal}`}
      >
        {rank}
      </span>
    );
  }
  return (
    <span className="flex h-6 w-6 items-center justify-center text-sm font-semibold tabular-nums text-zinc-400">
      {rank}
    </span>
  );
}

/** ▲ / ▼ movement since the user's previous visit; silent at rest. */
function RankDelta({ delta }: { delta: number | null }) {
  if (delta === null || delta === 0) {
    // No movement → no glyph. An empty spacer keeps the columns aligned
    // without rendering a wall of dead dashes.
    return <span aria-hidden="true" className="w-2" />;
  }
  const up = delta > 0;
  return (
    <span
      title={`${up ? 'Up' : 'Down'} ${Math.abs(delta)} since your last visit`}
      className={`w-2 text-center text-[10px] font-bold ${
        up ? 'text-emerald-400' : 'text-brand-bright'
      }`}
    >
      {up ? '▲' : '▼'}
    </span>
  );
}

/**
 * One-line race summary for the signed-in user — the table's emotional hook.
 * Derived from the live rows in state, so it updates with every poll.
 */
function RaceSummary({
  rows,
  meUserId,
}: {
  rows: LeaderboardRowView[];
  meUserId: number;
}) {
  if (rows.length < 2) return null;
  // Rows arrive rank-ordered; the user's best entry is their race position.
  const mine = rows.find((r) => r.userId === meUserId);
  if (!mine) return null;
  const leader = rows[0];
  const isLeader = mine.entryId === leader.entryId;
  const rival = isLeader
    ? rows.find((r) => r.entryId !== mine.entryId)
    : leader;
  if (!rival) return null;
  const gap = isLeader ? mine.total - rival.total : leader.total - mine.total;
  const unit = gap === 1 ? 'pt' : 'pts';
  return (
    <div
      className={`flex items-center gap-1.5 border-b border-white/5 px-4 py-2 text-xs font-semibold ${
        isLeader ? 'bg-emerald-400/[0.05] text-emerald-300' : 'text-zinc-300'
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        className={`h-3.5 w-3.5 shrink-0 ${isLeader ? '' : 'text-amber-300'}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {isLeader ? (
          // Crown — you're on top.
          <path d="m4 8 4 3.5L12 5l4 6.5L20 8l-1.5 9.5h-13L4 8Z" />
        ) : (
          // Chasing arrow — points still to claw back.
          <path d="M7 17 17 7M9.5 7H17v7.5" />
        )}
      </svg>
      <span className="min-w-0 truncate">
        {isLeader ? (
          gap > 0 ? (
            <>
              You lead by{' '}
              <span className="tabular-nums">{formatPoints(gap)}</span> {unit}
            </>
          ) : mine.rank === rival.rank ? (
            // Same rank = dead level on EVERY tiebreaker — nothing left to
            // separate you, so an end like this splits the prize.
            <>
              Dead level with {rival.label} on every tiebreaker — end like
              this and you split the prize
            </>
          ) : (
            <>Tied at the top with {rival.label} — tiebreakers decide</>
          )
        ) : gap > 0 ? (
          <>
            <span className="tabular-nums">{formatPoints(gap)}</span> {unit}{' '}
            behind {leader.label}
          </>
        ) : (
          <>Level with {leader.label} — tiebreakers decide</>
        )}
      </span>
    </div>
  );
}

/** Shared grid template — header and rows must stay in lockstep.
    The fixed columns are squeezed to their content (rank 36px, 28px avatar,
    numbers) so the 1fr ENTRY cell keeps full first names readable down to
    360px — "Paula" must never render as "P..". */
const ROW_GRID =
  'grid grid-cols-[2.25rem_2rem_1fr_2.25rem_1.75rem_1.75rem] items-center gap-1.5';

/**
 * One locked/finished fixture inside an expanded row: compact fixture lockup,
 * the entry's ticket-stub pick, and the points story — the same visual
 * language as Today/History, compressed to a table detail line.
 */
function LockedPickLine({ lp }: { lp: LockedPickView }) {
  const finished = lp.status === 'finished';
  const live = !finished && lp.liveStatus === 'in';
  const score = finished
    ? `${lp.homeScore}–${lp.awayScore}`
    : live
      ? `${lp.liveHome ?? 0}–${lp.liveAway ?? 0}`
      : null;
  // History's result-quality tint on the pick stub: emerald exact, amber
  // outcome, muted miss — readable at a glance without reading the chips.
  const stubTone =
    finished && lp.points?.breakdown
      ? lp.points.breakdown.exact > 0
        ? 'text-emerald-400'
        : lp.points.breakdown.outcome > 0
          ? 'text-amber-300'
          : 'text-zinc-400'
      : 'text-zinc-100';
  const chips =
    finished && lp.points?.breakdown ? breakdownChips(lp.points.breakdown) : [];
  return (
    <div className="border-t border-white/5 py-2 first:border-t-0">
      <div className="flex items-center gap-2">
        <span className="flex min-w-0 flex-1 items-center gap-1 text-xs">
          <span aria-hidden="true" className="shrink-0 leading-none">
            {codeToFlagEmoji(lp.homeCode) ?? ''}
          </span>
          <span
            title={lp.homeName}
            className="shrink-0 font-semibold text-zinc-300"
          >
            {lp.homeCode ?? shortTeamName(lp.homeName)}
          </span>
          <span
            className={`shrink-0 font-bold tabular-nums ${
              live ? 'text-brand-bright' : 'text-zinc-200'
            }`}
          >
            {score ?? 'v'}
          </span>
          <span
            title={lp.awayName}
            className="shrink-0 font-semibold text-zinc-300"
          >
            {lp.awayCode ?? shortTeamName(lp.awayName)}
          </span>
          <span aria-hidden="true" className="shrink-0 leading-none">
            {codeToFlagEmoji(lp.awayCode) ?? ''}
          </span>
          <span className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            {finished ? 'FT' : live ? 'Live' : 'Locked'}
          </span>
        </span>
        {lp.pick ? (
          // The ticket-stub pick chip — same recipe as Today/History, sized down.
          <span
            className={`shrink-0 rounded-md bg-zinc-950/60 px-2 py-0.5 text-sm font-extrabold tabular-nums tracking-tight ring-1 ring-inset ring-white/10 ${stubTone}`}
          >
            {lp.pick.predHome}–{lp.pick.predAway}
          </span>
        ) : (
          <span className="shrink-0 text-[11px] font-medium text-zinc-500">
            No pick
          </span>
        )}
        {finished ? (
          <span
            className={`w-9 shrink-0 text-right text-xs font-bold tabular-nums ${
              lp.points && lp.points.total > 0
                ? 'text-emerald-400'
                : 'text-zinc-500'
            }`}
          >
            {lp.points && lp.points.total > 0
              ? `+${formatPoints(lp.points.total)}`
              : '0'}
          </span>
        ) : null}
      </div>
      {lp.pick?.predScorer ? (
        <p className="mt-0.5 truncate text-[11px] text-zinc-500">
          Scorer: <span className="text-zinc-400">{lp.pick.predScorer}</span>
        </p>
      ) : null}
      {chips.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {chips.map((chip) => (
            <span
              key={chip.label}
              className={`chip ring-1 ring-inset ${CHIP_TONES[chip.tone]}`}
            >
              {chip.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Collapsible per-entry detail: that entry's picks on the current matchday's
 * locked/finished matches (the server never sends open picks). Grid-rows
 * animation keeps the height change smooth without measuring.
 */
function LockedPicksPanel({
  open,
  label,
  picks,
}: {
  open: boolean;
  label: string;
  picks: LockedPickView[];
}) {
  return (
    <div
      aria-hidden={!open}
      className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
        open ? 'grid-rows-[1fr] border-b border-white/5 last:border-b-0' : 'grid-rows-[0fr]'
      }`}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="bg-zinc-950/40 px-4 pb-2.5 pt-2">
          {/* Name the actual matchday — these are often yesterday's finished
              matches, so "today's" read as a contradiction every morning. */}
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            {label} · locked picks
            {picks.length > 0 ? ` · ${formatMatchdayShort(picks[0].matchday)}` : ''}
          </p>
          {picks.length === 0 ? (
            <p className="py-2 text-xs text-zinc-500">
              Nothing locked yet — picks reveal at kickoff.
            </p>
          ) : (
            <div className="mt-1">
              {picks.map((lp) => (
                <LockedPickLine key={lp.matchId} lp={lp} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Friendly easter egg: the league's red card sits with last place. */
function LastPlaceCard() {
  return (
    <span
      aria-hidden="true"
      title="Holding the red card"
      className="ml-1 inline-block h-3 w-2.5 shrink-0 rotate-6 rounded-[2px] bg-gradient-to-br from-brand-bright to-brand-deep"
    />
  );
}

/** Server-rendered leaderboard that re-fetches every 30s while the tab is visible. */
export default function LiveTable({
  slug,
  initialRows,
  initialPool,
  initialMemberCount,
  initialEntryCount,
  buyInCents,
  currency,
  meUserId,
}: Props) {
  const [rows, setRows] = useState(initialRows);
  const [pool, setPool] = useState(initialPool);
  const [memberCount, setMemberCount] = useState(initialMemberCount);
  const [entryCount, setEntryCount] = useState(initialEntryCount);
  // ▲/▼ baseline: the ranks from the user's PREVIOUS visit (persisted per
  // league in localStorage), so movement shows the morning after results land
  // — not only during a live poll. Falls back to this visit's ranks.
  const storageKey = `frc:ranks:${slug}`;
  const [baselineRanks, setBaselineRanks] = useState(
    () => new Map(initialRows.map((r) => [r.entryId, r.rank])),
  );
  useEffect(() => {
    // Read the last visit's snapshot once on mount; the write effect below
    // then immediately replaces it with today's ranks for next time.
    const adoptStoredBaseline = () => {
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return;
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return;
        const next = new Map<number, number>();
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          const id = Number(k);
          if (Number.isInteger(id) && typeof v === 'number' && Number.isFinite(v)) {
            next.set(id, v);
          }
        }
        if (next.size > 0) setBaselineRanks(next);
      } catch {
        // Unreadable snapshot — keep this visit's ranks as the baseline.
      }
    };
    adoptStoredBaseline();
  }, [storageKey]);
  useEffect(() => {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify(Object.fromEntries(rows.map((r) => [r.entryId, r.rank]))),
      );
    } catch {
      // Storage unavailable (private mode/quota) — arrows just stay session-only.
    }
  }, [rows, storageKey]);
  // Last seen totals — a change on a poll re-keys the row to flash it.
  const prevTotals = useRef<Map<number, number>>(
    new Map(initialRows.map((r) => [r.entryId, r.total])),
  );
  const [flashSeq, setFlashSeq] = useState<Record<number, number>>({});
  // Expanded rows (entryId → open) — survives the flash re-key and polls.
  const [openRows, setOpenRows] = useState<Record<number, boolean>>({});

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
            entryCount: number;
          };
        } | null = await res.json().catch(() => null);
        if (!cancelled && json?.ok && json.data) {
          const next = json.data.rows;
          // Flash any row whose points moved since the last poll.
          const changed: number[] = [];
          for (const row of next) {
            const prev = prevTotals.current.get(row.entryId);
            if (prev !== undefined && prev !== row.total) {
              changed.push(row.entryId);
            }
            prevTotals.current.set(row.entryId, row.total);
          }
          if (changed.length > 0) {
            setFlashSeq((s) => {
              const bumped = { ...s };
              for (const id of changed) bumped[id] = (bumped[id] ?? 0) + 1;
              return bumped;
            });
          }
          setRows(next);
          setPool(json.data.prizePool);
          setMemberCount(json.data.memberCount);
          setEntryCount(json.data.entryCount);
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

  // Red card only when a genuine bottom group exists — a full tie has no last
  // place (and no card). Duplicate ranks elsewhere are fine: RankBadge and
  // PODIUM_ROW_TONES are plain rank lookups, so a 1-1-3 tie renders two gold
  // rows by design.
  const lastRank = lastPlaceRank(rows);

  return (
    <div className="space-y-4">
      <div
        data-testid="prize-pool"
        className="card relative animate-fade-slide-in overflow-hidden p-4"
      >
        {/* Same rotated red-card watermark as the Profile hero — the brand
            motif anchors the table's hero card, not just the easter egg. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-5 -top-7 opacity-[0.08]"
        >
          <RedCardMark className="h-36 w-36 rotate-[14deg]" />
        </div>
        <div className="relative">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
            Prize pool
          </h2>
          {buyInCents === 0 ? (
            // No buy-in configured — a hero "$0" with $0/$0/$0 payout pills
            // reads as a calculation bug, not a free league. State it plainly,
            // in member-facing words (the Rules page's framing), never
            // admin-speak like "no buy-in set".
            <p className="mt-1 text-sm text-zinc-300">
              Free league — playing for bragging rights ·{' '}
              <span data-testid="member-count">{memberCount}</span> members
              {/* Members without an entry never appear in the rows below —
                  name the entry count too whenever the denominators differ,
                  so "3 members" can't contradict a 2-row table. */}
              {entryCount !== memberCount ? (
                <>
                  {' '}
                  · {entryCount} {entryCount === 1 ? 'entry' : 'entries'}
                </>
              ) : null}
            </p>
          ) : (
            <>
              <p className="mt-1 font-display text-3xl font-bold tabular-nums tracking-tight text-emerald-400">
                {formatCents(pool.totalCents, currency)}
              </p>
              <p className="mt-1 text-sm text-zinc-400">
                Buy-in {formatCents(buyInCents, currency)} per entry ·{' '}
                <span data-testid="member-count">{memberCount}</span> members
                {/* The pool multiplies ENTRIES (see buy-in copy above), so
                    when members ≠ entries the total would visibly disagree
                    with buy-in × members — name both denominators. */}
                {entryCount !== memberCount ? (
                  <>
                    {' '}
                    · {entryCount} {entryCount === 1 ? 'entry' : 'entries'}
                  </>
                ) : null}
              </p>
              {pool.payouts.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {pool.payouts.map((p) => (
                    <span
                      key={p.place}
                      className={`chip ring-1 ring-inset ${
                        MEDAL_TONES[p.place] ??
                        'bg-zinc-800/80 text-zinc-300 ring-white/10'
                      }`}
                    >
                      {ordinal(p.place)} {formatCents(p.amountCents, currency)}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div
        className="card animate-fade-slide-in overflow-hidden"
        style={{ animationDelay: '80ms' }}
      >
        <RaceSummary rows={rows} meUserId={meUserId} />
        <div
          className={`${ROW_GRID} border-b border-white/5 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400`}
        >
          <span>#</span>
          <span />
          <span>Entry</span>
          <span className="text-right">Pts</span>
          {/* Compact two-letter heads (the live board's vocabulary) keep the
              ENTRY column wide enough for real names at 360-390px; title
              hints keep the long-form meaning on press-and-hold. */}
          <span className="text-right" title="Exact scorelines hit">
            EX
          </span>
          <span className="text-right" title="First goalscorers hit">
            GS
          </span>
        </div>
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No entries yet"
              sub="The table fills as your friends join and picks land."
            />
          </div>
        ) : (
          rows.map((r, i) => {
            const isMe = r.userId === meUserId;
            const baseline = baselineRanks.get(r.entryId);
            const delta = baseline === undefined ? null : baseline - r.rank;
            const flashes = flashSeq[r.entryId] ?? 0;
            const open = openRows[r.entryId] === true;
            // Podium → field boundary: a gradient hairline closes the medal
            // zone before the first non-podium row.
            const podiumBreak = i > 0 && r.rank > 3 && rows[i - 1].rank <= 3;
            return (
              // Re-keying on a points change restarts the flash animation.
              <Fragment key={`${r.entryId}:${flashes}`}>
                {podiumBreak ? (
                  <div
                    aria-hidden="true"
                    className="-mt-px h-px bg-gradient-to-r from-amber-300/30 via-white/10 to-transparent"
                  />
                ) : null}
                {/* Tappable row → reveals this entry's locked picks below. */}
                <button
                  type="button"
                  data-testid="leaderboard-row"
                  aria-expanded={open}
                  onClick={() =>
                    setOpenRows((s) => ({ ...s, [r.entryId]: !open }))
                  }
                  className={`${ROW_GRID} min-h-11 w-full px-4 py-2.5 text-left text-sm transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400/60 ${
                    // The hairline moves to the panel when open; the final
                    // row's edge is the card edge (the panel is :last-child).
                    open || i === rows.length - 1
                      ? ''
                      : 'border-b border-white/5'
                  } ${flashes > 0 ? 'animate-row-flash' : ''} ${
                    isMe
                      ? 'bg-emerald-400/5 shadow-[inset_2px_0_0_0_var(--color-accent)]'
                      : (PODIUM_ROW_TONES[r.rank] ?? '')
                  }`}
                >
                  <span className="flex items-center gap-1">
                    <RankBadge rank={r.rank} />
                    <RankDelta delta={delta} />
                  </span>
                  {/* Emerald ring on your own monogram — instant self-location. */}
                  <Monogram
                    name={r.label}
                    className={isMe ? 'ring-2 ring-emerald-400/40' : ''}
                  />
                  <span className="flex min-w-0 items-center gap-1.5">
                    {/* No "You" pill: the emerald row tint, inset edge,
                        monogram ring and emerald total already mark the row,
                        and the pill was what crushed short names to "P.." at
                        390px. */}
                    <span className="truncate font-semibold text-zinc-100">
                      {r.label}
                    </span>
                    {lastRank !== null && r.rank === lastRank ? (
                      <LastPlaceCard />
                    ) : null}
                    {/* Disclosure cue — rotates when the picks panel is open. */}
                    <svg
                      viewBox="0 0 24 24"
                      className={`h-3 w-3 shrink-0 text-zinc-500 transition-transform duration-200 ${
                        open ? 'rotate-180' : ''
                      }`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </span>
                  <span className="flex flex-col items-end">
                    {/* One metric, one color: neutral zinc for everyone (the
                        medal system lives in the rank badge + row tint), with
                        emerald reserved for the signed-in user's own total. */}
                    <span
                      data-testid="row-total"
                      className={`text-right text-base font-extrabold tabular-nums tracking-tight ${
                        isMe ? 'text-emerald-400' : 'text-zinc-200'
                      }`}
                    >
                      {formatPoints(r.total)}
                    </span>
                    {/* Today's story under the season total: an emerald "+N"
                        while a matchday is live/scoring, silent on dead days —
                        composes with the row flash + rank deltas as the race. */}
                    {r.todayPoints !== undefined && r.todayPoints > 0 ? (
                      <span
                        title="Points won today"
                        className="text-[10px] font-semibold leading-tight tabular-nums text-emerald-400/90"
                      >
                        +{formatPoints(r.todayPoints)}
                      </span>
                    ) : null}
                  </span>
                  <span
                    data-testid="row-exact"
                    className="text-right text-xs font-medium tabular-nums text-zinc-400"
                  >
                    {r.exactCount}
                  </span>
                  <span
                    data-testid="row-scorer"
                    className="text-right text-xs font-medium tabular-nums text-zinc-400"
                  >
                    {r.scorerHits}
                  </span>
                </button>
                <LockedPicksPanel
                  open={open}
                  label={r.label}
                  picks={r.lockedPicks ?? []}
                />
              </Fragment>
            );
          })
        )}
        {/* Decoder for the two-letter column heads — the first two
            tiebreakers; earliest lock-in (the third, per Rules) must be named
            too or two 0–0 columns can't explain a decided order. 11px
            zinc-400: 10px zinc-500 sat under the 4.5:1 contrast floor. */}
        <p className="border-t border-white/5 px-4 py-2 text-center text-[11px] font-medium text-zinc-400">
          EX exact scores · GS goalscorer hits · earliest locks — tiebreakers
          in this order
        </p>
      </div>
    </div>
  );
}
