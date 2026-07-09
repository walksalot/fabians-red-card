/**
 * Knockout winner propagation: the seeded fixtures wire every "Winners
 * Match N" / "Losers Match N" slot, so the moment a knockout tie is decided
 * (score margin, or shootout tallies on a level final) the advancer can flow
 * into the next round's slot — no waiting for the external feed's windowed
 * team fill, no admin typing. That wait is exactly why the Road to the Final
 * lagged days behind the results.
 *
 * Ownership rules keep this safe to run any number of times:
 *  - only slots that are empty, or that hold one of the feeder's own two
 *    teams, are ever written — a team placed from anywhere else (admin
 *    override) is never touched
 *  - a finished child match is never re-teamed (banked results are facts)
 *  - clearing a feeder's result reverts our fill back to the seeded
 *    placeholder text, so the bracket honestly shows the slot as open again
 *  - a FINISHED tie whose winner is merely unknown (level, tallies not
 *    recorded yet) never un-fills anything — the legacy team-fill path may
 *    already have placed the true advancer
 */
import { and, asc, eq, ne } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import { feederMapFromFixtures } from '@/lib/bracket';
import fixturesJson from '../../../data/fixtures.json';

type MatchRow = typeof schema.matches.$inferSelect;

interface ChildRef {
  childId: number;
  side: 'home' | 'away';
  losers: boolean;
  /** Seeded placeholder text for the slot — restored when a result is cleared. */
  placeholder: string;
}

// fixtures.json is the immutable wiring (DB placeholders are erased as slots
// fill), so the feeder → children map is derived once per process from it.
let childRefsCache: Map<number, ChildRef[]> | null = null;

function childRefsByFeeder(): Map<number, ChildRef[]> {
  if (childRefsCache) return childRefsCache;
  const rows = fixturesJson as Array<{ n: number; home: string; away: string }>;
  const feeders = feederMapFromFixtures(rows);
  const map = new Map<number, ChildRef[]>();
  for (const r of rows) {
    const pair = feeders.get(r.n);
    if (!pair) continue;
    const [home, away] = pair;
    for (const [slot, side, placeholder] of [
      [home, 'home', r.home],
      [away, 'away', r.away],
    ] as const) {
      if (slot === null) continue;
      const list = map.get(slot.match) ?? [];
      list.push({ childId: r.n, side, losers: slot.losers, placeholder });
      map.set(slot.match, list);
    }
  }
  childRefsCache = map;
  return map;
}

/**
 * Who advances (and who drops to the third-place tie) from a finished
 * knockout match: score margin when there is one, shootout margin on a level
 * final. Null while the tie is undecidable — unfinished, teams unknown, or a
 * level score whose shootout tallies aren't recorded (yet).
 */
export function knockoutAdvancers(
  match: MatchRow,
): { winner: number; loser: number } | null {
  if (match.status !== 'finished') return null;
  if (match.homeTeamId === null || match.awayTeamId === null) return null;
  if (match.homeScore === null || match.awayScore === null) return null;
  let homeWon: boolean;
  if (match.homeScore !== match.awayScore) {
    homeWon = match.homeScore > match.awayScore;
  } else if (
    match.homePens !== null &&
    match.awayPens !== null &&
    match.homePens !== match.awayPens
  ) {
    homeWon = match.homePens > match.awayPens;
  } else {
    return null;
  }
  return homeWon
    ? { winner: match.homeTeamId, loser: match.awayTeamId }
    : { winner: match.awayTeamId, loser: match.homeTeamId };
}

function writeSlot(
  db: Db,
  child: MatchRow,
  side: 'home' | 'away',
  teamId: number | null,
  placeholder: string | null,
): void {
  const updates: Partial<typeof schema.matches.$inferInsert> =
    side === 'home'
      ? { homeTeamId: teamId, homePlaceholder: placeholder }
      : { awayTeamId: teamId, awayPlaceholder: placeholder };
  // Underdog hygiene (mirrors setMatchTeams): a flag pointing at a team no
  // longer in the match must not linger and silently mis-score later.
  const newHome = side === 'home' ? teamId : child.homeTeamId;
  const newAway = side === 'away' ? teamId : child.awayTeamId;
  if (
    child.underdogTeamId !== null &&
    child.underdogTeamId !== newHome &&
    child.underdogTeamId !== newAway
  ) {
    updates.underdogTeamId = null;
  }
  db.update(schema.matches).set(updates).where(eq(schema.matches.id, child.id)).run();
}

/**
 * Push one knockout match's outcome into the slots it feeds. Handles both
 * directions: a decided tie fills its children; an undecided one (result
 * cleared, or pens unknown again) reverts fills that came from this tie.
 * Returns the number of slots written.
 */
export function propagateMatch(db: Db, match: MatchRow): number {
  if (match.stage === 'group') return 0; // R32 slots come from group standings
  const refs = childRefsByFeeder().get(match.id);
  if (!refs || refs.length === 0) return 0;
  const advancers = knockoutAdvancers(match);
  let writes = 0;
  for (const ref of refs) {
    const child = db
      .select()
      .from(schema.matches)
      .where(eq(schema.matches.id, ref.childId))
      .get();
    if (!child || child.status === 'finished') continue; // banked results are facts
    const occupant = ref.side === 'home' ? child.homeTeamId : child.awayTeamId;
    const target =
      advancers === null ? null : ref.losers ? advancers.loser : advancers.winner;

    if (target !== null) {
      if (occupant === target) continue;
      // Fill an empty slot, or correct a fill that names one of the feeder's
      // own teams (a re-entered result flipped the tie). A team from anywhere
      // else was placed deliberately — leave it alone.
      const replaceable =
        occupant === null ||
        occupant === match.homeTeamId ||
        occupant === match.awayTeamId;
      if (!replaceable) continue;
      writeSlot(db, child, ref.side, target, null);
      writes++;
    } else if (
      match.status !== 'finished' &&
      occupant !== null &&
      (occupant === match.homeTeamId || occupant === match.awayTeamId)
    ) {
      // The tie's RESULT was cleared: our fill reverts to the seeded
      // placeholder so the slot honestly reads as open again. This branch is
      // strictly for cleared results — a FINISHED tie that is merely
      // undecidable (level, shootout tallies not recorded yet) must never
      // un-fill a slot: the legacy team-fill path (feed/admin) may already
      // hold the true advancer there, and erasing it would break the bracket
      // and pick screens until the tallies backfill.
      writeSlot(db, child, ref.side, null, ref.placeholder);
      writes++;
    }
  }
  return writes;
}

/**
 * Re-derive every knockout slot from the finished ties that feed it — the
 * idempotent self-heal that runs on every sync pass, so brackets recorded
 * before propagation existed (or edited by hand) settle on their own.
 * Ascending id order lets a whole tournament of results cascade in one pass
 * (match numbers are stage-ordered 73…104).
 */
export function propagateAllKnockouts(db: Db): number {
  const finished = db
    .select()
    .from(schema.matches)
    .where(and(ne(schema.matches.stage, 'group'), eq(schema.matches.status, 'finished')))
    .orderBy(asc(schema.matches.id))
    .all();
  let writes = 0;
  for (const m of finished) writes += propagateMatch(db, m);
  return writes;
}
