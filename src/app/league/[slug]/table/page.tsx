import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import { getLeaderboard } from '@/lib/services/leaderboard';
import { prizePool } from '@/lib/services/leagues';
import LiveTable from '../_components/LiveTable';
import LiveNow from '../_components/LiveNow';
import { getLiveBoards } from '@/lib/services/live';
import { loadLeagueContext } from '../_components/league-data';
import { getLockedPicksByEntry } from '../_components/leaderboard-picks';
import { getTodayPointsByEntry } from '../_components/today-points';
import type { LeaderboardRowView, PrizePoolView } from '../_components/types';

export default async function TablePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await loadLeagueContext(slug);
  if (!ctx.isMember) return null; // layout renders the join prompt
  const { db, league, user } = ctx;

  // Season totals + the per-entry "today" delta and locked-pick reveal (same
  // enrichment as the polling /leaderboard API, so the first paint matches
  // every poll after).
  const todayPoints = getTodayPointsByEntry(db, league.id);
  const lockedPicks = getLockedPicksByEntry(db, league.id);
  const rows: LeaderboardRowView[] = (await getLeaderboard(db, league.id)).map(
    (r) => ({
      ...r,
      todayPoints: todayPoints.get(r.entryId) ?? 0,
      lockedPicks: lockedPicks.get(r.entryId) ?? [],
    }),
  );
  const entryCount = db
    .select()
    .from(schema.entries)
    .where(eq(schema.entries.leagueId, league.id))
    .all().length;
  const memberCount = db
    .select()
    .from(schema.memberships)
    .where(eq(schema.memberships.leagueId, league.id))
    .all().length;
  const pool = prizePool(league, entryCount) as PrizePoolView;
  const liveBoards = getLiveBoards(db, league.id);

  return (
    <div className="space-y-4">
      <LiveNow slug={slug} initial={liveBoards} />
      <LiveTable
        slug={slug}
        initialRows={rows}
        initialPool={pool}
        initialMemberCount={memberCount}
        initialEntryCount={entryCount}
        buyInCents={league.buyInCents}
        currency={league.currency}
        meUserId={user.id}
      />
    </div>
  );
}
