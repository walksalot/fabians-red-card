/**
 * Squad-name resolution, shared by the pick validator (picks.ts), the boot
 * scrub (data-fixes.ts) and the UI dropdown (today/page.tsx) — one fallback
 * chain everywhere: players table first, bundled data/rosters.json second.
 */
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import { normalizeName } from '@/lib/scoring';

type RostersFile = Record<string, { name: string }[]>;

/** Bundled squad lists — fallback when the players table has no rows for a team. */
let rostersFile: RostersFile | null = null;

function loadRostersFile(): RostersFile {
  if (rostersFile === null) {
    try {
      rostersFile = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), 'data', 'rosters.json'), 'utf8'),
      ) as RostersFile;
    } catch {
      // Do NOT cache the failure — the file may appear/recover; retry next call.
      return {};
    }
  }
  return rostersFile;
}

function rostersFromFile(code: string): string[] {
  return (loadRostersFile()[code] ?? []).map((p) => p.name);
}

/** Raw display names of a team's squad: players table first, file fallback. */
export function squadDisplayNames(db: Db, teamId: number): string[] {
  const rows = db
    .select({ name: schema.players.name })
    .from(schema.players)
    .where(eq(schema.players.teamId, teamId))
    .all();
  if (rows.length > 0) return rows.map((r) => r.name);
  const team = db
    .select({ code: schema.teams.code })
    .from(schema.teams)
    .where(eq(schema.teams.id, teamId))
    .get();
  return team ? rostersFromFile(team.code) : [];
}

/** Normalized names of a team's squad: players table first, file fallback. */
export function squadNameKeys(db: Db, teamId: number): Set<string> {
  return new Set(squadDisplayNames(db, teamId).map(normalizeName));
}

/**
 * Normalized full names across ALL teams: union of every players-table name
 * and every data/rosters.json name. Used for TBD-team matches (knockout
 * placeholders) where the opponent — and thus the squad pair — is unknown:
 * any real World Cup player's full name is a legal scorer pick there.
 * The table is queried per call (13-player app; ~1k rows — cheap).
 */
export function allSquadNameKeys(db: Db): Set<string> {
  const keys = new Set<string>();
  for (const row of db.select({ name: schema.players.name }).from(schema.players).all()) {
    keys.add(normalizeName(row.name));
  }
  for (const squad of Object.values(loadRostersFile())) {
    for (const p of squad) keys.add(normalizeName(p.name));
  }
  return keys;
}
