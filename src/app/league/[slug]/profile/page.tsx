import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import Badge from '@/components/Badge';
import { getEntryStats, getLeaderboard } from '@/lib/services/leaderboard';
import EntrySwitcher from '../_components/EntrySwitcher';
import LogoutButton from '../_components/LogoutButton';
import { formatPoints, ordinal } from '../_components/format';
import {
  loadLeagueContext,
  pickSelectedEntry,
} from '../_components/league-data';
import type {
  EntryStatsView,
  LeaderboardRowView,
} from '../_components/types';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-zinc-100">{value}</p>
    </div>
  );
}

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ entry?: string | string[] }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await loadLeagueContext(slug);
  if (!ctx.isMember) return null; // layout renders the join prompt
  const { db, league, user, entries } = ctx;

  const entry = pickSelectedEntry(entries, sp.entry);
  if (!entry) {
    return (
      <p className="text-zinc-400">No entry found for you in this league.</p>
    );
  }

  const stats = (await getEntryStats(db, entry.id)) as EntryStatsView;
  const rows = (await getLeaderboard(db, league.id)) as LeaderboardRowView[];
  const mine = rows.find((r) => r.entryId === entry.id);
  const finishedTotal = db
    .select()
    .from(schema.matches)
    .where(eq(schema.matches.status, 'finished'))
    .all().length;

  return (
    <div className="space-y-4">
      {entries.length > 1 && (
        <EntrySwitcher
          entries={entries.map((e) => ({ id: e.id, label: e.label }))}
          currentId={entry.id}
        />
      )}

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <p className="text-sm text-zinc-400">
          {user.displayName} · {entry.label}
        </p>
        <div className="mt-1 flex items-baseline gap-3">
          <p className="text-4xl font-bold text-emerald-400">
            {formatPoints(stats.total)}
          </p>
          <p className="text-sm text-zinc-400">
            points
            {mine ? ` · ${ordinal(mine.rank)} of ${rows.length}` : ''}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Exact scores" value={String(stats.exactCount)} />
        <Stat label="Scorer hits" value={String(stats.scorerHits)} />
        <Stat label="Outcomes" value={String(mine?.outcomeCount ?? 0)} />
        <Stat label="Accuracy" value={`${Math.round(stats.accuracyPct)}%`} />
        <Stat label="Current streak" value={String(stats.currentStreak)} />
        <Stat label="Best streak" value={String(stats.bestStreak)} />
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-300">
        <p>
          Picks made: <strong>{stats.picksMade}</strong>
        </p>
        <p className="mt-1">
          Finished matches picked:{' '}
          <strong>
            {stats.finishedPicked} of {finishedTotal}
          </strong>
        </p>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="text-sm font-semibold text-zinc-400">Badges</h2>
        {stats.badges.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {stats.badges.map((badge) => (
              <Badge key={badge}>{badge}</Badge>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-zinc-500">
            No badges yet — keep picking.
          </p>
        )}
      </div>

      <LogoutButton />
    </div>
  );
}
