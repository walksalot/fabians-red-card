import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import { nowMs } from '@/lib/clock';
import { buildBracket, feederMapFromFixtures, type BracketTeamRef } from '@/lib/bracket';
import fixtures from '../../../../../data/fixtures.json';
import { resolveCurrentMatchday } from '@/lib/services/today';
import { loadLeagueContext, pickSelectedEntry } from '../_components/league-data';
import BracketTree from '../_components/BracketTree';

/**
 * Road to the Final — the knockout tree, filled in automatically as results
 * land. Read-only: every node comes straight from the matches table; taps
 * deep-link to the pick screen for days that are still pickable.
 */
export default async function BracketPage({
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
  const { db } = ctx;

  const all = db.select().from(schema.matches).all();
  const teams = new Map<number, BracketTeamRef>(
    db
      .select({ id: schema.teams.id, code: schema.teams.code, name: schema.teams.name })
      .from(schema.teams)
      .all()
      .map((t) => [t.id, t]),
  );
  // The DB erases "Winners Match N" placeholders as slots fill; the fixtures
  // file is the immutable wiring, so connectors survive team auto-fill.
  const nodes = buildBracket(all, teams, undefined, feederMapFromFixtures(fixtures));
  const currentDay = resolveCurrentMatchday(all, nowMs());

  // Display-only pick marks for "picked — tap to change" captions. Honors
  // ?entry= like every other league page, so multi-entry users see (and
  // deep-link into) the entry they actually have selected.
  const entry = pickSelectedEntry(ctx.entries, sp.entry);
  const rawEntry = Array.isArray(sp.entry) ? sp.entry[0] : sp.entry;
  const entryParam = rawEntry && entry && Number(rawEntry) === entry.id ? rawEntry : null;
  const pickedMatchIds = entry
    ? db
        .select({ matchId: schema.picks.matchId })
        .from(schema.picks)
        .where(eq(schema.picks.entryId, entry.id))
        .all()
        .map((p) => p.matchId)
    : [];

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
          href={`/league/${slug}/today${entryParam ? `?entry=${encodeURIComponent(entryParam)}` : ''}`}
          className="chip relative shrink-0 bg-zinc-800/80 text-zinc-300 ring-1 ring-inset ring-white/10 before:absolute before:inset-x-0 before:-inset-y-2 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
        >
          ← Today
        </Link>
      </div>
      <BracketTree
        slug={slug}
        nodes={nodes}
        currentDay={currentDay}
        serverNowMs={nowMs()}
        pickedMatchIds={pickedMatchIds}
        entryParam={entryParam}
      />
    </div>
  );
}
