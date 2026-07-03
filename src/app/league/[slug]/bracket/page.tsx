import Link from 'next/link';
import { schema } from '@/db';
import { nowMs } from '@/lib/clock';
import { buildBracket, type BracketTeamRef } from '@/lib/bracket';
import { resolveCurrentMatchday } from '@/lib/services/today';
import { loadLeagueContext } from '../_components/league-data';
import BracketTree from '../_components/BracketTree';

/**
 * Road to the Final — the knockout tree, filled in automatically as results
 * land. Read-only: every node comes straight from the matches table; taps
 * deep-link to the pick screen for days that are still pickable.
 */
export default async function BracketPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await loadLeagueContext(slug);
  if (!ctx.isMember) return null; // layout renders the join prompt
  const { db } = ctx;

  const all = db.select().from(schema.matches).all();
  const teams = new Map<number, BracketTeamRef>(
    db
      .select({ id: schema.teams.id, code: schema.teams.code, name: schema.teams.name })
      .from(schema.teams)
      .all()
      .map((t) => [t.id, t]),
  );
  const nodes = buildBracket(all, teams);
  const currentDay = resolveCurrentMatchday(all, nowMs());

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
            Knockout bracket
          </p>
          <h2 className="truncate font-display text-lg font-bold tracking-tight text-zinc-50">
            Road to the Final
          </h2>
        </div>
        <Link
          href={`/league/${slug}/today`}
          className="chip shrink-0 bg-zinc-800/80 text-zinc-300 ring-1 ring-inset ring-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
        >
          ← Today
        </Link>
      </div>
      <BracketTree slug={slug} nodes={nodes} currentDay={currentDay} />
    </div>
  );
}
