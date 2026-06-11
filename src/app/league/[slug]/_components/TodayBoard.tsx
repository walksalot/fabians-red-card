'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import BoosterButton from './BoosterButton';
import PickForm from './PickForm';
import { BreakdownChips, CHIP_TONES, NoPointsChip } from './breakdown-chips';
import { codeToFlagEmoji, shortTeamName } from './flags';
import {
  STAGE_LABELS,
  formatKickoffEt,
  formatMatchday,
  formatPoints,
} from './format';
import type { TodayMatchView } from './types';

/** Match the leaderboard cadence — fresh scores every 30s while matches run. */
const POLL_MS = 30_000;

/**
 * A locked match with no live feed and no result stops claiming "In progress"
 * after this long — results are hand-entered by the admin, so multi-hour
 * gaps genuinely happen and a red heartbeat on last night's match reads as
 * broken. Six hours comfortably covers extra time + stoppage, and keeps the
 * e2e fixture (FAKE_NOW pinned 5h after kickoff in gameplay.spec) inside the
 * live window — do not lower this below ~5.5h without updating that seed.
 */
const STALE_LIVE_MS = 6 * 60 * 60 * 1000;

interface Props {
  entryId: number;
  /** clock.now() on the server at render time — keeps countdowns honest under FAKE_NOW. */
  serverNowMs: number;
  boosterMultiplier: number;
  items: TodayMatchView[];
  /** Stage shared by every fixture on the board (shown once in the day header). */
  commonStage?: string | null;
  /** Matchday (YYYY-MM-DD) for the day header. */
  matchday: string;
  /** Header booster chip copy ("On X vs Y" / "Booster available"). */
  boosterLabel: string;
  /** True when the matchday booster is armed on some match. */
  boosterArmed: boolean;
}

