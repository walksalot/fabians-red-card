import { STAGE_LABELS, formatMatchday, formatPoints } from './format';
import type { BreakdownView, HistoryDayView, HistoryItemView } from './types';

/**
 * Presentational history list (no client interactivity — rendered on the server).
 * Finished matches grouped by matchday (newest day first) with points chips.
 */

function breakdownChips(b: BreakdownView): string[] {
  const chips: string[] = [];
  if (b.exact > 0) chips.push(`Exact +${formatPoints(b.exact)}`);
  if (b.outcome > 0) chips.push(`Outcome +${formatPoints(b.outcome)}`);
  if (b.scorer > 0) chips.push(`Scorer +${formatPoints(b.scorer)}`);
  if (b.firstTeam > 0) chips.push(`First team +${formatPoints(b.firstTeam)}`);
  if (b.underdog > 0) chips.push(`Underdog +${formatPoints(b.underdog)}`);
  if (b.roundMultiplier !== 1) chips.push(`×${b.roundMultiplier} round`);
  if (b.boosterMultiplier !== 1) chips.push(`×${b.boosterMultiplier} booster`);
  return chips;
}

function firstTeamLabel(item: HistoryItemView): string | null {
  const ft = item.myPick?.predFirstTeam ?? null;
  if (ft === null) return null;
  if (ft === 'none') return 'no goals';
  return ft === 'home' ? item.homeName : item.awayName;
}

function HistoryItem({ item }: { item: HistoryItemView }) {
  const chips = item.breakdown ? breakdownChips(item.breakdown) : null;
  const first = firstTeamLabel(item);
  return (
    <div
      data-testid={`history-match-${item.matchId}`}
      className="rounded-xl border border-zinc-800 bg-zinc-900 p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">
            {item.homeName} {item.homeScore}–{item.awayScore} {item.awayName}
          </p>
          <p className="text-xs text-zinc-500">
            {STAGE_LABELS[item.stage] ?? item.stage}
            {item.firstScorer ? ` · First scorer: ${item.firstScorer}` : ''}
          </p>
        </div>
        <p className="shrink-0 text-sm font-semibold text-emerald-400">
          {item.total !== null ? `+${formatPoints(item.total)}` : '0'} pts
        </p>
      </div>

      {item.myPick ? (
        <p className="mt-2 text-sm text-zinc-300">
          My pick:{' '}
          <span className="font-medium">
            {item.myPick.predHome}–{item.myPick.predAway}
          </span>
          {item.myPick.predScorer ? ` · ${item.myPick.predScorer}` : ''}
          {first ? ` · first: ${first}` : ''}
        </p>
      ) : (
        <p className="mt-2 text-sm text-zinc-500">No pick — 0 points.</p>
      )}

      {chips && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chips.length > 0 ? (
            chips.map((chip) => (
              <span
                key={chip}
                className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300"
              >
                {chip}
              </span>
            ))
          ) : (
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-500">
              No points this match
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default function HistoryList({ groups }: { groups: HistoryDayView[] }) {
  if (groups.length === 0) {
    return (
      <p className="text-zinc-400">
        No finished matches yet — history starts after the first final whistle.
      </p>
    );
  }
  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.matchday}>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-zinc-300">
              {formatMatchday(group.matchday)}
            </h2>
            <p className="shrink-0 text-sm font-semibold text-emerald-400">
              +{formatPoints(group.subtotal)} pts
            </p>
          </div>
          <div className="space-y-3">
            {group.items.map((item) => (
              <HistoryItem key={item.matchId} item={item} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
