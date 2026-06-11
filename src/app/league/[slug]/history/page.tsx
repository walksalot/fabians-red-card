import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import EntrySwitcher from '../_components/EntrySwitcher';
import HistoryList from '../_components/HistoryList';
import {
  loadLeagueContext,
  pickSelectedEntry,
  type MatchRow,
} from '../_components/league-data';
import type {
  BreakdownView,
  FirstTeam,
  HistoryDayView,
} from '../_components/types';

export default async function HistoryPage({
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
  const { db, entries } = ctx;

  const entry = pickSelectedEntry(entries, sp.entry);
  if (!entry) {
    return (
      <p className="text-zinc-400">No entry found for you in this league.</p>
    );
  }

  const finished = db
    .select()
    .from(schema.matches)
    .where(eq(schema.matches.status, 'finished'))
    .all();
  const myPicks = db
    .select()
    .from(schema.picks)
    .where(eq(schema.picks.entryId, entry.id))
    .all();
  const myPoints = db
    .select()
    .from(schema.matchPoints)
    .where(eq(schema.matchPoints.entryId, entry.id))
    .all();
  const teamRows = db.select().from(schema.teams).all();

  const pickByMatch = new Map(myPicks.map((p) => [p.matchId, p]));
  const pointByMatch = new Map(myPoints.map((p) => [p.matchId, p]));
  const teamMap = new Map(teamRows.map((t) => [t.id, t]));
  const nameOf = (teamId: number | null, placeholder: string | null) =>
    teamId !== null
      ? (teamMap.get(teamId)?.name ?? 'TBD')
      : (placeholder ?? 'TBD');
  const codeOf = (teamId: number | null) =>
    teamId !== null ? (teamMap.get(teamId)?.code ?? null) : null;

  // Group by matchday, newest day first; kickoff order within a day.
  const byDay = new Map<string, MatchRow[]>();
  for (const match of finished) {
    const bucket = byDay.get(match.matchday);
    if (bucket) bucket.push(match);
    else byDay.set(match.matchday, [match]);
  }
  const days = [...byDay.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

  const groups: HistoryDayView[] = days.map((day) => {
    const dayMatches = byDay
      .get(day)!
      .slice()
      .sort((a, b) =>
        a.kickoffUtc < b.kickoffUtc
          ? -1
          : a.kickoffUtc > b.kickoffUtc
            ? 1
            : a.id - b.id,
      );
    let subtotal = 0;
    const items = dayMatches.map((m) => {
      const pick = pickByMatch.get(m.id) ?? null;
      const point = pointByMatch.get(m.id) ?? null;
      let breakdown: BreakdownView | null = null;
      if (point) {
        subtotal += point.total;
        try {
          breakdown = JSON.parse(point.breakdown) as BreakdownView;
        } catch {
          breakdown = null;
        }
      }
      return {
        matchId: m.id,
        stage: m.stage,
        kickoffUtc: m.kickoffUtc,
        homeName: nameOf(m.homeTeamId, m.homePlaceholder),
        awayName: nameOf(m.awayTeamId, m.awayPlaceholder),
        homeCode: codeOf(m.homeTeamId),
        awayCode: codeOf(m.awayTeamId),
        homeScore: m.homeScore ?? 0,
        awayScore: m.awayScore ?? 0,
        firstScorer: m.firstScorer,
        firstScoringTeam: m.firstScoringTeam as FirstTeam | null,
        myPick: pick
          ? {
              predHome: pick.predHome,
              predAway: pick.predAway,
              predScorer: pick.predScorer,
              predFirstTeam: pick.predFirstTeam as FirstTeam | null,
            }
          : null,
        breakdown,
        total: point ? point.total : null,
      };
    });
    return { matchday: day, subtotal, items };
  });

  return (
    <div className="space-y-4">
      {entries.length > 1 && (
        <EntrySwitcher
          entries={entries.map((e) => ({ id: e.id, label: e.label }))}
          currentId={entry.id}
        />
      )}
      <HistoryList groups={groups} />
    </div>
  );
}
