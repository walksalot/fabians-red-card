/** One leaderboard row, matching getLeaderboard's shape. Presentational only. */
export interface LeaderboardRow {
  rank: number;
  entryId: number;
  userId: number;
  label: string;
  displayName: string;
  total: number;
  exactCount: number;
  scorerHits: number;
}

function rankStyle(rank: number): string {
  if (rank === 1) return 'bg-emerald-400 text-zinc-950';
  if (rank === 2) return 'bg-zinc-300 text-zinc-950';
  if (rank === 3) return 'bg-amber-600 text-zinc-950';
  return 'bg-zinc-800 text-zinc-300';
}

export function LeaderboardTable({
  rows,
  highlightEntryId,
}: {
  rows: LeaderboardRow[];
  highlightEntryId?: number | null;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-2xl bg-zinc-900 p-4 text-sm text-zinc-400 ring-1 ring-zinc-800">
        No entries yet — invite your friends.
      </p>
    );
  }
  return (
    <ol className="space-y-2">
      {rows.map((row) => {
        const mine = highlightEntryId != null && row.entryId === highlightEntryId;
        return (
          <li
            key={row.entryId}
            data-testid="leaderboard-row"
            className={`flex items-center gap-3 rounded-2xl bg-zinc-900 px-4 py-3 ring-1 ${
              mine ? 'ring-emerald-400/60' : 'ring-zinc-800'
            }`}
          >
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums ${rankStyle(row.rank)}`}
            >
              {row.rank}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-zinc-100">
                {row.label}
                {mine ? (
                  <span className="ml-2 text-xs font-medium text-emerald-400">
                    you
                  </span>
                ) : null}
              </p>
              <p className="truncate text-xs text-zinc-500">
                {row.displayName} · {row.exactCount} exact · {row.scorerHits}{' '}
                scorers
              </p>
            </div>
            <span className="shrink-0 text-lg font-bold text-emerald-400 tabular-nums">
              {row.total}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default LeaderboardTable;
