import { eq, inArray } from 'drizzle-orm';
import { schema } from '@/db';
import { canonicalScorer } from '@/lib/scoring';
import { computeMatchdayWrap } from '@/lib/services/wrap';
import {
  buildBracket,
  feederMapFromFixtures,
  type BracketTeamRef,
} from '@/lib/bracket';
import fixtures from '../../../../../data/fixtures.json';
import type { WrapCardView } from '../_components/WrapCard';
import EntrySwitcher from '../_components/EntrySwitcher';
import HistoryList from '../_components/HistoryList';
import {
  loadLeagueContext,
  pickSelectedEntry,
  type MatchRow,
} from '../_components/league-data';
import CommissionerCard from '../_components/CommissionerCard';
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
  const { db, league, entries } = ctx;

  const entry = pickSelectedEntry(entries, sp.entry);
  if (!entry) {
    return (
      <CommissionerCard slug={slug} isAdmin={ctx.isAdmin} />
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

  // Penalties context: reuse the bracket's decidedOnPens/advancer inference
  // (bracket.ts) — level knockout scores read as unfinished without it. Needs
  // ALL matches (the advancer shows up in the next round's slot).
  const bracketTeams = new Map<number, BracketTeamRef>(
    teamRows.map((t) => [t.id, { id: t.id, code: t.code, name: t.name }]),
  );
  const bracketNodes = buildBracket(
    db.select().from(schema.matches).all(),
    bracketTeams,
    undefined,
    feederMapFromFixtures(fixtures),
  );
  const nodeById = new Map(bracketNodes.map((n) => [n.matchId, n]));
  const nameOf = (teamId: number | null, placeholder: string | null) =>
    teamId !== null
      ? (teamMap.get(teamId)?.name ?? 'TBD')
      : (placeholder ?? 'TBD');
  const codeOf = (teamId: number | null) =>
    teamId !== null ? (teamMap.get(teamId)?.code ?? null) : null;

  // Squads for the finished matches' teams — canonical scorer spelling only
  // (same display rule as Today: "Raul Jimenez" renders as "Raúl Jiménez").
  const finishedTeamIds = [
    ...new Set(
      finished
        .flatMap((m) => [m.homeTeamId, m.awayTeamId])
        .filter((id): id is number => id !== null),
    ),
  ];
  const squadByTeam = new Map<number, string[]>();
  if (finishedTeamIds.length > 0) {
    for (const p of db
      .select({ teamId: schema.players.teamId, name: schema.players.name })
      .from(schema.players)
      .where(inArray(schema.players.teamId, finishedTeamIds))
      .all()) {
      const list = squadByTeam.get(p.teamId) ?? [];
      list.push(p.name);
      squadByTeam.set(p.teamId, list);
    }
  }
  const squadOf = (teamId: number | null) =>
    teamId !== null ? (squadByTeam.get(teamId) ?? []) : [];

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
      const node = nodeById.get(m.id);
      const decidedOnPens = node?.decidedOnPens ?? false;
      return {
        matchId: m.id,
        stage: m.stage,
        kickoffUtc: m.kickoffUtc,
        decidedOnPens,
        pensAdvancer: decidedOnPens
          ? node?.home.won
            ? (node.home.team?.name ?? null)
            : node?.away.won
              ? (node.away.team?.name ?? null)
              : null
          : null,
        homeName: nameOf(m.homeTeamId, m.homePlaceholder),
        awayName: nameOf(m.awayTeamId, m.awayPlaceholder),
        homeCode: codeOf(m.homeTeamId),
        awayCode: codeOf(m.awayTeamId),
        homeScore: m.homeScore ?? 0,
        awayScore: m.awayScore ?? 0,
        // Same canonical spelling as the pick line on the same card.
        firstScorer: canonicalScorer(m.firstScorer, [
          ...squadOf(m.homeTeamId),
          ...squadOf(m.awayTeamId),
        ]),
        firstScoringTeam: m.firstScoringTeam as FirstTeam | null,
        myPick: pick
          ? {
              predHome: pick.predHome,
              predAway: pick.predAway,
              predScorer: canonicalScorer(pick.predScorer, [
                ...squadOf(m.homeTeamId),
                ...squadOf(m.awayTeamId),
              ]),
              predFirstTeam: pick.predFirstTeam as FirstTeam | null,
            }
          : null,
        breakdown,
        total: point ? point.total : null,
      };
    });
    return { matchday: day, subtotal, items };
  });

  // Matchday Wraps — the whole league's recap per finished day. Fixture
  // labels ("ENG 2–1 COD") come from the codes already resolved above.
  const matchById = new Map(finished.map((m) => [m.id, m]));
  const fixtureLabel = (matchId: number): string => {
    const m = matchById.get(matchId);
    if (!m) return `match ${matchId}`;
    const side = (teamId: number | null, ph: string | null) =>
      codeOf(teamId) ?? nameOf(teamId, ph);
    // "(pens)" keeps a level knockout score from reading as a typo in prose.
    const pens = nodeById.get(m.id)?.decidedOnPens ? ' (pens)' : '';
    return `${side(m.homeTeamId, m.homePlaceholder)} ${m.homeScore}–${m.awayScore} ${side(m.awayTeamId, m.awayPlaceholder)}${pens}`;
  };
  const wraps: Record<string, WrapCardView> = {};
  for (const day of days) {
    const w = computeMatchdayWrap(db, league.id, day);
    if (!w) continue;
    wraps[day] = {
      matchday: w.matchday,
      matchCount: w.matchCount,
      entryCount: w.entryCount,
      winners: w.dayWinners.map((x) => ({ label: x.label, total: x.total })),
      biggest: w.biggestHaul
        ? {
            // Dedupe by entry: one entry can top MULTIPLE matches in a day
            // (holders is per entry/match pair) and must be named once.
            labels: [
              ...new Map(w.biggestHaul.holders.map((h) => [h.entryId, h.label])).values(),
            ],
            points: w.biggestHaul.points,
            fixtures: [...new Set(w.biggestHaul.holders.map((h) => h.matchId))].map(
              fixtureLabel,
            ),
          }
        : null,
      exactCount: w.exactCount,
      blankedCount: w.blankedCount,
      soleCalls: w.soleCalls.map((x) => ({
        label: x.label,
        fixture: fixtureLabel(x.matchId),
      })),
      bars: w.dayTotals.map((t) => t.total),
    };
  }

  return (
    <div className="space-y-4">
      {entries.length > 1 && (
        <EntrySwitcher
          entries={entries.map((e) => ({ id: e.id, label: e.label }))}
          currentId={entry.id}
        />
      )}
      <HistoryList
        groups={groups}
        slug={slug}
        myEntryId={entry.id}
        wraps={wraps}
      />
    </div>
  );
}
