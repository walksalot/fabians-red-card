'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { normalizeName } from '@/lib/scoring';
import BoosterButton from './BoosterButton';
import HowItWorksSheet from './HowItWorksSheet';
import OddsStrip from './OddsStrip';
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
  /** League scoring values for the in-context "How scoring works" sheet. */
  points: { exact: number; outcome: number; scorer: number; firstTeam: number; underdog: number };
  /** Auto-underdog win-chance ceiling as a whole percent (from UNDERDOG_PROB_MAX). */
  underdogPctMax: number;
  /** Day-browser control rendered in place of the static date headline. */
  dayNav?: React.ReactNode;
  /** Viewing a day ahead of the current one (drives the odds-coming hint). */
  isFutureDay?: boolean;
  /** Missing-picks radar: gaps on days OTHER than the one on screen. */
  missingAhead?: { count: number; firstGapDay: string; href: string } | null;
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
  // Inside 5 minutes the chip breathes (motion-safe): the last theatrical
  // escalation before the lock — the ticking m:ss format is already active
  // under an hour, so drama here is purely the pulse.
  const finalMinutes = remaining <= 5 * 60_000;
  const tone =
    remaining <= 15 * 60_000
      ? 'bg-brand/10 text-brand-bright ring-brand/30'
      : remaining <= 60 * 60_000
        ? 'bg-amber-400/10 text-amber-300 ring-amber-400/25'
        : 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/25';
  return (
    <span
      className={`chip ring-1 ring-inset transition-colors duration-700 ${tone} ${
        finalMinutes ? 'motion-safe:animate-pulse' : ''
      }`}
    >
      <ClockIcon />
      Locks in {formatRemaining(remaining)}
    </span>
  );
}

/**
 * Final-five-minutes alarm ring: a breathing red halo over a card that is
 * about to lock WITHOUT a pick. Self-ticking (the card itself doesn't), and
 * strictly decorative — the server's lock check is the only authority.
 */
function LockAlarmRing({
  kickoffUtc,
  serverNowMs,
  active,
}: {
  kickoffUtc: string;
  serverNowMs: number;
  active: boolean;
}) {
  const [nowVal, setNowVal] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    const offset = Date.now() - serverNowMs;
    const tick = () => setNowVal(Date.now() - offset);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [active, serverNowMs]);
  if (!active || nowVal === null) return null;
  const remaining = new Date(kickoffUtc).getTime() - nowVal;
  if (remaining <= 0 || remaining > 5 * 60_000) return null;
  return (
    <span
      aria-hidden="true"
      data-testid="lock-alarm"
      className="pointer-events-none absolute inset-0 rounded-2xl animate-lock-glow"
    />
  );
}

/**
 * "updated 40s ago" stamp for live cards — a frozen feed must never read as
 * a real 0-0. Amber past three minutes: old enough to distrust.
 */
