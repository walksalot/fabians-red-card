/**
 * Road to the Final: a pure tree-builder over the knockout matches (73–104).
 * The seeded placeholders literally encode the bracket ("Winners Match 74"),
 * so the tree is derived, never hardcoded. Read-only: consumes match rows,
 * produces a display model — no writes, no scoring.
 */

export interface BracketMatchRow {
  id: number;
  stage: string; // 'r32' | 'r16' | 'qf' | 'sf' | 'third' | 'final'
  kickoffUtc: string;
  matchday: string;
  venue: string;
  city: string;
  status: string; // 'scheduled' | 'finished'
  homeTeamId: number | null;
  awayTeamId: number | null;
  homePlaceholder: string | null;
  awayPlaceholder: string | null;
  homeScore: number | null;
  awayScore: number | null;
  liveStatus: string | null;
  liveHome: number | null;
  liveAway: number | null;
  liveClock: string | null;
}

export interface BracketTeamRef {
  id: number;
  code: string;
  name: string;
}

export interface BracketSide {
  team: BracketTeamRef | null;
  placeholder: string | null;
  /** Codes this slot could still resolve to (empty = unknown/group-sourced). */
  possibleCodes: string[];
  score: number | null;
  /** True when this side is the (known or inferred) winner of a finished tie. */
  won: boolean;
  /** True when the side lost a finished tie (dim it). */
  lost: boolean;
}

export interface BracketNode {
  matchId: number;
  stage: string;
  kickoffUtc: string;
  matchday: string;
  venue: string;
  city: string;
  status: string;
  live: boolean;
  liveClock: string | null;
  home: BracketSide;
  away: BracketSide;
  /** Feeder match ids parsed from the placeholders (empty for R32). */
  feeders: number[];
  /** Finished level tie decided on penalties; winner known only via the next round. */
  decidedOnPens: boolean;
  /** Every code that could still appear in this match (drives follow-a-team). */
  possibleCodes: string[];
}

const FEEDER_RE = /(?:Winners|Losers)\s+Match\s+(\d+)/i;

function parseFeeder(placeholder: string | null): number | null {
  if (!placeholder) return null;
  const m = FEEDER_RE.exec(placeholder);
  return m ? Number(m[1]) : null;
}

/**
 * Build display nodes for the given stages (kickoff-ordered within stage).
 * Winner inference for finished ties: score margin when there is one;
 * penalties (level score) are inferred from which team advanced into the
 * child match once the next round's slot fills — until then neither side is
 * marked won/lost and `decidedOnPens` flags the tie.
 */
export function buildBracket(
  matches: BracketMatchRow[],
  teams: Map<number, BracketTeamRef>,
  stages: string[] = ['r32', 'r16', 'qf', 'sf', 'final'],
): BracketNode[] {
  const byId = new Map(matches.map((m) => [m.id, m]));

  // Which team ids appear in the child that a finished feeder flows into —
  // the penalties winner inference.
  const childTeamIds = new Map<number, Set<number>>(); // feederId -> child's team ids
  for (const m of matches) {
    for (const ph of [m.homePlaceholder, m.awayPlaceholder]) {
      const feeder = parseFeeder(ph);
      if (feeder === null) continue;
      const set = childTeamIds.get(feeder) ?? new Set<number>();
      if (m.homeTeamId !== null) set.add(m.homeTeamId);
      if (m.awayTeamId !== null) set.add(m.awayTeamId);
      childTeamIds.set(feeder, set);
    }
  }

  const possibleCache = new Map<number, string[]>();
  const possibleOf = (id: number): string[] => {
    const cached = possibleCache.get(id);
    if (cached) return cached;
    const m = byId.get(id);
    if (!m) return [];
    let codes: string[] = [];
    if (m.homeTeamId !== null && m.awayTeamId !== null) {
      codes = [m.homeTeamId, m.awayTeamId]
        .map((t) => teams.get(t)?.code)
        .filter((c): c is string => !!c);
    } else {
      const feeders = [parseFeeder(m.homePlaceholder), parseFeeder(m.awayPlaceholder)];
      const set = new Set<string>();
      // A known side of a half-filled tie still counts.
      for (const t of [m.homeTeamId, m.awayTeamId]) {
        const code = t !== null ? teams.get(t)?.code : undefined;
        if (code) set.add(code);
      }
      for (const f of feeders) {
        if (f !== null) for (const c of possibleOf(f)) set.add(c);
      }
      codes = [...set];
    }
    possibleCache.set(id, codes);
    return codes;
  };

  const sideOf = (
    m: BracketMatchRow,
    teamId: number | null,
    placeholder: string | null,
    score: number | null,
    otherScore: number | null,
  ): BracketSide => {
    const team = teamId !== null ? (teams.get(teamId) ?? null) : null;
    const feeder = parseFeeder(placeholder);
    const possibleCodes =
      team !== null ? [team.code] : feeder !== null ? possibleOf(feeder) : [];
    let won = false;
    let lost = false;
    if (m.status === 'finished' && score !== null && otherScore !== null) {
      if (score > otherScore) won = true;
      else if (score < otherScore) lost = true;
      else if (teamId !== null) {
        // Level after extra time: penalties. The advancer shows up in the
        // child round; until it does, neither side is marked.
        const advanced = childTeamIds.get(m.id);
        if (advanced && advanced.size > 0) {
          if (advanced.has(teamId)) won = true;
          else {
            // Only mark lost when the OTHER side is confirmed advanced —
            // a child filled from elsewhere must not eliminate anyone.
            const otherId = m.homeTeamId === teamId ? m.awayTeamId : m.homeTeamId;
            if (otherId !== null && advanced.has(otherId)) lost = true;
          }
        }
      }
    }
    return { team, placeholder, possibleCodes, score, won, lost };
  };

  const stageOrder = new Map(stages.map((s, i) => [s, i]));
  return matches
    .filter((m) => stageOrder.has(m.stage))
    .sort(
      (a, b) =>
        (stageOrder.get(a.stage)! - stageOrder.get(b.stage)!) ||
        a.kickoffUtc.localeCompare(b.kickoffUtc) ||
        a.id - b.id,
    )
    .map((m) => {
      const home = sideOf(m, m.homeTeamId, m.homePlaceholder, m.homeScore, m.awayScore);
      const away = sideOf(m, m.awayTeamId, m.awayPlaceholder, m.awayScore, m.homeScore);
      const feeders = [parseFeeder(m.homePlaceholder), parseFeeder(m.awayPlaceholder)].filter(
        (f): f is number => f !== null,
      );
      return {
        matchId: m.id,
        stage: m.stage,
        kickoffUtc: m.kickoffUtc,
        matchday: m.matchday,
        venue: m.venue,
        city: m.city,
        status: m.status,
        live: m.status !== 'finished' && m.liveStatus === 'in',
        liveClock: m.liveClock,
        home,
        away,
        feeders,
        decidedOnPens:
          m.status === 'finished' &&
          m.homeScore !== null &&
          m.homeScore === m.awayScore,
        possibleCodes: [...new Set([...home.possibleCodes, ...away.possibleCodes])],
      };
    });
}
