import { and, eq, inArray } from 'drizzle-orm';
import { schema } from '@/db';
import { nowMs } from '@/lib/clock';
import { oddsForDisplay } from '@/lib/odds';
import { canonicalScorer } from '@/lib/scoring';
import { getMatchdayOverview, getTodayBoard } from '@/lib/services/today';
import { getLiveBoards } from '@/lib/services/live';
import { squadDisplayNames } from '@/lib/services/squads';
import { UNDERDOG_PROB_MAX } from '@/lib/sync/espn-sync';
import { shortTeamName } from '../_components/flags';
import EmptyState from '@/components/EmptyState';
import EntrySwitcher from '../_components/EntrySwitcher';
import TodayBoard from '../_components/TodayBoard';
import LiveNow from '../_components/LiveNow';
import DayNav from '../_components/DayNav';
import {
  loadLeagueContext,
  pickSelectedEntry,
} from '../_components/league-data';
import CommissionerCard from '../_components/CommissionerCard';
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
  searchParams: Promise<{ entry?: string | string[]; day?: string | string[] }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await loadLeagueContext(slug);
  if (!ctx.isMember) return null; // layout renders the join prompt
  const { db, league, entries } = ctx;

  const entry = pickSelectedEntry(entries, sp.entry);
  if (!entry) {
    return (
      <CommissionerCard slug={slug} isAdmin={ctx.isAdmin} />
    );
  }

  // Live scoring values for the in-context explainer (never hardcoded).
  let scoringPoints = { exact: 10, outcome: 2, scorer: 8, firstTeam: 2, underdog: 5 };
  try {
    scoringPoints = { ...scoringPoints, ...JSON.parse(league.scoringRules) };
  } catch {
    // defaults stand if the JSON is ever malformed
  }

  const rawDay = Array.isArray(sp.day) ? sp.day[0] : sp.day;
  const requestedDay =
    rawDay !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(rawDay) ? rawDay : undefined;
  const overview = getMatchdayOverview(db, league.id, entry.id);
  const board = await getTodayBoard(db, league.id, entry.id, requestedDay);
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

  // Squads for the scorer picker — only for teams actually on the board.
  // squadDisplayNames shares the server validator's fallback chain (players
  // table → data/rosters.json), so the dropdown offers exactly the names the
  // save will accept. `null` marks an unknown (TBD) side — the client then
  // defers scorer validation to the server's all-squads rule.
  const boardTeamIds = [
    ...new Set(
      rawItems
        .flatMap((i) => [i.match.homeTeamId, i.match.awayTeamId])
        .filter((id): id is number => id !== null),
    ),
  ];
  const squadByTeam = new Map<number, string[]>(
    boardTeamIds.map((teamId) => [teamId, squadDisplayNames(db, teamId)]),
  );
  const squadOf = (teamId: number | null): string[] | null =>
    teamId !== null ? (squadByTeam.get(teamId) ?? []) : null;

  // Betting cheat sheet: parsed odds (fresh within 6h) + first-goalscorer
  // prices for the board's matches. Display-only; absent rows render nothing.
  // Matches that never render an odds strip — locked, or already finished
  // (the admin can enter a result ahead of kickoff) — are gated out here too,
  // otherwise their lines would ship unrendered inside the serialized RSC
  // payload.
  const ODDS_FRESH_MS = 6 * 3600_000;
  const nowMsVal = nowMs();
  const scorerOddsRows =
    rawItems.length > 0
      ? db
          .select()
          .from(schema.scorerOdds)
          .where(inArray(schema.scorerOdds.matchId, rawItems.map((i) => i.match.id)))
          .all()
      : [];
  const scorerOddsByMatch = new Map<number, Record<string, string>>();
  for (const r of scorerOddsRows) {
    const m = scorerOddsByMatch.get(r.matchId) ?? {};
    m[r.playerName] = r.american;
    scorerOddsByMatch.set(r.matchId, m);
  }
  const oddsOf = (
    match: { oddsJson: string | null; oddsUpdatedAt: number | null },
    locked: boolean,
  ) =>
    oddsForDisplay(match, { nowMs: nowMsVal, locked, freshMs: ODDS_FRESH_MS });

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
    // Finished cards never render odds even when the result landed pre-kickoff
    // (locked=false), so hide their lines from the payload as well.
    const hideOdds = locked || match.status === 'finished';
    const teamsTbd = match.homeTeamId === null || match.awayTeamId === null;
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
      // Result scorer gets the same canonical squad spelling as the pick —
      // the finished card shows both, and they must never disagree.
      firstScorer: canonicalScorer(match.firstScorer, [
        ...(squadOf(match.homeTeamId) ?? []),
        ...(squadOf(match.awayTeamId) ?? []),
      ]),
      liveHome: match.liveHome,
      liveAway: match.liveAway,
      liveStatus: match.liveStatus,
      liveClock: match.liveClock,
      // Same canonical spelling as the result/pick scorers above.
      liveFirstScorer: canonicalScorer(match.liveFirstScorer, [
        ...(squadOf(match.homeTeamId) ?? []),
        ...(squadOf(match.awayTeamId) ?? []),
      ]),
      // Raw feed spelling too: the sweat line's hit/miss verdict must run the
      // engine's own scorerMatches on the same raw strings scoring will see
      // at full time — the canonical name above is for display only.
      liveFirstScorerRaw: match.liveFirstScorer,
      liveFirstScoringTeam: match.liveFirstScoringTeam as FirstTeam | null,
      liveUpdatedAt: match.liveUpdatedAt,
      // Display-only underdog flag, and only while the card is open — the
      // odds strip's payload-hygiene rule applies to the flag too.
      underdogSide:
        hideOdds || match.underdogTeamId === null
          ? null
          : match.underdogTeamId === match.homeTeamId
            ? 'home'
            : match.underdogTeamId === match.awayTeamId
              ? 'away'
              : null,
      homeSquad: squadOf(match.homeTeamId),
      awaySquad: squadOf(match.awayTeamId),
      teamsTbd,
      odds: oddsOf(match, hideOdds),
      scorerOdds: hideOdds ? {} : (scorerOddsByMatch.get(match.id) ?? {}),
      myPick: myPick
        ? {
            predHome: myPick.predHome,
            predAway: myPick.predAway,
            // Canonical squad spelling ("Raul Jimenez" → "Raúl Jiménez") so a
            // stored raw-typed pick never disagrees with the squad list shown
            // inches away. New saves canonicalize at write (upsertPick).
            predScorer: canonicalScorer(myPick.predScorer, [
              ...(squadOf(match.homeTeamId) ?? []),
              ...(squadOf(match.awayTeamId) ?? []),
            ]),
            // As stored — the engine scores the raw pick, so the sweat line
            // must judge the raw pick too (see liveFirstScorerRaw above).
            predScorerRaw: myPick.predScorer,
            predFirstTeam: myPick.predFirstTeam as FirstTeam | null,
          }
        : null,
      boosted,
      boosterDisabled:
        locked ||
        match.status === 'finished' ||
        teamsTbd || // server rejects boosters on TBD matchups (409)
        (!boosted && !(movableByDay.get(match.matchday) ?? true)),
      points: point ? { total: point.total, breakdown } : null,
    };
  });

  const headerBooster =
    boardMatchday !== null ? boosterByDay.get(boardMatchday) : undefined;
  const headerHolder = headerBooster
    ? items.find((i) => i.matchId === headerBooster.matchId)
    : undefined;
  // Codes (CAN vs BIH) keep the chip inside the 390px utility row — full FIFA
  // names ("Bosnia and Herzegovina") overflowed the viewport when armed.
  const shortSide = (name: string, code: string | null) =>
    code ?? shortTeamName(name);
  const boosterLabel = headerBooster
    ? `On ${
        headerHolder
          ? `${shortSide(headerHolder.homeName, headerHolder.homeCode)} vs ${shortSide(headerHolder.awayName, headerHolder.awayCode)}`
          : `match #${headerBooster.matchId}`
      }`
    : 'Booster available';

  // One shared stage eyebrow when every fixture is the same stage — cards then
  // drop their per-card stage caption (pure repetition on single-stage days).
  // The day header itself renders inside TodayBoard so its pick-progress count
  // updates live as picks save.
  const stages = [...new Set(items.map((i) => i.stage))];
  const commonStage = stages.length === 1 ? stages[0] : null;

  const liveBoards = getLiveBoards(db, league.id);

  // Missing-picks radar: gaps on pickable days OTHER than the one on screen
  // (the header's "n/m picked" already owns the visible day). Deep-links to
  // the first day with a gap, preserving ?entry= for multi-entry users.
  const gapDays = overview.days.filter(
    (d) => d.matchday !== boardMatchday && d.missingPickCount > 0,
  );
  const missingCount = gapDays.reduce(
    (sum, d) => sum + d.missingPickCount,
    0,
  );
  const rawEntry = Array.isArray(sp.entry) ? sp.entry[0] : sp.entry;
  const gapParams = new URLSearchParams();
  if (rawEntry) gapParams.set('entry', rawEntry);
  if (gapDays.length > 0) gapParams.set('day', gapDays[0].matchday);
  const missingAhead =
    missingCount > 0
      ? {
          count: missingCount,
          firstGapDay: gapDays[0].matchday,
          href: `/league/${slug}/today?${gapParams.toString()}`,
        }
      : null;

  return (
    <div className="space-y-4">
      <LiveNow slug={slug} initial={liveBoards} serverNowMs={nowMs()} />
      {entries.length > 1 && (
        <EntrySwitcher
          entries={entries.map((e) => ({ id: e.id, label: e.label }))}
          currentId={entry.id}
        />
      )}
      {boardMatchday !== null && items.length > 0 ? (
        <TodayBoard
          entryId={entry.id}
          dayNav={
            overview.currentDay !== null && boardMatchday !== null ? (
              <DayNav
                slug={slug}
                viewedDay={boardMatchday}
                currentDay={overview.currentDay}
                days={overview.days}
                nextDayHasGaps={overview.nextDayHasGaps}
              />
            ) : null
          }
          isFutureDay={
            overview.currentDay !== null &&
            boardMatchday !== null &&
            boardMatchday > overview.currentDay
          }
          serverNowMs={nowMs()}
          boosterMultiplier={league.boosterMultiplier}
          items={items}
          commonStage={commonStage}
          matchday={boardMatchday}
          boosterLabel={boosterLabel}
          boosterArmed={headerBooster !== undefined}
          points={scoringPoints}
          underdogPctMax={Math.round(UNDERDOG_PROB_MAX * 100)}
          missingAhead={missingAhead}
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
