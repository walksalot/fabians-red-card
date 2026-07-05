'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSheetFocus } from './useSheetFocus';

interface Points {
  exact: number;
  outcome: number;
  scorer: number;
  firstTeam: number;
  underdog: number;
}

/**
 * One-tap, in-context scoring explainer — a bottom sheet on the Today board.
 * Answers the questions people actually ask mid-pick ("what does boost do?",
 * "is there a penalty for a wrong scorer?") without sending them to the Rules
 * tab. Values come from the league's live settings, never hardcoded.
 */
export default function HowItWorksSheet({
  points,
  boosterMultiplier,
  underdogPctMax,
}: {
  points: Points;
  boosterMultiplier: number;
  /** Auto-underdog win-chance ceiling as a whole percent (from UNDERDOG_PROB_MAX). */
  underdogPctMax: number;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  // aria-modal's other half: focus moves into the sheet on open and Tab
  // cycles inside it while open.
  useSheetFocus(open, sheetRef);

  // Escape closes the sheet and hands focus back to the trigger — the dialog
  // declares aria-modal, so keyboard users rightly expect it.
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

  const rows: Array<[string, string, string]> = [
    ['Exact score', `+${points.exact}`, 'Nail the scoreline exactly.'],
    ['Right result', `+${points.outcome}`, 'Right winner (or a draw), wrong score.'],
    ['First goalscorer', `+${points.scorer}`, 'Must be a player from the squad list — tap a name.'],
    ['First team to score', `+${points.firstTeam}`, '"No goals" counts if you call a 0–0.'],
    [
      'Underdog bonus',
      `+${points.underdog}`,
      `Back a flagged underdog (win chance ≤ ${underdogPctMax}%) to win — and they do.`,
    ],
  ];

  return (
    <>
      <button
        type="button"
        data-testid="how-it-works"
        ref={triggerRef}
        onClick={() => setOpen(true)}
        // before: pseudo-element expands the 28px pill's tap surface past the
        // 44px floor without growing the visual (BoosterButton's pattern).
        className="relative inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-zinc-900 px-2.5 text-[11px] font-semibold text-zinc-300 ring-1 ring-inset ring-white/10 transition-colors before:absolute before:inset-x-0 before:-inset-y-2 before:content-[''] hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9.5" />
          <path d="M9.5 9.2a2.6 2.6 0 1 1 3.4 2.5c-.8.3-.9.9-.9 1.8" />
          <path d="M12 17h.01" />
        </svg>
        How scoring works
      </button>

      {/* Portaled to <body>: the league template's persistent fade animation
          traps the page subtree in its own stacking context, so an in-tree
          sheet could never paint over the fixed z-50 tab bar / sticky header.
          z-60 keeps the ordering explicit. Open only ever flips on the
          client, so the portal target always exists. */}
      {open ? (
        createPortal(
        <div
          ref={sheetRef}
          tabIndex={-1}
          className="fixed inset-0 z-[60] focus:outline-none"
          role="dialog"
          aria-modal="true"
          aria-label="How scoring works"
        >
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <div
            className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl border-t border-white/10 bg-zinc-950 px-5 pt-4 shadow-2xl animate-fade-slide-in"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.25rem)' }}
          >
            <div aria-hidden="true" className="mx-auto mb-4 h-1 w-10 rounded-full bg-zinc-700" />
            <h2 className="font-display text-xl font-bold">How scoring works</h2>

            <div className="mt-4 overflow-hidden rounded-2xl bg-zinc-900 ring-1 ring-white/5">
              {rows.map(([label, pts, hint]) => (
                <div
                  key={label}
                  className="flex items-baseline gap-3 border-b border-white/5 px-4 py-2.5 last:border-b-0"
                >
                  <span className="w-7 shrink-0 text-right font-bold tabular-nums text-emerald-400">
                    {pts}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-zinc-100">{label}</span>
                    <span className="block text-xs text-zinc-500">{hint}</span>
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-3 rounded-2xl bg-amber-400/10 p-4 ring-1 ring-inset ring-amber-400/20">
              <p className="flex items-center gap-1.5 text-sm font-bold text-amber-300">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                  <path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2Z" />
                </svg>
                The daily booster — pure upside
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-zinc-300">
                Once per match day, tap <b>Boost ×{boosterMultiplier}</b>
                {' '}on one match to multiply whatever points you earn there. It can never
                cost you anything. Tap it again to remove it, or tap another
                match to move it — any time until your boosted match kicks off
                or has a result, then it&apos;s locked in for the day.
                Last-minute moves are fair game.
              </p>
            </div>

            <div className="mt-3 rounded-2xl bg-zinc-900 p-4 ring-1 ring-white/5">
              <p className="text-sm font-bold text-zinc-100">No penalties, ever</p>
              <p className="mt-1 text-[13px] leading-relaxed text-zinc-400">
                Wrong guesses score zero — never negative. Scorer and first-team
                picks are optional: leaving them blank just skips those points.
                Your scorer must be a player from the squad list — spelling,
                accents and capitals are forgiven, but bare last names
                don&apos;t count anymore.
              </p>
            </div>

            <div className="mt-3 rounded-2xl bg-zinc-900 p-4 ring-1 ring-white/5">
              <p className="text-sm font-bold text-zinc-100">Deadlines</p>
              <p className="mt-1 text-[13px] leading-relaxed text-zinc-400">
                Edit picks as often as you like until kickoff — editing never
                affects tiebreaks — then they lock automatically. Scores and
                the table update on their own during matches.
              </p>
            </div>

            <div className="mt-3 rounded-2xl bg-zinc-900 p-4 ring-1 ring-white/5">
              <p className="text-sm font-bold text-zinc-100">Tied?</p>
              <p className="mt-1 text-[13px] leading-relaxed text-zinc-400">
                Most total points, then most exact scores, then most
                first-goalscorer hits, then most correct outcomes
                (win/draw/loss). Still level after all four? Genuine tie — you
                share the spot and split its prize money.
              </p>
            </div>

            <p className="mt-3 text-center text-xs text-zinc-500">
              Payouts, tiebreakers and the fine print live in the Rules tab.
            </p>
          </div>
        </div>,
        document.body,
        )
      ) : null}
    </>
  );
}
