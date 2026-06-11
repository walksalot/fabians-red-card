'use client';

import { useRef, useState, type FormEvent } from 'react';
import { normalizeName } from '@/lib/scoring';
import { americanToProb } from '@/lib/odds';
import { codeToFlagEmoji } from './flags';
import type { FirstTeam, PickView } from './types';

interface Props {
  entryId: number;
  matchId: number;
  homeName: string;
  awayName: string;
  homeCode?: string | null;
  awayCode?: string | null;
  /** Squad names for the scorer picker; empty arrays fall back to free text only. */
  homeSquad?: string[];
  awaySquad?: string[];
  /** First-goalscorer odds by player name — sorts the picker by likelihood. */
  scorerOdds?: Record<string, string>;
  initial: PickView | null;
  /** Notifies the board a pick now exists server-side (drives card status marks). */
  onSaved?: () => void;
}

type Status = 'idle' | 'saving' | 'saved' | 'error';

/** Score bounds shared by the typed input and the steppers. */
const SCORE_MIN = 0;
const SCORE_MAX = 20;

function clampScore(n: number): number {
  return Math.min(SCORE_MAX, Math.max(SCORE_MIN, n));
}

/**
 * One-thumb − / + stepper flanking a score input — score entry is the app's
 * most-repeated action, so it must not require summoning the keyboard.
 * 44×48px targets; type="button" so taps never submit the form. Renders flat
 * (no own shape) — the ScoreField's segmented container carries the ring and
 * rounding, so the −/value/+ cluster reads as ONE control, not three chips.
 */
function StepButton({
  ariaLabel,
  glyph,
  disabled,
  onClick,
}: {
  ariaLabel: string;
  glyph: 'minus' | 'plus';
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className="flex h-12 w-11 shrink-0 items-center justify-center bg-transparent text-zinc-300 transition-colors duration-150 hover:bg-white/5 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400/60 active:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent disabled:active:bg-transparent"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        aria-hidden="true"
      >
        {glyph === 'plus' ? <path d="M12 5v14M5 12h14" /> : <path d="M5 12h14" />}
      </svg>
    </button>
  );
}

function ScoreField({
  testId,
  ariaLabel,
  value,
  onChange,
}: {
  testId: string;
  ariaLabel: string;
  value: string;
  onChange: (v: string) => void;
}) {
  // The fixture row directly above already shows flag, name and code — the
  // input itself stays caption-free to keep the card short.
  const parsed = Number.parseInt(value, 10);
  const current = Number.isNaN(parsed) ? null : parsed;
  // From an empty field, − lands on 0 (a deliberate "no goals" pick in one
  // tap) and + lands on 1; afterwards both step the clamped 0–20 value.
  const step = (delta: number) => {
    onChange(String(clampScore((current ?? (delta > 0 ? 0 : 1)) + delta)));
  };
  // One segmented control per side: a single ringed container holds −/value/+
  // with internal hairline dividers (border-x on the input). The container owns
  // the focus state via focus-within so the whole cluster lights up emerald.
  return (
    <div className="flex min-w-0 flex-1 items-stretch overflow-hidden rounded-xl bg-zinc-950/60 ring-1 ring-inset ring-white/10 transition-shadow focus-within:ring-emerald-400/50">
      <StepButton
        ariaLabel={`Decrease ${ariaLabel}`}
        glyph="minus"
        disabled={current !== null && current <= SCORE_MIN}
        onClick={() => step(-1)}
      />
      <input
        data-testid={testId}
        aria-label={ariaLabel}
        type="number"
        inputMode="numeric"
        min={SCORE_MIN}
        max={SCORE_MAX}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-12 w-full min-w-0 flex-1 border-x border-white/10 bg-transparent text-center text-2xl font-bold tabular-nums text-zinc-50 focus:outline-none"
      />
      <StepButton
        ariaLabel={`Increase ${ariaLabel}`}
        glyph="plus"
        disabled={current !== null && current >= SCORE_MAX}
        onClick={() => step(1)}
      />
    </div>
  );
}

