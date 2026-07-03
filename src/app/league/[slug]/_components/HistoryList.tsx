import EmptyState from '@/components/EmptyState';
import LeaguePicksReveal from './LeaguePicksReveal';
import WrapCard, { type WrapCardView } from './WrapCard';
import { BreakdownChips, breakdownChips } from './breakdown-chips';
import { codeToFlagEmoji, shortTeamName } from './flags';
import { STAGE_LABELS, formatMatchday, formatPoints } from './format';
import type { HistoryDayView, HistoryItemView } from './types';

/**
 * Presentational history list (no client interactivity — rendered on the server).
 * Finished matches grouped by matchday (newest day first) with points chips
 * (shared with Today's finished cards via ./breakdown-chips).
 */

function firstTeamLabel(item: HistoryItemView): string | null {
  const ft = item.myPick?.predFirstTeam ?? null;
  if (ft === null) return null;
  if (ft === 'none') return 'no goals';
  return ft === 'home' ? item.homeName : item.awayName;
}

/**
 * Flag + name fixture label — one texture for every history card. Long FIFA
 * names render their short display form (never a mid-word ellipsis stranding
 * the flag); title keeps the full name reachable on press-and-hold.
 */
function HistoryTeam({
  name,
  code,
  align,
}: {
  name: string;
  code: string | null;
  align: 'left' | 'right';
}) {
  const flag = codeToFlagEmoji(code);
  const flagSpan = flag ? (
    <span aria-hidden="true" className="shrink-0 text-base leading-none">
      {flag}
    </span>
  ) : null;
  return (
    <span
      className={`flex min-w-0 items-center gap-1.5 ${
        align === 'right' ? 'justify-end' : ''
      }`}
    >
      {align === 'left' ? flagSpan : null}
      <span
        title={name}
        className={`truncate text-sm font-semibold text-zinc-100 ${
          align === 'right' ? 'text-right' : ''
        }`}
      >
        {shortTeamName(name)}
      </span>
      {align === 'right' ? flagSpan : null}
    </span>
  );
}

function HistoryItem({
  item,
  slug,
  myEntryId,
}: {
  item: HistoryItemView;
  slug: string;
  myEntryId: number;
}) {
  const chips = item.breakdown ? breakdownChips(item.breakdown) : null;
  const first = firstTeamLabel(item);
  const scored = item.total !== null && item.total > 0;
  // The "No points this match" chip already says it — skip the grey "0 pts".
  const showZeroChip = chips !== null && chips.length === 0;
  // Scannable W/L texture: tint the pick scoreline by result quality —
  // emerald exact hit, amber outcome-only, muted miss.
  const pickTone = item.breakdown
    ? item.breakdown.exact > 0
      ? 'text-emerald-400'
      : item.breakdown.outcome > 0
        ? 'text-amber-300'
        : 'text-zinc-400'
    : 'text-zinc-100';
  return (
    <div data-testid={`history-match-${item.matchId}`} className="card p-4">
      {/* Fixture row: team | score | team — same grid language as Today. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <HistoryTeam name={item.homeName} code={item.homeCode} align="left" />
        <span className="text-base font-extrabold tabular-nums tracking-tight text-zinc-50">
          {item.homeScore}–{item.awayScore}
        </span>
        <HistoryTeam name={item.awayName} code={item.awayCode} align="right" />
      </div>

      {/* Meta row: stage + first scorer on the left, points on the right. */}
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-xs text-zinc-400">
          {STAGE_LABELS[item.stage] ?? item.stage}
          {item.firstScorer ? ` · First scorer: ${item.firstScorer}` : ''}
        </p>
        {scored || !showZeroChip ? (
          <p
            className={`shrink-0 text-sm font-bold tabular-nums ${
              scored ? 'text-emerald-400' : 'text-zinc-400'
            }`}
          >
            {scored ? `+${formatPoints(item.total ?? 0)}` : '0'} pts
          </p>
        ) : null}
      </div>

      {item.myPick ? (
        // Same ticket-stub recipe as Today's locked/finished cards: eyebrow +
        // bold score chip (result-quality tint kept on the score text) with
        // scorer/first-team as the muted trailing segment.
        <div className="mt-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
            Your pick
          </p>
          <div className="mt-1 flex min-w-0 items-center gap-2">
            <span
              className={`shrink-0 rounded-lg bg-zinc-950/60 px-2.5 py-1 text-base font-extrabold tabular-nums tracking-tight ring-1 ring-inset ring-white/10 ${pickTone}`}
            >
              {item.myPick.predHome}–{item.myPick.predAway}
            </span>
            {item.myPick.predScorer || first ? (
              <span className="min-w-0 truncate text-xs text-zinc-400">
                {item.myPick.predScorer ?? ''}
                {item.myPick.predScorer && first ? ' · ' : ''}
                {first ? `First: ${first}` : ''}
              </span>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="mt-2 text-sm text-zinc-400">No pick — 0 points.</p>
      )}

      {item.breakdown && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <BreakdownChips breakdown={item.breakdown} />
        </div>
      )}

      {/* "Who picked what" — same reveal Today's kicked-off cards carry. */}
      <LeaguePicksReveal slug={slug} matchId={item.matchId} myEntryId={myEntryId} />
    </div>
  );
}

export default function HistoryList({
  groups,
  slug,
  myEntryId,
  wraps = {},
}: {
  groups: HistoryDayView[];
  slug: string;
  myEntryId: number;
  /** Matchday Wrap per day (keyed YYYY-MM-DD) — rendered atop its group. */
  wraps?: Record<string, WrapCardView>;
}) {
  if (groups.length === 0) {
    return (
      <EmptyState
        title="No finished matches yet"
        sub="History starts after the first final whistle."
      />
    );
  }
  return (
    <div className="space-y-6">
      {groups.map((group) => {
        // Same day-header recipe as Today: tiny uppercase eyebrow over a bold
        // date, subtotal chip right-aligned at the baseline — one typographic
        // system for the "matchday" object across both timeline screens.
        const stages = [...new Set(group.items.map((i) => i.stage))];
        const stageLabel =
          stages.length === 1 ? (STAGE_LABELS[stages[0]] ?? stages[0]) : 'Matchday';
        const count = group.items.length;
        return (
          <section key={group.matchday}>
            <div className="mb-2 flex items-end justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
                  {stageLabel} · {count} {count === 1 ? 'match' : 'matches'}
                </p>
                <h2 className="truncate font-display text-lg font-bold tracking-tight text-zinc-50">
                  {formatMatchday(group.matchday)}
                </h2>
              </div>
              <span
                className={`chip mb-0.5 shrink-0 ring-1 ring-inset ${
                  group.subtotal > 0
                    ? 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/25'
                    : 'bg-zinc-800/80 text-zinc-400 ring-white/10'
                }`}
              >
                {group.subtotal > 0
                  ? `+${formatPoints(group.subtotal)} pts`
                  : '0 pts'}
              </span>
            </div>
            <div className="space-y-3">
              {wraps[group.matchday] ? (
                <WrapCard wrap={wraps[group.matchday]} />
              ) : null}
              {group.items.map((item) => (
                <HistoryItem
                  key={item.matchId}
                  item={item}
                  slug={slug}
                  myEntryId={myEntryId}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
