/**
 * ESPN auto-results orchestrator. Glues the pure planner (espn-map.ts) to the
 * real database and the results service:
 *   1. work out which match dates need checking (scheduled/in-progress only)
 *   2. fetch the free, key-less ESPN soccer scoreboard for those dates
 *   3. plan the safe actions (planSync) and apply them through trusted service
 *      functions (enterResultAuto / setLiveScore / setMatchTeams-equivalent)
 *
 * Everything network-related is injected as `fetchScoreboard`, so the whole
 * thing is unit-testable with a stub and no real HTTP.
 */
import { and, eq, gte, inArray, lte, ne } from 'drizzle-orm';
import { getDb, schema, type Db } from '@/db';
import { now } from '@/lib/clock';
import { enterResultAuto, recomputeMatch, setLiveScore } from '@/lib/services/results';
import { planSync, type EspnEvent, type MatchSnapshot } from './espn-map';

const ESPN_BASE =
  'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';

export interface SyncSummary {
  datesChecked: string[];
  results: number;
  liveUpdates: number;
  teamFills: number;
  notes: string[];
  skipped?: string;
}

export type ScoreboardFetcher = (yyyymmdd: string) => Promise<EspnEvent[]>;

/** Default fetcher: ESPN public scoreboard, one date (yyyymmdd) at a time. */
export const fetchScoreboardFromEspn: ScoreboardFetcher = async (yyyymmdd) => {
  const res = await fetch(`${ESPN_BASE}?dates=${yyyymmdd}`, {
    headers: { accept: 'application/json' },
    // never cache a live feed
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`ESPN ${res.status} for ${yyyymmdd}`);
  const json = (await res.json()) as { events?: EspnEvent[] };
  return json.events ?? [];
};

function yyyymmdd(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

/** UTC dates (yyyymmdd) of every not-yet-final match within a window around now. */
function datesNeedingSync(db: Db): string[] {
  const nowMs = now().getTime();
  // look back 1 day (late finishes / corrections) and forward 2 days (upcoming
  // knockout team fills), but only for matches without a final result yet.
  const fromIso = new Date(nowMs - 24 * 3600_000).toISOString();
  const toIso = new Date(nowMs + 48 * 3600_000).toISOString();
  const rows = db
    .select({ kickoffUtc: schema.matches.kickoffUtc })
    .from(schema.matches)
    .where(
      and(
        ne(schema.matches.status, 'finished'),
        gte(schema.matches.kickoffUtc, fromIso.slice(0, 10) + 'T00:00:00Z'),
        lte(schema.matches.kickoffUtc, toIso),
      ),
    )
    .all();
  const dates = new Set<string>();
  for (const r of rows) {
    // a kickoff and the ~3h after it can straddle a UTC date boundary; cover both
    const k = new Date(r.kickoffUtc);
    dates.add(yyyymmdd(k));
    dates.add(yyyymmdd(new Date(k.getTime() + 4 * 3600_000)));
  }
  return [...dates].sort();
}

function snapshotMatches(db: Db): MatchSnapshot[] {
  const rows = db
    .select({
      id: schema.matches.id,
      kickoffUtc: schema.matches.kickoffUtc,
      status: schema.matches.status,
      resultSource: schema.matches.resultSource,
      homeScore: schema.matches.homeScore,
      awayScore: schema.matches.awayScore,
      homeTeamId: schema.matches.homeTeamId,
      awayTeamId: schema.matches.awayTeamId,
    })
    .from(schema.matches)
    .all();
  const teams = db
    .select({ id: schema.teams.id, code: schema.teams.code, name: schema.teams.name })
    .from(schema.teams)
    .all();
  const byId = new Map(teams.map((t) => [t.id, t]));
  return rows.map((m) => {
    const home = m.homeTeamId != null ? byId.get(m.homeTeamId) : undefined;
    const away = m.awayTeamId != null ? byId.get(m.awayTeamId) : undefined;
    return {
      id: m.id,
      kickoffUtc: m.kickoffUtc,
      homeCode: home?.code ?? null,
      awayCode: away?.code ?? null,
      homeName: home?.name ?? null,
      awayName: away?.name ?? null,
      status: m.status,
      resultSource: m.resultSource,
      homeScore: m.homeScore,
      awayScore: m.awayScore,
    };
  });
}

/** True when auto-sync is switched on for the deployment (primary league flag). */
export function autoSyncEnabled(db: Db): boolean {
  const primary = db
    .select({ enabled: schema.leagues.autoSyncEnabled })
    .from(schema.leagues)
    .orderBy(schema.leagues.id)
    .limit(1)
    .get();
  return primary ? primary.enabled === 1 : false;
}

/**
 * Run one sync pass. Returns a summary; never throws for a single bad date
 * (records it in notes) so one feed hiccup can't stop the rest.
 */
export async function runSync(
  db: Db = getDb(),
  fetchScoreboard: ScoreboardFetcher = fetchScoreboardFromEspn,
): Promise<SyncSummary> {
  if (!autoSyncEnabled(db)) {
    return { datesChecked: [], results: 0, liveUpdates: 0, teamFills: 0, notes: [], skipped: 'auto-sync disabled' };
  }
  const dates = datesNeedingSync(db);
  const events: EspnEvent[] = [];
  const notes: string[] = [];
  for (const d of dates) {
    try {
      events.push(...(await fetchScoreboard(d)));
    } catch (err) {
      notes.push(`fetch failed for ${d}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const plan = planSync(events, snapshotMatches(db));
  notes.push(...plan.notes);
  const nowMs = now().getTime();
  let results = 0;
  let liveUpdates = 0;
  let teamFills = 0;

  const teamIdByCode = new Map(
    db.select({ id: schema.teams.id, code: schema.teams.code }).from(schema.teams).all().map((t) => [t.code, t.id]),
  );

  for (const action of plan.actions) {
    try {
      if (action.kind === 'result') {
        const wrote = enterResultAuto(db, {
          matchId: action.matchId,
          homeScore: action.homeScore,
          awayScore: action.awayScore,
          firstScorer: action.firstScorer,
          firstScoringTeam: action.firstScoringTeam,
        });
        if (wrote) results++;
      } else if (action.kind === 'live') {
        setLiveScore(db, {
          matchId: action.matchId,
          liveHome: action.liveHome,
          liveAway: action.liveAway,
          updatedAtMs: nowMs,
          firstScorer: action.firstScorer,
          firstScoringTeam: action.firstScoringTeam,
        });
        liveUpdates++;
      } else if (action.kind === 'teams') {
        const homeId = teamIdByCode.get(action.homeCode);
        const awayId = teamIdByCode.get(action.awayCode);
        if (homeId && awayId && homeId !== awayId) {
          db.transaction(() => {
            const m = db
              .update(schema.matches)
              .set({ homeTeamId: homeId, awayTeamId: awayId, homePlaceholder: null, awayPlaceholder: null })
              .where(and(eq(schema.matches.id, action.matchId), inArray(schema.matches.status, ['scheduled'])))
              .returning()
              .get();
            if (m && m.status === 'finished') recomputeMatch(db, action.matchId);
          });
          teamFills++;
        }
      }
    } catch (err) {
      notes.push(`apply failed for match ${action.matchId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  setAppState(db, 'lastSyncAt', String(nowMs));
  setAppState(
    db,
    'lastSyncSummary',
    JSON.stringify({ datesChecked: dates, results, liveUpdates, teamFills, noteCount: notes.length }),
  );
  return { datesChecked: dates, results, liveUpdates, teamFills, notes };
}

export function setAppState(db: Db, key: string, value: string): void {
  db.insert(schema.appState)
    .values({ key, value, updatedAt: now().getTime() })
    .onConflictDoUpdate({ target: schema.appState.key, set: { value, updatedAt: now().getTime() } })
    .run();
}

export function getAppState(db: Db, key: string): string | null {
  const row = db.select().from(schema.appState).where(eq(schema.appState.key, key)).get();
  return row ? row.value : null;
}