function formatRemaining(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function ClockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/**
 * Brand-red "this match is live" dot. Static by default — exactly one element
 * per card (the FixtureCenter LIVE lockup) opts into the ping so the live
 * state reads as a single heartbeat, not competing pulses.
 */
function LiveDot({
  size = 'h-2 w-2',
  pulse = false,
}: {
  size?: string;
  pulse?: boolean;
}) {
  return (
    <span className={`relative flex ${size}`}>
      {pulse ? (
        <span className="absolute inline-flex h-full w-full rounded-full bg-brand opacity-75 motion-safe:animate-ping" />
      ) : null}
      <span className={`relative inline-flex ${size} rounded-full bg-brand`} />
    </span>
  );
}

function Countdown({
  kickoffUtc,
  serverNowMs,
}: {
  kickoffUtc: string;
  serverNowMs: number;
}) {
  // Anchor ticking to the server clock so a pinned FAKE_NOW stays authoritative.
  const [nowVal, setNowVal] = useState<number | null>(null);
  useEffect(() => {
    const offset = Date.now() - serverNowMs;
    const tick = () => setNowVal(Date.now() - offset);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [serverNowMs]);

  if (nowVal === null)
    return (
      <span className="chip bg-zinc-800/80 text-zinc-400 ring-1 ring-inset ring-white/5">
        …
      </span>
    );
  const remaining = new Date(kickoffUtc).getTime() - nowVal;
  if (remaining <= 0) {
    return (
      <span className="chip bg-brand/10 text-brand-bright ring-1 ring-inset ring-brand/30">
        Kicked off
      </span>
    );
  }
  // Urgency tiers: calm emerald far out, amber inside the hour, brand red in
  // the final 15 minutes — red owns "lock it in now". All three tiers share
  // the same bg+ring chip recipe; the unarmed booster pill beside them is
  // neutral zinc, so amber here always means urgency, never a second control.
  const tone =
    remaining <= 15 * 60_000
      ? 'bg-brand/10 text-brand-bright ring-brand/30'
      : remaining <= 60 * 60_000
        ? 'bg-amber-400/10 text-amber-300 ring-amber-400/25'
        : 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/25';
  return (
    <span className={`chip ring-1 ring-inset transition-colors duration-700 ${tone}`}>
      <ClockIcon />
      Locks in {formatRemaining(remaining)}
    </span>
  );
}

/**
 * Top-right chip for finished matches only. While a match is live, the red
 * card ring + the FixtureCenter lockup own the state alone — a second chip
 * up here would say "live" twice, so the slot stays empty until full time.
 */
function StatusChip() {
  return (
    <span className="chip bg-zinc-800/80 text-zinc-300 ring-1 ring-inset ring-white/10">
      Full time
    </span>
  );
}

function TeamSide({
  name,
  code,
  align,
}: {
  name: string;
  code: string | null;
  align: 'left' | 'right';
}) {
  const flag = codeToFlagEmoji(code);
  const alignCls = align === 'left' ? 'items-start text-left' : 'items-end text-right';
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 ${alignCls}`}>
      <span className="text-2xl leading-none" aria-hidden="true">
        {flag ?? '\u{1F3F3}\u{FE0F}'}
      </span>
      {/* Short display name for long FIFA names (no mid-word ellipsis);
          title keeps the full name on press-and-hold. */}
      <span
        title={name}
        className="w-full truncate text-sm font-bold leading-tight text-zinc-50"
      >
        {shortTeamName(name)}
      </span>
      {code ? (
        <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
          {code}
        </span>
      ) : null}
    </div>
  );
}

/** Center column of the fixture row: final score, live score, or kickoff time. */
function FixtureCenter({ item, stale }: { item: TodayMatchView; stale: boolean }) {
  if (item.status === 'finished') {
    return (
      <div className="flex flex-col items-center">
        <span className="font-display text-2xl font-bold tabular-nums tracking-tight text-zinc-50">
          {item.homeScore}–{item.awayScore}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
          FT
        </span>
      </div>
    );
  }
  if (item.liveStatus === 'in') {
    return (
      <div className="flex flex-col items-center">
        <span className="font-display text-2xl font-bold tabular-nums tracking-tight text-brand-bright">
          {item.liveHome ?? 0}–{item.liveAway ?? 0}
        </span>
        <span className="flex items-center gap-1">
          <LiveDot size="h-1.5 w-1.5" pulse />
          <span className="text-[10px] font-semibold uppercase tracking-widest text-brand-bright/80">
            Live
          </span>
        </span>
      </div>
    );
  }
  // Kicked off without live data yet — one pulsing lockup is the hero and the
  // card's only live statement; the caption reads past-tense ("Started …") so
  // the kickoff time can't be mistaken for a future schedule. Hours later with
  // still no result, the urgency drops to a calm zinc "Awaiting result" — a
  // match that ended last night must not keep a red heartbeat.
  if (item.locked) {
    return (
      <div className="flex flex-col items-center gap-1">
        <span className="flex items-center gap-1.5">
          {stale ? (
            <span className="h-2 w-2 rounded-full bg-zinc-600" />
          ) : (
            <LiveDot size="h-2 w-2" pulse />
          )}
          <span
            className={`whitespace-nowrap text-sm font-extrabold uppercase leading-none tracking-[0.16em] ${
              stale ? 'text-zinc-300' : 'text-brand-bright'
            }`}
          >
            {stale ? 'Awaiting result' : 'In progress'}
          </span>
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
          Started {formatKickoffEt(item.kickoffUtc)}
        </span>
      </div>
    );
  }
  // Upcoming: micro-eyebrow + one-line time, clearly a schedule, not a score.
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
        Kickoff
      </span>
      <span className="whitespace-nowrap text-base font-semibold tabular-nums tracking-tight text-zinc-300">
        {formatKickoffEt(item.kickoffUtc)}
      </span>
    </div>
  );
}

/** Result quality of a pick against a (live or final) scoreline. */
type PickQuality = 'exact' | 'outcome' | 'miss';

function pickQuality(
  predHome: number,
  predAway: number,
  home: number,
  away: number,
): PickQuality {
  if (predHome === home && predAway === away) return 'exact';
  if (Math.sign(predHome - predAway) === Math.sign(home - away))
    return 'outcome';
  return 'miss';
}

// History's exact/outcome/miss scoreline tints, reused on live cards so the
// sweat reads in the same language the morning-after review does.
const PICK_QUALITY_TONES: Record<PickQuality, string> = {
  exact: 'text-emerald-400',
  outcome: 'text-amber-300',
  miss: 'text-zinc-400',
};

/** Ticket-stub pick row: YOUR PICK eyebrow + bold score chip + secondary details. */
function PickSummary({ item }: { item: TodayMatchView }) {
  if (!item.myPick) {
    return <p className="text-sm text-zinc-400">No pick made.</p>;
  }
  const p = item.myPick;
  const first =
    p.predFirstTeam === null
      ? null
      : p.predFirstTeam === 'none'
        ? 'No goals'
        : p.predFirstTeam === 'home'
          ? item.homeName
          : item.awayName;
  // Live sweat: while the feed says the ball is rolling, score the pick
  // against the CURRENT scoreline so the card carries stakes — strictly
  // behind liveStatus==='in' so the quiet no-feed state stays quiet.
  const live = item.status !== 'finished' && item.liveStatus === 'in';
  const quality = live
    ? pickQuality(p.predHome, p.predAway, item.liveHome ?? 0, item.liveAway ?? 0)
    : null;
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
        Your pick
      </p>
      <div className="mt-1 flex min-w-0 items-center gap-2">
        <span
          className={`shrink-0 rounded-lg bg-zinc-950/60 px-2.5 py-1 text-base font-extrabold tabular-nums tracking-tight ring-1 ring-inset ring-white/10 ${
            quality ? PICK_QUALITY_TONES[quality] : 'text-zinc-50'
          }`}
        >
          {p.predHome}–{p.predAway}
        </span>
        {p.predScorer || first ? (
          <span className="min-w-0 truncate text-xs text-zinc-400">
            {p.predScorer ?? ''}
            {p.predScorer && first ? ' · ' : ''}
            {first ? `First: ${first}` : ''}
          </span>
        ) : null}
      </div>
      {quality ? (
        // Provisional "if it holds" chips — the shared CHIP_TONES system at
        // reduced opacity so a live forecast never reads as banked points.
        // (Point values are league-configured server-side, so the live chip
        // names the category and lets the FT breakdown state the number.)
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span
            className={`chip ring-1 ring-inset opacity-70 ${
              quality === 'miss'
                ? 'bg-zinc-800/80 text-zinc-400 ring-white/10'
                : CHIP_TONES.score
            }`}
          >
            {quality === 'exact'
              ? 'Exact score'
              : quality === 'outcome'
                ? 'Right outcome'
                : 'No points yet'}
          </span>
          <span className="text-[10px] font-medium text-zinc-400">
            if it holds
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** Tiny lock glyph for the locked-pick caption. */
function LockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5.5" y="10.5" width="13" height="9" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </svg>
  );
}

export default function TodayBoard({
  entryId,
  serverNowMs,
  boosterMultiplier,
  items,
  commonStage = null,
  matchday,
  boosterLabel,
  boosterArmed,
}: Props) {
  const router = useRouter();
  // Picks saved this session (server data only updates on refresh) — merged
  // with myPick so the eyebrow check / "Needs pick" marks update live.
  const [savedClient, setSavedClient] = useState<Record<number, boolean>>({});
  const hasPick = (m: TodayMatchView) =>
    m.myPick !== null || savedClient[m.matchId] === true;
  const pickedCount = items.filter(hasPick).length;
  const allPicked = pickedCount === items.length;
  // While anything on the board is locked/in-play, re-fetch server data every
  // 30s (visibility-aware) — same cadence as the leaderboard. Client state in
  // the pick forms survives a refresh, so typing is never interrupted.
  const hasLiveWindow = items.some(
    (m) => m.status !== 'finished' && (m.locked || m.liveStatus === 'in'),
  );
  useEffect(() => {
    if (!hasLiveWindow) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer === null) timer = setInterval(() => router.refresh(), POLL_MS);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        router.refresh();
        start();
      } else {
        stop();
      }
    };
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [hasLiveWindow, router]);

  return (
    <div className="space-y-3">
      {/* Day header: stage + fixture count + live pick progress, booster chip. */}
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          {/* Stage truncates first; the pick-progress counter can never clip
              ("5/5 picked" is the most actionable piece of the header). The
              fixture count is implicit in the denominator, so it stays out. */}
          <p className="flex min-w-0 items-baseline text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
            <span className="truncate">
              {commonStage ? (STAGE_LABELS[commonStage] ?? commonStage) : 'Matchday'}
            </span>
            <span className="shrink-0">&nbsp;·&nbsp;</span>
            <span
              className={`shrink-0 whitespace-nowrap ${allPicked ? 'text-emerald-400' : 'text-amber-300'}`}
            >
              {pickedCount}/{items.length} picked
            </span>
          </p>
          <h2 className="truncate font-display text-lg font-bold tracking-tight text-zinc-50">
            {formatMatchday(matchday)}
          </h2>
        </div>
        {/* The chip names the booster match but used to offer no path to it —
            tapping now scrolls the armed card (or the first card that can
            still take the booster) into view under the sticky header. */}
        {(() => {
          const target =
            items.find((m) => m.boosted) ??
            items.find(
              (m) => m.status !== 'finished' && !m.locked && !m.boosterDisabled,
            );
          const interactive = target !== undefined;
          const chipClass = `mb-0.5 chip ${
            boosterArmed
              ? 'bg-amber-400/10 text-amber-300 ring-1 ring-inset ring-amber-400/25'
              : interactive
                ? // Unarmed but tappable (jumps to the armable match): the same
                  // dashed-outline pill language as the unarmed BoosterButton —
                  // zinc text + amber bolt only, so amber fill/text stays
                  // reserved for the armed state and urgency chips.
                  'border border-dashed border-zinc-600/70 bg-transparent text-zinc-300 hover:border-zinc-500 hover:bg-white/5 active:bg-white/10'
                : // Pure status caption — nothing to jump to, so no affordance.
                  'bg-transparent px-0 text-zinc-400'
          }`;
          const inner = (
            <>
              <svg
                viewBox="0 0 24 24"
                className={`h-3 w-3 ${boosterArmed ? '' : 'text-amber-300/80'}`}
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2Z" />
              </svg>
              {boosterLabel}
              {/* Chevron-down = "this takes you somewhere below" — only on the
                  unarmed jump pill; the armed chip stays a pure status record. */}
              {interactive && !boosterArmed ? (
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
              ) : null}
            </>
          );
          if (!target) return <span className={chipClass}>{inner}</span>;
          return (
            <button
              type="button"
              aria-label={`${boosterLabel} — jump to match`}
              onClick={() =>
                document
                  .querySelector(`[data-testid="pick-form-${target.matchId}"]`)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
              className={`${chipClass} transition-transform duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 active:scale-95`}
            >
              {inner}
            </button>
          );
        })()}
      </div>
      {items.map((m, i) => {
        const isLive =
          m.status !== 'finished' && (m.locked || m.liveStatus === 'in');
        // Locked for hours with no live feed and no result — drop the red
        // urgency (ring + pulsing lockup) for a calm "awaiting result" card.
        const stale =
          isLive &&
          m.liveStatus !== 'in' &&
          serverNowMs - new Date(m.kickoffUtc).getTime() > STALE_LIVE_MS;
        const picked = hasPick(m);
        return (
        <div
          key={m.matchId}
          data-testid={`pick-form-${m.matchId}`}
          className={`card animate-fade-slide-in scroll-mt-24 p-4 ${
            isLive && !stale
              ? 'shadow-[0_0_0_1px_rgba(229,72,77,0.5),0_0_28px_-6px_rgba(229,72,77,0.45)]'
              : m.boosted
                ? 'shadow-[0_0_0_1px_rgba(251,191,36,0.45),0_0_24px_-6px_rgba(251,191,36,0.35)]'
                : ''
          }`}
          style={{ animationDelay: `${Math.min(i, 6) * 60}ms` }}
        >
          {/* Header: stage caption (mixed-stage days only) + pick state + booster + status */}
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              {/* Stage eyebrow only on mixed-stage days — the official match
                  number moved beside the venue caption so a kickoff-sorted
                  board never leads with a non-monotonic "MATCH 14 → 12" scan. */}
              {m.stage !== commonStage ? (
                <span className="truncate text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
                  {STAGE_LABELS[m.stage] ?? m.stage}
                </span>
              ) : null}
              {/* At-a-glance pick state: emerald check when the pick is in,
                  amber nudge while the match is still open without one. */}
              {m.status !== 'finished' && picked ? (
                <svg
                  viewBox="0 0 24 24"
                  className="h-3 w-3 shrink-0 text-emerald-400"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-label="Pick saved"
                  role="img"
                >
                  <path d="M4.5 12.5 10 18 19.5 6.5" />
                </svg>
              ) : m.status !== 'finished' && !picked && !isLive ? (
                <span className="inline-flex shrink-0 items-center rounded-full bg-amber-400/10 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-amber-300 ring-1 ring-inset ring-amber-400/25">
                  Needs pick
                </span>
              ) : null}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {m.status !== 'finished' ? (
                // Locked + unarmed = a dead control; CSS-hide it (stays mounted
                // for e2e) and keep the chip only as a record when armed.
                <span className={isLive && !m.boosted ? 'hidden' : ''}>
                  <BoosterButton
                    entryId={entryId}
                    matchday={m.matchday}
                    matchId={m.matchId}
                    boosted={m.boosted}
                    disabled={m.boosterDisabled}
                    multiplier={boosterMultiplier}
                    subtle={
                      new Date(m.kickoffUtc).getTime() - serverNowMs >
                      6 * 60 * 60 * 1000
                    }
                  />
                </span>
              ) : null}
              {/* Live windows render NOTHING here — the red ring + center
                  lockup state "live" exactly once. The chip returns at FT. */}
              {m.status === 'finished' ? (
                <StatusChip />
              ) : isLive ? null : (
                <Countdown kickoffUtc={m.kickoffUtc} serverNowMs={serverNowMs} />
              )}
            </span>
          </div>

          {/* Fixture row: home | score-or-time | away */}
          <div className="mt-2.5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <TeamSide name={m.homeName} code={m.homeCode} align="left" />
            <FixtureCenter item={m} stale={stale} />
            <TeamSide name={m.awayName} code={m.awayCode} align="right" />
          </div>

          {/* Venue caption — official FIFA match number trails, demoted. */}
          <p className="mt-1.5 text-center text-[11px] text-zinc-400">
            {m.venue}, {m.city}
            <span className="text-zinc-500"> · Match {m.matchId}</span>
          </p>

          {m.status === 'finished' ? (
            <div className="mt-3 space-y-1.5 border-t border-white/5 pt-3">
              {m.firstScorer && (
                <p className="text-xs text-zinc-400">
                  First scorer: <span className="text-zinc-200">{m.firstScorer}</span>
                </p>
              )}
              <PickSummary item={m} />
              {/* The payoff moment: same celebratory breakdown chips History
                  shows, the second the final whistle lands on Today. Bold
                  emerald total trails the row; a zero gets the deliberate
                  "No points this match" chip instead of a flat "0 pts". */}
              {m.points && m.points.breakdown ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <BreakdownChips breakdown={m.points.breakdown} />
                  {m.points.total > 0 ? (
                    <span className="ml-auto shrink-0 text-sm font-bold tabular-nums text-emerald-400">
                      +{formatPoints(m.points.total)} pts
                    </span>
                  ) : null}
                </div>
              ) : m.points && m.points.total > 0 ? (
                <p className="text-sm font-bold tabular-nums text-emerald-400">
                  +{formatPoints(m.points.total)} pts
                </p>
              ) : m.myPick && !m.points ? (
                <p className="text-sm font-semibold text-zinc-400">
                  Points pending
                </p>
              ) : (
                // Zero-total finished states (scored zero OR no pick) share the
                // deliberate chip — the card states the zero exactly once.
                <div className="mt-2">
                  <NoPointsChip />
                </div>
              )}
            </div>
          ) : m.locked ? (
            <div className="mt-3 border-t border-white/5 pt-3">
              <PickSummary item={m} />
              <p className="mt-2 flex items-center gap-1 text-[10px] font-medium text-zinc-400">
                <LockIcon />
                Picks are locked for this match.
              </p>
            </div>
          ) : (
            <PickForm
              entryId={entryId}
              matchId={m.matchId}
              homeName={m.homeName}
              awayName={m.awayName}
              homeCode={m.homeCode}
              awayCode={m.awayCode}
              homeSquad={m.homeSquad}
              awaySquad={m.awaySquad}
              initial={m.myPick}
              onSaved={() =>
                setSavedClient((s) =>
                  s[m.matchId] ? s : { ...s, [m.matchId]: true },
                )
              }
            />
          )}
        </div>
        );
      })}
    </div>
  );
}