/** Score + first goalscorer + first team to score inputs for one unlocked match. */
export default function PickForm({
  entryId,
  matchId,
  homeName,
  awayName,
  homeSquad = [],
  awaySquad = [],
  scorerOdds = {},
  homeCode,
  awayCode,
  initial,
  onSaved,
}: Props) {
  const [home, setHome] = useState(initial ? String(initial.predHome) : '');
  const [away, setAway] = useState(initial ? String(initial.predAway) : '');
  const [scorer, setScorer] = useState(initial?.predScorer ?? '');
  const [scorerOpen, setScorerOpen] = useState(false);
  const scorerBlurTimer = useRef<number | null>(null);
  const [firstTeam, setFirstTeam] = useState<'' | FirstTeam>(
    initial?.predFirstTeam ?? '',
  );
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  // A pick is stored server-side (pre-existing or saved this session) — drives
  // the quieter "Update pick" CTA so only un-picked matches scream solid green.
  const [hasSaved, setHasSaved] = useState(initial !== null);
  // Edited since the last confirmed save — any "Saved" signal must vanish.
  const [dirty, setDirty] = useState(false);
  // Saved picks compress the optional fields behind a one-line summary; the
  // Edit disclosure re-opens them without marking the form dirty.
  const [expandedByUser, setExpandedByUser] = useState(false);

  // Editing any field after a save invalidates the badge: 'Saved ✓' must only
  // ever describe the values currently in the form.
  function touch() {
    setDirty(true);
    if (status === 'saved') setStatus('idle');
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const predHome = Number(home);
    const predAway = Number(away);
    if (
      !Number.isInteger(predHome) ||
      !Number.isInteger(predAway) ||
      predHome < 0 ||
      predHome > 20 ||
      predAway < 0 ||
      predAway > 20
    ) {
      setStatus('error');
      setError('Scores must be whole numbers from 0 to 20.');
      return;
    }
    setError(null);
    // Never claim "Saved" before the server confirms — a killed request must not
    // look like a stored pick (phones lose connections; picks decide bragging rights).
    setStatus('saving');
    try {
      const res = await fetch('/api/picks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entryId,
          matchId,
          predHome,
          predAway,
          predScorer: scorer.trim() === '' ? null : scorer.trim(),
          predFirstTeam: firstTeam === '' ? null : firstTeam,
        }),
      });
      const json: { ok: boolean; error?: string } | null = await res
        .json()
        .catch(() => null);
      if (!json || !json.ok) {
        setStatus('error');
        setError(json?.error ?? 'Could not save your pick.');
      } else {
        setStatus('saved');
        setHasSaved(true);
        setDirty(false);
        // Fold the optional fields back into the one-line summary — the
        // collapsed row doubles as the save confirmation.
        setExpandedByUser(false);
        onSaved?.();
      }
    } catch {
      setStatus('error');
      setError('Network error — pick not saved.');
    }
  }

  const wideInputClass =
    'h-12 w-full rounded-xl border border-zinc-700 bg-zinc-950/60 px-4 text-sm text-zinc-100 transition-colors focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30';

  const homeFlag = codeToFlagEmoji(homeCode);
  const awayFlag = codeToFlagEmoji(awayCode);

  // Saved + untouched → compact card: scores stay visible (core interaction),
  // the optional scorer/first-team fields and the submit button fold behind a
  // one-line summary. The fields stay mounted (CSS-hidden) so values persist.
  const collapsed =
    hasSaved &&
    !dirty &&
    !expandedByUser &&
    (status === 'idle' || status === 'saved');

  const firstTeamLabel =
    firstTeam === ''
      ? null
      : firstTeam === 'none'
        ? 'No goals'
        : firstTeam === 'home'
          ? homeName
          : awayName;

  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-2.5">
      {/* [−|input|+] – [−|input|+]: two segmented controls (the flags + codes
          in the fixture row directly above already label each side), a wide
          gap between the clusters and a demoted dash so the center never reads
          as a third stepper. Inputs flex so the row fits 360–390px. */}
      <div className="flex items-center justify-center gap-3">
        <ScoreField
          testId="pick-home"
          ariaLabel={`${homeName} goals`}
          value={home}
          onChange={(v) => {
            setHome(v);
            touch();
          }}
        />
        <span aria-hidden="true" className="shrink-0 text-sm font-semibold text-zinc-600">
          –
        </span>
        <ScoreField
          testId="pick-away"
          ariaLabel={`${awayName} goals`}
          value={away}
          onChange={(v) => {
            setAway(v);
            touch();
          }}
        />
      </div>
      {collapsed ? (
        // One-line saved summary — tap to disclose the optional fields again.
        // Rendered only at rest so "Saved" copy disappears the moment a field
        // is touched (the badge may only describe the values in the form).
        <button
          type="button"
          onClick={() => setExpandedByUser(true)}
          className="flex h-11 w-full items-center justify-between gap-2 rounded-xl bg-zinc-950/40 px-3 text-left ring-1 ring-inset ring-white/5 transition-colors hover:bg-zinc-950/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 active:bg-zinc-950/70"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span
              className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300 ring-1 ring-inset ring-emerald-400/25 ${
                status === 'saved' ? 'animate-pop-in' : ''
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-3 w-3"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4.5 12.5 10 18 19.5 6.5" />
              </svg>
              Saved
            </span>
            {/* Only the segments that exist — a bare "—" reads like broken data. */}
            <span className="truncate text-xs text-zinc-400">
              {scorer.trim() !== '' || firstTeamLabel ? (
                <>
                  {scorer.trim() !== '' ? (
                    <>
                      Scorer:{' '}
                      <span className="text-zinc-200">{scorer.trim()}</span>
                    </>
                  ) : null}
                  {scorer.trim() !== '' && firstTeamLabel ? ' · ' : null}
                  {firstTeamLabel ? (
                    <>
                      First:{' '}
                      <span className="text-zinc-200">{firstTeamLabel}</span>
                    </>
                  ) : null}
                </>
              ) : (
                'Score only'
              )}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-zinc-300">
            Edit
            <svg
              viewBox="0 0 24 24"
              className="h-3 w-3 text-zinc-500"
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
        </button>
      ) : null}
      {/* Optional fields + CTA: CSS-hidden (never unmounted) while collapsed so
          field values and e2e selectors survive the compact state. */}
      <div className={collapsed ? 'hidden' : 'animate-fade-slide-in space-y-2.5'}>
        <div>
          {/* Proper eyebrow (not placeholder-as-label) — symmetric with the
              first-team field below, and the +8 stays visible while typing. */}
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
            First goalscorer <span className="text-emerald-400">+8</span>
          </span>
          <div className="relative">
            <input
              data-testid="pick-scorer"
              aria-label="First goalscorer"
              type="text"
              autoComplete="off"
              placeholder="Tap to pick a player (optional)"
              value={scorer}
              role="combobox"
              aria-expanded={scorerOpen}
              aria-controls={`scorer-options-${matchId}`}
              onFocus={() => setScorerOpen(true)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setScorerOpen(false);
              }}
              onBlur={() => {
                // let an option tap land before the panel closes
                scorerBlurTimer.current = window.setTimeout(
                  () => setScorerOpen(false),
                  150,
                );
              }}
              onChange={(e) => {
                setScorer(e.target.value);
                setScorerOpen(true);
                touch();
              }}
              className={wideInputClass}
            />
            {scorerOpen && (homeSquad.length > 0 || awaySquad.length > 0) ? (
              <div
                id={`scorer-options-${matchId}`}
                className="absolute inset-x-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/60"
              >
                {(
                  [
                    [homeName, homeSquad],
                    [awayName, awaySquad],
                  ] as const
                ).map(([team, squad]) => {
                  const q = normalizeName(scorer);
                  // Likelihood order when odds exist (shortest price first —
                  // the question people Google answered in the list itself);
                  // alphabetical tail for players without a posted price.
                  const probOf = (n: string) => americanToProb(scorerOdds[n] ?? null) ?? -1;
                  const options = squad
                    .filter((n) => q === '' || normalizeName(n).includes(q))
                    .sort((a, b) => probOf(b) - probOf(a) || a.localeCompare(b));
                  if (options.length === 0) return null;
                  return (
                    <div key={team}>
                      <p className="sticky top-0 bg-zinc-900/95 px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500 backdrop-blur">
                        {team}
                      </p>
                      {options.map((n) => (
                        <button
                          key={n}
                          type="button"
                          data-testid="scorer-option"
                          // mousedown beats the input blur, so the tap registers
                          onMouseDown={(e) => {
                            e.preventDefault();
                            if (scorerBlurTimer.current !== null) {
                              window.clearTimeout(scorerBlurTimer.current);
                            }
                            setScorer(n);
                            setScorerOpen(false);
                            touch();
                          }}
                          className="flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800 active:bg-zinc-800"
                        >
                          <span className="min-w-0 truncate">{n}</span>
                          {scorerOdds[n] ? (
                            <span className="shrink-0 text-[11px] font-semibold tabular-nums text-zinc-500">
                              {scorerOdds[n]}
                            </span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
          <p className="mt-1 text-[10px] font-medium text-zinc-500">
            Optional — a wrong guess never costs points.
          </p>
        </div>
        <div>
          <span className="mb-1 flex items-center justify-between gap-2">
            <span className="block text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
              First team to score <span className="text-emerald-400">+2</span>
            </span>
            {hasSaved && !dirty && status === 'idle' ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300 ring-1 ring-inset ring-emerald-400/25">
                <svg
                  viewBox="0 0 24 24"
                  className="h-3 w-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M4.5 12.5 10 18 19.5 6.5" />
                </svg>
                Saved
              </span>
            ) : null}
          </span>
          <div className="relative">
            <select
              data-testid="pick-first-team"
              aria-label="First team to score"
              value={firstTeam}
              onChange={(e) => {
                setFirstTeam(e.target.value as '' | FirstTeam);
                touch();
              }}
              className={`${wideInputClass} appearance-none pr-10`}
            >
              <option value="">No prediction</option>
              <option value="home">
                {homeFlag ? `${homeFlag} ` : ''}
                {homeName}
              </option>
              <option value="away">
                {awayFlag ? `${awayFlag} ` : ''}
                {awayName}
              </option>
              <option value="none">No goals (0–0)</option>
            </select>
            <svg
              viewBox="0 0 24 24"
              className="pointer-events-none absolute right-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </div>
        </div>
        <button
          data-testid="pick-save"
          type="submit"
          disabled={status === 'saving'}
          className={`flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 active:scale-[.98] disabled:opacity-60 ${
            status === 'saved'
              ? 'bg-emerald-300 text-emerald-950 shadow-[0_0_20px_-4px_rgba(52,211,153,0.55)]'
              : hasSaved && status !== 'error'
                ? // A pick already exists — quiet outline so the solid-green CTA
                  // stays reserved for genuinely un-picked matches.
                  'bg-emerald-400/10 text-emerald-300 ring-1 ring-inset ring-emerald-400/30 hover:bg-emerald-400/20'
                : 'bg-emerald-400 text-zinc-950 hover:bg-emerald-300'
          }`}
        >
          {status === 'saved' ? (
            <>
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5 animate-pop-in"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4.5 12.5 10 18 19.5 6.5" />
              </svg>
              Saved
            </>
          ) : status === 'saving' ? (
            'Saving…'
          ) : hasSaved ? (
            'Update pick'
          ) : (
            'Save pick'
          )}
        </button>
        {status === 'error' && error && (
          <p className="text-sm text-brand-bright">{error}</p>
        )}
      </div>
    </form>
  );
}