function FeedAge({
  liveUpdatedAt,
  serverNowMs,
}: {
  liveUpdatedAt: number | null;
  serverNowMs: number;
}) {
  const [nowVal, setNowVal] = useState<number | null>(null);
  useEffect(() => {
    const offset = Date.now() - serverNowMs;
    const tick = () => setNowVal(Date.now() - offset);
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, [serverNowMs]);
  if (liveUpdatedAt === null || nowVal === null) return null;
  const age = Math.max(0, nowVal - liveUpdatedAt);
  const stale = age > 3 * 60_000;
  const label =
    age < 60_000
      ? `${Math.max(5, Math.round(age / 5000) * 5)}s`
      : `${Math.round(age / 60_000)}m`;
  return (
    <span
      className={`text-[9px] font-medium tabular-nums ${
        stale ? 'text-amber-300' : 'text-zinc-500'
      }`}
    >
      updated {label} ago
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
  underdogPts = null,
}: {
  name: string;
  code: string | null;
  align: 'left' | 'right';
  /** Non-null = this side is the flagged underdog; value is the bonus. */
  underdogPts?: number | null;
}) {
  const flag = codeToFlagEmoji(code);
  const alignCls = align === 'left' ? 'items-start text-left' : 'items-end text-right';
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 ${alignCls}`}>
      <span className="text-2xl leading-none" aria-hidden="true">
        {flag ?? '\u{1F3F3}\u{FE0F}'}
      </span>
      {/* Short display name for long FIFA names (no mid-word ellipsis);
          title keeps the full name on press-and-hold. One font step down
          below 380px — at 360px the columns are ~8px too narrow for
          "Bosnia & Herz.", and ellipsizing an abbreviation reads as broken. */}
      <span
        title={name}
        className="w-full truncate text-sm font-bold leading-tight text-zinc-50 max-[379px]:text-[13px]"
      >
        {shortTeamName(name)}
      </span>
      {/* Skip the code eyebrow when it just repeats the name ("USA" / "USA"
          read as a duplicated-label glitch). */}
      {code && code.toLowerCase() !== shortTeamName(name).toLowerCase() ? (
        <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
          {code}
        </span>
      ) : null}
      {/* The dare, right where picks are made: amber outline (informational,
          like the odds strip), never brand red — this is a tip, not urgency.
          Only rendered while the card is open; the flag freezes with picks. */}
      {underdogPts !== null ? (
        <span
          data-testid="underdog-chip"
          className="mt-0.5 inline-flex items-center whitespace-nowrap rounded-full border border-amber-400/40 bg-amber-400/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-amber-300"
        >
          Underdog +{underdogPts}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Live score with the GOAL celebration: when a poll raises the goal total the
 * digits jump (goal-pop) once. The key remount restarts the animation per
 * goal; first paint never animates (prev starts at the current total).
 */
function LiveScore({ item }: { item: TodayMatchView }) {
  const total = (item.liveHome ?? 0) + (item.liveAway ?? 0);
  const prev = useRef(total);
  const [goalKey, setGoalKey] = useState(0);
  useEffect(() => {
    if (total > prev.current) setGoalKey((k) => k + 1);
    prev.current = total;
  }, [total]);
  return (
    <span
      key={goalKey}
      className={`font-display text-2xl font-bold tabular-nums tracking-tight text-brand-bright ${
        goalKey > 0 ? 'animate-goal-pop' : ''
      }`}
    >
      {item.liveHome ?? 0}–{item.liveAway ?? 0}
    </span>
  );
}

/** Center column of the fixture row: final score, live score, or kickoff time. */
function FixtureCenter({
  item,
  stale,
  serverNowMs,
}: {
  item: TodayMatchView;
  stale: boolean;
  serverNowMs: number;
}) {
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
        <LiveScore item={item} />
        <span className="flex items-center gap-1">
          <LiveDot size="h-1.5 w-1.5" pulse />
          <span className="text-[10px] font-semibold uppercase tracking-widest text-brand-bright/80">
            {/* feed clock = minutes accrued ("55'", "HT"); dot already says live */}
            {item.liveClock ?? 'Live'}
          </span>
        </span>
        <FeedAge liveUpdatedAt={item.liveUpdatedAt} serverNowMs={serverNowMs} />
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
      {/* Scorer sweat line — the most emotional pick on the card, surfaced
          the moment a first goal exists (or is still possible). normalizeName
          matches the engine's own comparison, so "your scorer!" here always
          agrees with the points that bank at full time. */}
      {live && p.predScorer ? (
        item.liveFirstScorer ? (
          normalizeName(item.liveFirstScorer) === normalizeName(p.predScorer) ? (
            <p className="mt-1.5 text-xs font-semibold text-emerald-400">
              First goal: {item.liveFirstScorer} — your scorer! 🎯
            </p>
          ) : (
            <p className="mt-1.5 text-xs text-zinc-400">
              First goal: {item.liveFirstScorer} — your {p.predScorer} pick
              missed it
            </p>
          )
        ) : (
          <p className="mt-1.5 text-xs text-amber-300/90">
            No goal yet — {p.predScorer} can still land it
          </p>
        )
      ) : null}
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
            {/* "Right result" — the same name the live legend, the scoring
                sheet and the Rules teach for this category. */}
            {quality === 'exact'
              ? 'Exact score'
              : quality === 'outcome'
                ? 'Right result'
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
  points,
  underdogPctMax,
  dayNav = null,
  isFutureDay = false,
  missingAhead = null,
}: Props) {
  const router = useRouter();
  // Picks saved this session (server data only updates on refresh) — merged
  // with myPick so the eyebrow check / "Needs pick" marks update live.
  const [savedClient, setSavedClient] = useState<Record<number, boolean>>({});
  const hasPick = (m: TodayMatchView) =>
    m.myPick !== null || savedClient[m.matchId] === true;
  const pickedCount = items.filter(hasPick).length;
  const allPicked = pickedCount === items.length;
  // Every fixture is a bracket placeholder — nobody can pick anything, so the
  // amber "0/N picked" urgency (and any lock countdown) would be a demand to
  // do the impossible. The whole day reads as a calm "bracket pending".
  const allTbd = items.length > 0 && items.every((m) => m.teamsTbd);
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
      {/* Day header: stage + fixture count eyebrow over the full-width day
          browser, then ONE aligned utility row (scoring sheet + booster chip)
          — stacking the pills on separate ragged lines read as misaligned. */}
      <div className="min-w-0">
        {/* Stage truncates first; the pick-progress counter can never clip
            ("5/5 picked" is the most actionable piece of the header). The
            fixture count is implicit in the denominator, so it stays out. */}
        <p className="flex min-w-0 items-baseline text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
          <span className="truncate">
            {commonStage ? (STAGE_LABELS[commonStage] ?? commonStage) : 'Matchday'}
          </span>
          <span className="shrink-0">&nbsp;·&nbsp;</span>
          {allTbd ? (
            <span className="shrink-0 whitespace-nowrap text-zinc-400">
              Bracket pending
            </span>
          ) : (
            <span
              className={`shrink-0 whitespace-nowrap ${allPicked ? 'text-emerald-400' : 'text-amber-300'}`}
            >
              {pickedCount}/{items.length} picked
            </span>
          )}
        </p>
        {dayNav ?? (
          <h2 className="truncate font-display text-lg font-bold tracking-tight text-zinc-50">
            {formatMatchday(matchday)}
          </h2>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <HowItWorksSheet
          points={points}
          boosterMultiplier={boosterMultiplier}
          underdogPctMax={underdogPctMax}
        />
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
          // Bracket-pending day: nothing can be boosted, so "Booster
          // available" would contradict every disabled card below — state
          // when it actually opens instead.
          const label = allTbd ? 'Booster opens with the bracket' : boosterLabel;
          // h-7 matches the "How scoring works" pill sharing this row;
          // `shrink min-w-0` undo the chip utility's flex-shrink:0 so the
          // truncating label span below keeps long fixture names ("On Canada
          // vs Bosnia and Herzegovina") inside the 390px row.
          const chipClass = `chip h-7 min-w-0 shrink ${
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
                className={`h-3 w-3 shrink-0 ${boosterArmed ? '' : 'text-amber-300/80'}`}
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2Z" />
              </svg>
              <span className="min-w-0 truncate">{label}</span>
              {/* Chevron-down = "this takes you somewhere below" — only on the
                  unarmed jump pill; the armed chip stays a pure status record. */}
              {interactive && !boosterArmed ? (
                <svg
                  viewBox="0 0 24 24"
                  className="h-3 w-3 shrink-0 text-zinc-500"
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
              aria-label={`${label} — jump to match`}
              onClick={() =>
                document
                  .querySelector(`[data-testid="pick-form-${target.matchId}"]`)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
              // before: pseudo-element grows the 28px pill's tap surface past
              // the 44px floor without changing its visual size (same goal as
              // BoosterButton's hit-area expansion on the cards).
              className={`${chipClass} relative transition-transform duration-150 before:absolute before:inset-x-0 before:-inset-y-2 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 active:scale-95`}
            >
              {inner}
            </button>
          );
        })()}
      </div>
      {/* Missing-picks radar: gaps hiding on OTHER days (this day's own count
          lives in the header above). A quiet amber banner, not a red alarm —
          it deep-links to the first day with a gap. */}
      {missingAhead ? (
        <Link
          href={missingAhead.href}
          data-testid="missing-picks-banner"
          className="flex items-center gap-2 rounded-xl bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-300 ring-1 ring-inset ring-amber-400/25 transition-colors hover:bg-amber-400/15 active:scale-[0.99]"
        >
          <span
            aria-hidden="true"
            className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300"
          />
          <span className="min-w-0 flex-1 truncate">
            {missingAhead.count} pick{missingAhead.count === 1 ? '' : 's'}{' '}
            missing · next gap {formatMatchday(missingAhead.firstGapDay)}
          </span>
          <span className="shrink-0 text-amber-300/80">
            Fill {missingAhead.count === 1 ? 'it' : 'them'} →
          </span>
        </Link>
      ) : null}
      {/* zinc-500, not 600 — this line answers "where are the odds?", so it
          matches the readable caption tone used inside the cards. Shown on ANY
          day whose open cards all lack odds (not just future days): users who
          saw odds on other cards deserve the same explanation on matchday. */}
      {items.every((m) => m.odds === null) &&
      items.some((m) => m.status !== 'finished' && !m.locked) ? (
        <p className="text-[11px] text-zinc-500">
          {isFutureDay
            ? 'Betting odds appear closer to matchday.'
            : 'Betting odds appear closer to kickoff.'}
        </p>
      ) : null}
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
          className={`card relative animate-fade-slide-in scroll-mt-24 p-4 ${
            isLive && !stale
              ? 'shadow-[0_0_0_1px_rgba(229,72,77,0.5),0_0_28px_-6px_rgba(229,72,77,0.45)]'
              : m.boosted
                ? 'shadow-[0_0_0_1px_rgba(251,191,36,0.45),0_0_24px_-6px_rgba(251,191,36,0.35)]'
                : ''
          }`}
          style={{ animationDelay: `${Math.min(i, 6) * 60}ms` }}
        >
          {/* Final-minutes red halo — only over an OPEN card still needing a
              pick; the picked card keeps its calm countdown chip. */}
          <LockAlarmRing
            kickoffUtc={m.kickoffUtc}
            serverNowMs={serverNowMs}
            active={
              !picked && !m.locked && m.status !== 'finished' && !m.teamsTbd
            }
          />
          {/* Header: stage caption (mixed-stage days only) + pick state + booster + status.
              flex-wrap (and no min-w-0 on the left span): when large text zoom
              makes the chips outgrow the row, the right group drops to a second
              line instead of sliding over the "Needs pick" chip. */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
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
              ) : m.status !== 'finished' && !picked && !isLive && !m.teamsTbd ? (
                <span className="inline-flex shrink-0 items-center rounded-full bg-amber-400/10 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-amber-300 ring-1 ring-inset ring-amber-400/25">
                  Needs pick
                </span>
              ) : null}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {m.status !== 'finished' ? (
                // Locked + unarmed = a dead control; CSS-hide it (stays mounted
                // for e2e) and keep the chip only as a record when armed.
                // Bracket-pending cards get the same treatment: a grayed-out
                // pill on a match nobody can boost is a dead control too.
                <span className={(isLive || m.teamsTbd) && !m.boosted ? 'hidden' : ''}>
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
                  lockup state "live" exactly once. The chip returns at FT.
                  Bracket-pending cards skip the countdown too: a lock timer
                  for a match nobody can pick promises an impossible action. */}
              {m.status === 'finished' ? (
                <StatusChip />
              ) : isLive || m.teamsTbd ? null : (
                <Countdown kickoffUtc={m.kickoffUtc} serverNowMs={serverNowMs} />
              )}
            </span>
          </div>

          {/* Armed-booster teaching caption — rendered OUTSIDE the header row
              so the pill stays on the row's center line beside the Locks chip
              (stacking the caption under the pill staggered it ~15px).
              Centered: right-aligned it sat squarely under the Locks chip,
              which made the lock timer look tappable. */}
          {m.status !== 'finished' && m.boosted && !m.boosterDisabled ? (
            <p className="mt-1 text-center text-[10px] font-medium text-zinc-500">
              doubles this match · tap to remove
            </p>
          ) : null}

          {/* Fixture row: home | score-or-time | away. The gap tightens below
              380px to hand the team-name columns the width they lose on small
              Androids (pairs with the name's font step-down). */}
          <div className="mt-2.5 grid grid-cols-[1fr_auto_1fr] items-center gap-3 max-[379px]:gap-2">
            <TeamSide
              name={m.homeName}
              code={m.homeCode}
              align="left"
              underdogPts={m.underdogSide === 'home' ? points.underdog : null}
            />
            <FixtureCenter item={m} stale={stale} serverNowMs={serverNowMs} />
            <TeamSide
              name={m.awayName}
              code={m.awayCode}
              align="right"
              underdogPts={m.underdogSide === 'away' ? points.underdog : null}
            />
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
          ) : m.teamsTbd ? (
            <p className="mt-3 rounded-lg bg-zinc-950/50 px-3 py-2.5 text-xs text-zinc-500 ring-1 ring-inset ring-white/5">
              Bracket pending — picks open as soon as both teams are known.
            </p>
          ) : (
            <>
              {m.odds ? (
                <OddsStrip
                  matchId={m.matchId}
                  odds={m.odds}
                  homeCode={m.homeCode}
                  awayCode={m.awayCode}
                  homeName={m.homeName}
                  awayName={m.awayName}
                />
              ) : null}
              <PickForm
              entryId={entryId}
              matchId={m.matchId}
              scorerPoints={points.scorer}
              firstTeamPoints={points.firstTeam}
              homeName={m.homeName}
              awayName={m.awayName}
              homeCode={m.homeCode}
              awayCode={m.awayCode}
              homeSquad={m.homeSquad}
              awaySquad={m.awaySquad}
              scorerOdds={m.scorerOdds}
              initial={m.myPick}
              onSaved={() =>
                setSavedClient((s) =>
                  s[m.matchId] ? s : { ...s, [m.matchId]: true },
                )
              }
              />
            </>
          )}
        </div>
        );
      })}
    </div>
  );
}
