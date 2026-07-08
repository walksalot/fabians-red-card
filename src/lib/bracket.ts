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
  /** Shootout tallies of a finished level tie (null when none / not recorded). */
  homePens?: number | null;
  awayPens?: number | null;
  liveStatus: string | null;
  liveHome: number | null;
  liveAway: number | null;
  liveClock: string | null;
  /** Running shootout tallies while penalties are being taken. */
  liveHomePens?: number | null;
  liveAwayPens?: number | null;
  /** Feed's last-write epoch (ms) — drives the stale-feed demotion. */
  liveUpdatedAt?: number | null;
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
  /** Shootout tally for this side ("0 (4)"), live or final; null when none. */
  pens: number | null;
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
  /** Feed's last-write epoch (ms) for live nodes; null when unknown. */
  liveUpdatedAt: number | null;
  home: BracketSide;
  away: BracketSide;
  /** Feeder match ids parsed from the placeholders (empty for R32). */
  feeders: number[];
  /** Finished level tie decided on penalties; winner known only via the next round. */
  decidedOnPens: boolean;
  /** Every code that could still appear in this match (drives follow-a-team). */
  possibleCodes: string[];
}

const FEEDER_RE = /(Winners|Losers)\s+Match\s+(\d+)/i;

/** One slot's upstream game — `losers: true` only on the third-place tie. */
export interface FeederSlot {
  match: number;
  losers: boolean;
}

function parseFeeder(placeholder: string | null): FeederSlot | null {
  if (!placeholder) return null;
  const m = FEEDER_RE.exec(placeholder);
  return m ? { match: Number(m[2]), losers: m[1].toLowerCase() === 'losers' } : null;
}

/** Per-match feeder slots in [home, away] order (null = group-sourced slot). */
export type FeederMap = Map<number, readonly [FeederSlot | null, FeederSlot | null]>;

/**
 * Derive the immutable bracket wiring from the seeded fixtures file. The DB
 * placeholders are erased when a slot fills with a real team, so the tree
 * must come from a source results can't touch. Match ids equal fixture `n`.
 */
export function feederMapFromFixtures(
  rows: Array<{ n: number; home: string; away: string }>,
): FeederMap {
  const map: FeederMap = new Map();
  for (const r of rows) {
    const home = parseFeeder(r.home);
    const away = parseFeeder(r.away);
    if (home !== null || away !== null) map.set(r.n, [home, away]);
  }
  return map;
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
  feederMap?: FeederMap,
): BracketNode[] {
  const byId = new Map(matches.map((m) => [m.id, m]));

  // Placeholders are the primary wiring, but they're NULLed once a slot
  // fills with a real team — the fixtures-derived map keeps the tree whole.
  const feedersFor = (m: BracketMatchRow): readonly [FeederSlot | null, FeederSlot | null] => {
    const fallback = feederMap?.get(m.id);
    return [
      parseFeeder(m.homePlaceholder) ?? fallback?.[0] ?? null,
      parseFeeder(m.awayPlaceholder) ?? fallback?.[1] ?? null,
    ];
  };

  // Which team ids appear in the child that a finished feeder's WINNER flows
  // into — the penalties winner inference. Losers feeds (the third-place tie)
  // must stay out: its teams are the semifinal LOSERS, and counting them
  // would mark both sides of a tied semifinal as advanced.
  const childTeamIds = new Map<number, Set<number>>(); // feederId -> child's team ids
  for (const m of matches) {
    for (const feeder of feedersFor(m)) {
      if (feeder === null || feeder.losers) continue;
      const set = childTeamIds.get(feeder.match) ?? new Set<number>();
      if (m.homeTeamId !== null) set.add(m.homeTeamId);
      if (m.awayTeamId !== null) set.add(m.awayTeamId);
      childTeamIds.set(feeder.match, set);
    }
  }

  const possibleCache = new Map<number, string[]>();
  const possibleOf = (id: number): string[] => {
    const cached = possibleCache.get(id);
    if (cached) return cached;
    const m = byId.get(id);
    if (!m) return [];
    // Per side: a known team pins the slot to that code alone; only an
    // unfilled slot falls back to everything its feeder could send up.
    const [homeFeeder, awayFeeder] = feedersFor(m);
    const set = new Set<string>();
    for (const [teamId, feeder] of [
      [m.homeTeamId, homeFeeder],
      [m.awayTeamId, awayFeeder],
    ] as const) {
      if (teamId !== null) {
        const code = teams.get(teamId)?.code;
        if (code) set.add(code);
      } else if (feeder !== null) {
        // Winners or losers feed alike: until the tie resolves, either team
        // could arrive in this slot.
        for (const c of possibleOf(feeder.match)) set.add(c);
      }
    }
    const codes = [...set];
    possibleCache.set(id, codes);
    return codes;
  };

  const sideOf = (
    m: BracketMatchRow,
    teamId: number | null,
    placeholder: string | null,
    feeder: FeederSlot | null,
    score: number | null,
    otherScore: number | null,
    pens: number | null,
    otherPens: number | null,
  ): BracketSide => {
    const team = teamId !== null ? (teams.get(teamId) ?? null) : null;
    const possibleCodes =
      team !== null ? [team.code] : feeder !== null ? possibleOf(feeder.match) : [];
    let won = false;
    let lost = false;
    if (m.status === 'finished' && score !== null && otherScore !== null) {
      if (score > otherScore) won = true;
      else if (score < otherScore) lost = true;
      else if (pens !== null && otherPens !== null && pens !== otherPens) {
        // Level after extra time with recorded shootout tallies: the advancer
        // is known the moment the result lands — no waiting on later rounds.
        if (pens > otherPens) won = true;
        else lost = true;
      } else if (teamId !== null) {
        // Tallies unknown (result predates pens support / manual entry
        // without them): fall back to inferring the advancer from the child
        // round; until it fills, neither side is marked.
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
    return { team, placeholder, possibleCodes, score, pens, won, lost };
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
      const live = m.status !== 'finished' && m.liveStatus === 'in';
      // In-play nodes carry the running score in their side slots — final
      // scores only exist at FT, so mid-match the sides would read blank.
      // won/lost stay finished-only inside sideOf, so a live level score
      // never dims anyone.
      const homeScore = live ? m.liveHome : m.homeScore;
      const awayScore = live ? m.liveAway : m.awayScore;
      const homePens = (live ? m.liveHomePens : m.homePens) ?? null;
      const awayPens = (live ? m.liveAwayPens : m.awayPens) ?? null;
      const [homeFeeder, awayFeeder] = feedersFor(m);
      const home = sideOf(m, m.homeTeamId, m.homePlaceholder, homeFeeder, homeScore, awayScore, homePens, awayPens);
      const away = sideOf(m, m.awayTeamId, m.awayPlaceholder, awayFeeder, awayScore, homeScore, awayPens, homePens);
      const feeders = [homeFeeder, awayFeeder]
        .filter((f): f is FeederSlot => f !== null)
        .map((f) => f.match);
      return {
        matchId: m.id,
        stage: m.stage,
        kickoffUtc: m.kickoffUtc,
        matchday: m.matchday,
        venue: m.venue,
        city: m.city,
        status: m.status,
        live,
        liveClock: m.liveClock,
        liveUpdatedAt: m.liveUpdatedAt ?? null,
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
