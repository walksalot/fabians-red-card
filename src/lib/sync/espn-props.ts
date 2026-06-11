/**
 * First-goalscorer odds fetcher — the cheat sheet's heavyweight companion.
 *
 * Separate from the 60s live loop on purpose: propBets is ~12 pages per match,
 * so this runs on its own gentle cadence (every ~10 min via the scheduler) and
 * only for matches kicking off within the next 36 hours whose scorer odds are
 * missing or older than 30 minutes. Display-only data, graceful absence.
 *
 * ESPN event ids are not stored locally; they're resolved per matchday from
 * the scoreboard (our `matchday` column matches ESPN's date grouping), then
 * propBets pages are walked and athlete $refs resolved through a permanent
 * id→name cache table.
 */
import { and, eq, gt, inArray, lt } from 'drizzle-orm';
import { getDb, schema, type Db } from '@/db';
import { now } from '@/lib/clock';
import {
  athleteIdFromRef,
  parsePropBetsPage,
  type ScorerOddsItem,
} from '@/lib/odds';
import { normalizeKickoff } from './espn-map';

const SCOREBOARD =
  'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';
const CORE =
  'https://sports.core.api.espn.com/v2/sports/soccer/leagues/fifa.world';

const PAGE_LIMIT = 100;
const MAX_PAGES = 20; // hard budget per match (observed ~12)
const REFRESH_MS = 30 * 60_000;
const WINDOW_MS = 36 * 3600_000;

/* eslint-disable @typescript-eslint/no-explicit-any -- untrusted external JSON */
export type JsonFetcher = (url: string) => Promise<any>;

export const fetchJsonFromEspn: JsonFetcher = async (url) => {
  const res = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
};

export interface PropsSyncSummary {
  matchesUpdated: number;
  pricesStored: number;
  athletesResolved: number;
  notes: string[];
}

function propBetsUrl(eventId: string, page: number): string {
  return `${CORE}/events/${eventId}/competitions/${eventId}/odds/100/propBets?lang=en&region=us&limit=${PAGE_LIMIT}&page=${page}`;
}

/** Matches needing a scorer-odds refresh right now. */
function targetMatches(db: Db, nowMs: number) {
  const candidates = db
    .select()
    .from(schema.matches)
    .where(
      and(
        eq(schema.matches.status, 'scheduled'),
        gt(schema.matches.kickoffUtc, new Date(nowMs).toISOString()),
        lt(schema.matches.kickoffUtc, new Date(nowMs + WINDOW_MS).toISOString()),
      ),
    )
    .all()
    .filter((m) => m.homeTeamId !== null && m.awayTeamId !== null);
  if (candidates.length === 0) return [];
  const freshness = db
    .select({
      matchId: schema.scorerOdds.matchId,
      updatedAt: schema.scorerOdds.updatedAt,
    })
    .from(schema.scorerOdds)
    .where(inArray(schema.scorerOdds.matchId, candidates.map((m) => m.id)))
    .all();
  const newest = new Map<number, number>();
  for (const f of freshness) {
    newest.set(f.matchId, Math.max(newest.get(f.matchId) ?? 0, f.updatedAt));
  }
  return candidates.filter((m) => (newest.get(m.id) ?? 0) < nowMs - REFRESH_MS);
}

/** Resolve ESPN event ids for our matches from one scoreboard date payload. */
function eventIdsFor(
  events: any[],
  matches: Array<{ id: number; kickoffUtc: string; homeCode: string | null }>,
): Map<number, string> {
  const out = new Map<number, string>();
  for (const m of matches) {
    const hit = events.find((e) => {
      const when = e?.date ? normalizeKickoff(e.date) : null;
      if (when !== m.kickoffUtc) return false;
      const home = e?.competitions?.[0]?.competitors?.find(
        (c: any) => c?.homeAway === 'home',
      );
      return (
        typeof home?.team?.abbreviation === 'string' &&
        home.team.abbreviation.toUpperCase() === m.homeCode
      );
    });
    if (hit?.id) out.set(m.id, String(hit.id));
  }
  return out;
}

