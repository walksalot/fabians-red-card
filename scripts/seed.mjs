// Seeds the database with the official 2026 FIFA World Cup schedule
// (data/teams.json + data/fixtures.json) and, on first run, creates the
// default league and admin account.
//
// Idempotent: re-running never overwrites entered results or user data.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import bcrypt from 'bcryptjs';

const root = process.cwd();
const dbPath = process.env.DB_PATH ?? '.data/app.db';
if (dbPath !== ':memory:') {
  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
}

const teamsJson = JSON.parse(fs.readFileSync(path.join(root, 'data/teams.json'), 'utf8'));
const fixturesJson = JSON.parse(fs.readFileSync(path.join(root, 'data/fixtures.json'), 'utf8'));

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
migrate(drizzle(sqlite), { migrationsFolder: path.join(root, 'drizzle') });

// --- teams ---------------------------------------------------------------
const insertTeam = sqlite.prepare(`
  INSERT INTO teams (id, code, name, group_letter) VALUES (?, ?, ?, ?)
  ON CONFLICT(code) DO UPDATE SET name = excluded.name, group_letter = excluded.group_letter
`);
const sortedTeams = [...teamsJson].sort((a, b) => a.code.localeCompare(b.code));
sortedTeams.forEach((t, i) => insertTeam.run(i + 1, t.code, t.name, t.group));
const teamIdByCode = new Map(
  sqlite.prepare('SELECT id, code FROM teams').all().map((r) => [r.code, r.id]),
);

// --- matches -------------------------------------------------------------
// matchday = calendar date of kickoff in America/New_York (tournament reference tz)
const dayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const insertMatch = sqlite.prepare(`
  INSERT INTO matches (id, stage, group_letter, home_team_id, away_team_id,
    home_placeholder, away_placeholder, kickoff_utc, matchday, venue, city, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')
  ON CONFLICT(id) DO NOTHING
`);

let inserted = 0;
for (const m of fixturesJson) {
  const homeId = m.home_code ? (teamIdByCode.get(m.home_code) ?? null) : null;
  const awayId = m.away_code ? (teamIdByCode.get(m.away_code) ?? null) : null;
  if (m.home_code && !homeId) throw new Error(`match ${m.n}: unknown home code ${m.home_code}`);
  if (m.away_code && !awayId) throw new Error(`match ${m.n}: unknown away code ${m.away_code}`);
  const res = insertMatch.run(
    m.n,
    m.stage,
    m.group ?? null,
    homeId,
    awayId,
    homeId ? null : m.home,
    awayId ? null : m.away,
    m.kickoff_utc,
    dayFmt.format(new Date(m.kickoff_utc)),
    m.venue,
    m.city,
  );
  inserted += res.changes;
}

// --- default league + admin (first run only) -----------------------------
const userCount = sqlite.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (userCount === 0) {
  const nowMs = Date.now();
  // Hosted deploys can pin these via env (DEPLOY.md); otherwise generated here.
  const adminPassword = process.env.ADMIN_PASSWORD ?? crypto.randomBytes(8).toString('base64url');
  const passwordHash = bcrypt.hashSync(adminPassword, 10);
  const { lastInsertRowid: adminId } = sqlite
    .prepare('INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('admin', 'Pool Admin', passwordHash, nowMs);

  const inviteToken = process.env.INVITE_TOKEN ?? crypto.randomBytes(12).toString('hex');
  const leagueName = process.env.SEED_LEAGUE_NAME ?? "Fabian's Red Card";
  const { lastInsertRowid: leagueId } = sqlite
    .prepare(`INSERT INTO leagues (name, slug, invite_token, admin_user_id, created_at)
              VALUES (?, ?, ?, ?, ?)`)
    .run(leagueName, 'fabians-red-card', inviteToken, adminId, nowMs);

  sqlite
    .prepare('INSERT INTO memberships (league_id, user_id, role, created_at) VALUES (?, ?, ?, ?)')
    .run(leagueId, adminId, 'admin', nowMs);
  sqlite
    .prepare('INSERT INTO entries (league_id, user_id, label, created_at) VALUES (?, ?, ?, ?)')
    .run(leagueId, adminId, 'Pool Admin', nowMs);

  console.log('--- FIRST RUN: save these somewhere safe! ---');
  console.log(`League:          ${leagueName}`);
  console.log(`Admin username:  admin`);
  console.log(`Admin password:  ${adminPassword}`);
  console.log(`Invite link:     /join/${inviteToken}`);
  console.log('---------------------------------------------');
}

const counts = sqlite
  .prepare(`SELECT (SELECT COUNT(*) FROM teams) AS teams, (SELECT COUNT(*) FROM matches) AS matches,
            (SELECT COUNT(*) FROM matches WHERE stage='group') AS groupMatches`)
  .get();
console.log(
  `Seeded: ${counts.teams} teams, ${counts.matches} matches (${counts.groupMatches} group stage), ${inserted} new this run.`,
);
sqlite.close();
