'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { MatchdaySummary } from '@/lib/services/today';
import { buildDayHref } from './day-href';
import { formatMatchday } from './format';
import { useSheetFocus } from './useSheetFocus';

/**
 * The day browser: ‹ › step through matchdays, tapping the date opens the
 * tournament-at-a-glance sheet (every remaining day with this entry's pick
 * progress and booster state). Today always lands on the current day; past
 * days live in History on purpose. An amber dot on the date control means the
 * NEXT matchday still has unpicked matches — the anti-zero radar.
 */
export default function DayNav({
  slug,
  viewedDay,
  currentDay,
  days,
  nextDayHasGaps,
}: {
  slug: string;
  viewedDay: string;
  currentDay: string;
  days: MatchdaySummary[];
  nextDayHasGaps: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  // aria-modal's other half: focus moves into the sheet on open and Tab
  // cycles inside it while open.
  useSheetFocus(open, sheetRef);

  // Escape closes the sheet and hands focus back to the date trigger — the
  // dialog declares aria-modal, so keyboard users rightly expect it.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const idx = days.findIndex((d) => d.matchday === viewedDay);
  const prev = idx > 0 ? days[idx - 1] : null;
  const next = idx >= 0 && idx < days.length - 1 ? days[idx + 1] : null;
  const isCurrent = viewedDay === currentDay;
  // The dot points at the matchday AFTER the current one — suppress it while
  // that very day is on screen (a nudge toward the page you're reading).
  const gapDay = days.find((d) => d.matchday > currentDay)?.matchday ?? null;
  const showGapDot = nextDayHasGaps && gapDay !== null && gapDay !== viewedDay;

  // Keep the rest of the query (e.g. ?entry= for multi-entry users) across
  // day navigation, mirroring EntrySwitcher.
  const dayHref = (day: string) =>
    buildDayHref(slug, day, currentDay, new URLSearchParams(searchParams));

  // before: pseudo-element pads the 36px circle's tap surface to ~44px
  // without growing the visual (the gap to the date trigger stays clear).
  const arrowCls =
    "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-zinc-300 ring-1 ring-inset ring-white/10 transition-colors before:absolute before:-inset-1 before:content-[''] hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 active:scale-95";

  return (
    <>
      <div className="flex items-center gap-1.5">
        {prev ? (
          <Link
            href={dayHref(prev.matchday)}
            aria-label={`Previous matchday, ${formatMatchday(prev.matchday)}`}
            data-testid="day-prev"
            className={arrowCls}
          >
            <Chevron dir="left" />
          </Link>
        ) : (
          <span aria-hidden="true" className={`${arrowCls} pointer-events-none opacity-30`}>
            <Chevron dir="left" />
          </span>
        )}
        <button
          type="button"
          data-testid="day-picker"
          aria-label="Choose a matchday"
          ref={triggerRef}
          onClick={() => setOpen(true)}
          className="relative min-w-0 flex-1 rounded-xl px-2 py-1 text-center transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
        >
          <span className="flex min-w-0 items-center justify-center gap-1.5">
            <span className="truncate font-display text-lg font-bold tracking-tight text-zinc-50">
              {formatMatchday(viewedDay)}
            </span>
            {/* Inline beside the date (not floated to the button's invisible
                corner) so the "unpicked matchday ahead" dot reads as attached
                to the day browser, never as a stray pixel in dead space. */}
            {showGapDot ? (
              <span
                data-testid="day-gap-dot"
                title="The next matchday still has unpicked matches"
                className="h-2 w-2 shrink-0 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]"
              />
            ) : null}
          </span>
          <span className="block text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            {isCurrent ? 'today · tap for all days' : 'future matchday · tap for all days'}
          </span>
        </button>
        {next ? (
          <Link
            href={dayHref(next.matchday)}
            aria-label={`Next matchday, ${formatMatchday(next.matchday)}`}
            data-testid="day-next"
            className={arrowCls}
          >
            <Chevron dir="right" />
          </Link>
        ) : (
          <span aria-hidden="true" className={`${arrowCls} pointer-events-none opacity-30`}>
            <Chevron dir="right" />
          </span>
        )}
      </div>

      {/* Portaled to <body>: the league template's persistent fade animation
          traps the page subtree in its own stacking context, so an in-tree
          sheet could never paint over the fixed z-50 tab bar — it used to
          cover the last matchday row. z-60 keeps the ordering explicit. */}
      {open ? (
        createPortal(
        <div
          ref={sheetRef}
          tabIndex={-1}
          className="fixed inset-0 z-[60] focus:outline-none"
          role="dialog"
          aria-modal="true"
          aria-label="Choose a matchday"
        >
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <div
            className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl border-t border-white/10 bg-zinc-950 px-4 pt-4 shadow-2xl animate-fade-slide-in"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.25rem)' }}
          >
            <div aria-hidden="true" className="mx-auto mb-4 h-1 w-10 rounded-full bg-zinc-700" />
            <h2 className="px-1 font-display text-xl font-bold">Matchdays</h2>
            <p className="mt-0.5 px-1 text-xs text-zinc-500">
              Pick any day ahead — picks stay editable until each kickoff.
            </p>
            <div className="mt-3 space-y-1.5" data-testid="day-list">
              {days.map((d) => {
                // Emerald once no FILLABLE gap remains — bracket placeholders
                // are excluded from the fraction (nobody can pick them) and
                // surface as a "· N TBD" tail instead.
                const complete = d.missingPickCount === 0;
                const active = d.matchday === viewedDay;
                return (
                  <button
                    key={d.matchday}
                    type="button"
                    data-testid={`day-row-${d.matchday}`}
                    onClick={() => {
                      setOpen(false);
                      router.push(dayHref(d.matchday));
                    }}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ring-1 ring-inset transition-colors ${
                      active
                        ? 'bg-zinc-800/80 ring-emerald-400/40'
                        : 'bg-zinc-900 ring-white/5 hover:bg-zinc-800/60'
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-zinc-100">
                        {formatMatchday(d.matchday)}
                        {d.matchday === currentDay ? (
                          <span className="ml-2 rounded bg-emerald-400/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-300">
                            today
                          </span>
                        ) : null}
                      </span>
                      <span className="block text-[11px] text-zinc-500">
                        {d.matchCount} {d.matchCount === 1 ? 'match' : 'matches'}
                        {d.boosterArmed ? (
                          <>
                            {' · '}
                            <Bolt /> booster armed
                          </>
                        ) : null}
                      </span>
                    </span>
                    {/* Bracket-pending days get a neutral TBD chip — amber is
                        "act now", and nobody can pick a placeholder match. */}
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ring-1 ring-inset ${
                        d.allTbd
                          ? 'bg-zinc-800/80 text-zinc-400 ring-white/10'
                          : complete
                            ? 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/25'
                            : 'bg-amber-400/10 text-amber-300 ring-amber-400/25'
                      }`}
                    >
                      {d.allTbd
                        ? 'TBD'
                        : `${d.pickedCount}/${d.pickableCount} picked${
                            d.tbdCount > 0 ? ` · ${d.tbdCount} TBD` : ''
                          }`}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 pb-1 text-center text-[11px] text-zinc-400">
              Finished days live in the History tab.
            </p>
          </div>
        </div>,
        document.body,
        )
      ) : null}
    </>
  );
}

/** The app's bolt glyph (BoosterButton's path) — emoji ⚡ stays out of the UI. */
function Bolt() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="inline-block h-3 w-3 align-[-1.5px] text-amber-300"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2Z" />
    </svg>
  );
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {dir === 'left' ? <path d="m15 6-6 6 6 6" /> : <path d="m9 6 6 6-6 6" />}
    </svg>
  );
}