/** Athlete id → name, via the permanent cache; fetches and caches misses. */
async function resolveAthletes(
  db: Db,
  items: ScorerOddsItem[],
  fetchJson: JsonFetcher,
  notes: string[],
): Promise<{ names: Map<string, string>; fetched: number }> {
  const ids = [...new Set(items.map((i) => athleteIdFromRef(i.athleteRef)).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (ids.length === 0) return { names, fetched: 0 };
  const cached = db
    .select()
    .from(schema.espnAthletes)
    .where(inArray(schema.espnAthletes.id, ids))
    .all();
  for (const c of cached) names.set(c.id, c.name);
  let fetched = 0;
  for (const id of ids) {
    if (names.has(id)) continue;
    try {
      const j = await fetchJson(`${CORE}/seasons/2026/athletes/${id}?lang=en&region=us`);
      const name = j?.fullName ?? j?.displayName;
      if (typeof name === 'string' && name.trim() !== '') {
        names.set(id, name.trim());
        db.insert(schema.espnAthletes)
          .values({ id, name: name.trim() })
          .onConflictDoNothing()
          .run();
        fetched++;
      }
      await new Promise((r) => setTimeout(r, 80)); // politeness
    } catch (err) {
      notes.push(`athlete ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { names, fetched };
}

/** One scorer-odds refresh pass. Never throws; notes carry partial failures. */
export async function syncScorerOdds(
  db: Db = getDb(),
  fetchJson: JsonFetcher = fetchJsonFromEspn,
): Promise<PropsSyncSummary> {
  const nowMs = now().getTime();
  const notes: string[] = [];
  const targets = targetMatches(db, nowMs);
  if (targets.length === 0) return { matchesUpdated: 0, pricesStored: 0, athletesResolved: 0, notes };

  // resolve event ids per matchday (one scoreboard fetch per date)
  const teamCodes = new Map(
    db.select({ id: schema.teams.id, code: schema.teams.code }).from(schema.teams).all().map((t) => [t.id, t.code]),
  );
  const withCodes = targets.map((m) => ({
    id: m.id,
    kickoffUtc: m.kickoffUtc,
    homeCode: m.homeTeamId !== null ? (teamCodes.get(m.homeTeamId) ?? null) : null,
  }));
  const eventIds = new Map<number, string>();
  for (const day of [...new Set(targets.map((m) => m.matchday))]) {
    try {
      const sb = await fetchJson(`${SCOREBOARD}?dates=${day.replace(/-/g, '')}`);
      const dayMatches = withCodes.filter(
        (m) => targets.find((t) => t.id === m.id)?.matchday === day,
      );
      for (const [mid, eid] of eventIdsFor(sb?.events ?? [], dayMatches)) eventIds.set(mid, eid);
    } catch (err) {
      notes.push(`scoreboard ${day}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  let matchesUpdated = 0;
  let pricesStored = 0;
  let athletesResolved = 0;

  for (const m of targets) {
    const eventId = eventIds.get(m.id);
    if (!eventId) {
      notes.push(`match ${m.id}: no ESPN event id resolved`);
      continue;
    }
    try {
      const items: ScorerOddsItem[] = [];
      let pageCount = 1;
      for (let page = 1; page <= Math.min(pageCount, MAX_PAGES); page++) {
        const j = await fetchJson(propBetsUrl(eventId, page));
        if (page === 1) pageCount = Number(j?.pageCount ?? 1);
        items.push(...parsePropBetsPage(j));
        await new Promise((r) => setTimeout(r, 80));
      }
      if (items.length === 0) continue; // market not posted yet — try next pass

      const { names, fetched } = await resolveAthletes(db, items, fetchJson, notes);
      athletesResolved += fetched;
      const rows = items
        .map((i) => {
          const id = athleteIdFromRef(i.athleteRef);
          const name = id ? names.get(id) : undefined;
          return name ? { matchId: m.id, playerName: name, american: i.american, updatedAt: nowMs } : null;
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
      if (rows.length === 0) continue;

      db.transaction(() => {
        db.delete(schema.scorerOdds).where(eq(schema.scorerOdds.matchId, m.id)).run();
        for (const r of rows) db.insert(schema.scorerOdds).values(r).run();
      });
      matchesUpdated++;
      pricesStored += rows.length;
    } catch (err) {
      notes.push(`match ${m.id} props: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { matchesUpdated, pricesStored, athletesResolved, notes };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
