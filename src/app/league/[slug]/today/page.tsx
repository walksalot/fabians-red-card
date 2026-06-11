import { and, eq, inArray } from 'drizzle-orm';
import { schema } from '@/db';
import { nowMs } from '@/lib/clock';
import { getTodayBoard } from '@/lib/services/today';
import EmptyState from '@/components/EmptyState';
import EntrySwitcher from '../_components/EntrySwitcher';
import TodayBoard from '../_components/TodayBoard';
import {
  loadLeagueContext,
  pickSelectedEntry,
} from '../_components/league-data';
import type {
  BreakdownView,
  FirstTeam,
  TodayMatchView,
} from '../_components/types';

export default async function TodayPage({
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
  const { db, league, entries } = ctx;

  const entry = pickSelectedEntry(entries, sp.entry);
  if (!entry) {
    return (
      <p className="text-zinc-400">No entry found for you in this league.</p>
    );
  }

  const board = await getTodayBoard(db, league.id, entry.id);
  const boardMatchday = board?.matchday ?? null;
  const rawItems = board?.matches ?? [];

  const teamRows = db.select().from(schema.teams).all();
  const teamMap = new Map(teamRows.map((t) => [t.id, t]));
  const nameOf = (teamId: number | null, placeholder: string | null) =>
    teamId !== null
      ? (teamMap.get(teamId)?.name ?? 'TBD')
      : (placeholder ?? 'TBD');
  const codeOf = (teamId: number | null) =>
    teamId !== null ? (teamMap.get(teamId)?.code ?? null) : null;

  // The booster row(s) for the matchday(s) on the board (board can span the
  // in-progress matchday plus the next one).
  const days = [...new Set(rawItems.map((i) => i.match.matchday))];
  const boosterRows =
    days.length > 0
      ? db
          .select()
          .from(schema.boosters)
          .where(
            and(
              eq(schema.boosters.entryId, entry.id),
              inArray(schema.boosters.matchday, days),
            ),
          )
          .all()
      : [];
  const boosterByDay = new Map(boosterRows.map((b) => [b.matchday, b]));

  // Points already earned on finished matches shown on the board.
  const finishedIds = rawItems
    .filter((i) => i.match.status === 'finished')
    .map((i) => i.match.id);
  const pointRows =
    finishedIds.length > 0
      ? db
          .select()
          .from(schema.matchPoints)
          .where(
            and(
              eq(schema.matchPoints.entryId, entry.id),
              inArray(schema.matchPoints.matchId, finishedIds),
            ),
          )
          .all()
      : [];
  const pointsByMatch = new Map(pointRows.map((p) => [p.matchId, p]));

  // A booster can only move while the match currently holding it has not kicked off.
  const movableByDay = new Map<string, boolean>();
  for (const day of days) {
    const b = boosterByDay.get(day);
    if (!b) {
      movableByDay.set(day, true);
      continue;
    }
    const holder = rawItems.find((i) => i.match.id === b.matchId);
    movableByDay.set(
      day,
      holder ? !holder.locked && holder.match.status !== 'finished' : false,
    );
  }

  const items: TodayMatchView[] = rawItems.map(({ match, myPick, locked }) => {
    const boosted = boosterByDay.get(match.matchday)?.matchId === match.id;
    const point = pointsByMatch.get(match.id);
    let breakdown: BreakdownView | null = null;
    if (point) {
      try {
        breakdown = JSON.parse(point.breakdown) as BreakdownView;
      } catch {
        breakdown = null;
      }
    }
    return {
      matchId: match.id,
      matchday: match.matchday,
      kickoffUtc: match.kickoffUtc,
      stage: match.stage,
      homeName: nameOf(match.homeTeamId, match.homePlaceholder),
      awayName: nameOf(match.awayTeamId, match.awayPlaceholder),
      homeCode: codeOf(match.homeTeamId),
      awayCode: codeOf(match.awayTeamId),
      venue: match.venue,
      city: match.city,
      status: match.status === 'finished' ? 'finished' : 'scheduled',
      locked,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      firstScorer: match.firstScorer,
      liveHome: match.liveHome,
      liveAway: match.liveAway,
      liveStatus: match.liveStatus,
      myPick: myPick
        ? {
            predHome: myPick.predHome,
            predAway: myPick.predAway,
            predScorer: myPick.predScorer,
            predFirstTeam: myPick.predFirstTeam as FirstTeam | null,
          }
        : null,
      boosted,
      boosterDisabled:
        locked ||
        match.status === 'finished' ||
        (!boosted && !(movableByDay.get(match.matchday) ?? true)),
      points: point ? { total: point.total, breakdown } : null,
    };
  });

  const headerBooster =
    boardMatchday !== null ? boosterByDay.get(boardMatchday) : undefined;
  const headerHolder = headerBooster
    ? items.find((i) => i.matchId === headerBooster.matchId)
    : undefined;
  const boosterLabel = headerBooster
    ? `On ${
        headerHolder
          ? `${headerHolder.homeName} vs ${headerHolder.awayName}`
          : `match #${headerBooster.matchId}`
      }`
    : 'Booster available';

  // One shared stage eyebrow when every fixture is the same stage — cards then
  // drop their per-card stage caption (pure repetition on single-stage days).
  // The day header itself renders inside TodayBoard so its pick-progress count
  // updates live as picks save.
  const stages = [...new Set(items.map((i) => i.stage))];
  const commonStage = stages.length === 1 ? stages[0] : null;

  return (
    <div className="space-y-4">
      {entries.length > 1 && (
        <EntrySwitcher
          entries={entries.map((e) => ({ id: e.id, label: e.label }))}
          currentId={entry.id}
        />
      )}
      {boardMatchday !== null && items.length > 0 ? (
        <TodayBoard
          entryId={entry.id}
          serverNowMs={nowMs()}
          boosterMultiplier={league.boosterMultiplier}
          items={items}
          commonStage={commonStage}
          matchday={boardMatchday}
          boosterLabel={boosterLabel}
          boosterArmed={headerBooster !== undefined}
        />
      ) : (
        <EmptyState
          title="No matches on the board"
          sub="The tournament schedule is clear for now — picks open when the next matchday lands."
        />
      )}
    </div>
  );
}
