import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import { getLeaderboard } from '@/lib/services/leaderboard';
import { prizePool } from '@/lib/services/leagues';
import LiveTable from '../_components/LiveTable';
import { loadLeagueContext } from '../_components/league-data';
import type { LeaderboardRowView, PrizePoolView } from '../_components/types';

export default async function TablePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await loadLeagueContext(slug);
  if (!ctx.isMember) return null; // layout renders the join prompt
  const { db, league } = ctx;

  const rows = (await getLeaderboard(db, league.id)) as LeaderboardRowView[];
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

  return (
    <LiveTable
      slug={slug}
      initialRows={rows}
      initialPool={pool}
      initialMemberCount={memberCount}
      buyInCents={league.buyInCents}
      currency={league.currency}
    />
  );
}
