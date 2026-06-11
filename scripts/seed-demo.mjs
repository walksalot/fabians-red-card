// Builds a rich, realistic demo database (.data/demo.db) so every screen looks
// alive: 12 players with varied picks across the opening matchdays, real
// results entered for matches 1–11, boosters, an underdog bonus, and a fully
// populated leaderboard / history / profile.
//
// Reuses the REAL scoring engine (src/lib/scoring.ts is pure TS — Node strips
// the types) so demo points match production exactly; no logic is duplicated.
//
// Pair with FAKE_NOW=2026-06-15T15:00:00Z: matches 1–11 are full-time, June 15
// fixtures are upcoming on the Today board.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import bcrypt from 'bcryptjs';
import { scorePick, DEFAULT_SCORING_RULES } from '../src/lib/scoring.ts';

const root = process.cwd();
const dbPath = process.env.DB_PATH ?? '.data/demo.db';
fs.mkdirSync(path.join(root, '.data'), { recursive: true });
for (const suffix of ['', '-wal', '-shm', '-journal']) {
  fs.rmSync(path.join(root, dbPath + suffix), { force: true });
}

const teamsJson = JSON.parse(fs.readFileSync(path.join(root, 'data/teams.json'), 'utf8'));
const fixturesJson = JSON.parse(fs.readFileSync(path.join(root, 'data/fixtures.json'), 'utf8'));

const sqlite = new Database(path.join(root, dbPath));
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
migrate(drizzle(sqlite), { migrationsFolder: path.join(root, 'drizzle') });

// deterministic PRNG so the demo is identical every rebuild
let s = 1337;
const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const dayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});

// --- teams + matches -------------------------------------------------------
const sortedTeams = [...teamsJson].sort((a, b) => a.code.localeCompare(b.code));
const insTeam = sqlite.prepare('INSERT INTO teams (id, code, name, group_letter) VALUES (?, ?, ?, ?)');
sortedTeams.forEach((t, i) => insTeam.run(i + 1, t.code, t.name, t.group));
const teamIdByCode = new Map(sqlite.prepare('SELECT id, code FROM teams').all().map((r) => [r.code, r.id]));

const insMatch = sqlite.prepare(`INSERT INTO matches
  (id, stage, group_letter, home_team_id, away_team_id, home_placeholder, away_placeholder,
   kickoff_utc, matchday, venue, city, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')`);
for (const m of fixturesJson) {
  const homeId = m.home_code ? teamIdByCode.get(m.home_code) : null;
  const awayId = m.away_code ? teamIdByCode.get(m.away_code) : null;
  insMatch.run(m.n, m.stage, m.group ?? null, homeId, awayId, homeId ? null : m.home,
    awayId ? null : m.away, m.kickoff_utc, dayFmt.format(new Date(m.kickoff_utc)), m.venue, m.city);
}

// --- league + admin --------------------------------------------------------
const now = Date.UTC(2026, 5, 15, 15, 0, 0);
const adminPwHash = bcrypt.hashSync('demo-admin', 10);
const adminId = Number(sqlite.prepare(
  'INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)',
).run('admin', 'Fabian', adminPwHash, now).lastInsertRowid);

const inviteToken = 'demo-invite-2026';
const leagueId = Number(sqlite.prepare(`INSERT INTO leagues
  (name, slug, invite_token, join_password_hash, is_private, buy_in_cents, entries_per_user,
   payout_split, admin_user_id, auto_sync_enabled, created_at)
  VALUES (?, 'fabians-red-card', ?, ?, 1, 2500, 1, '[60,30,10]', ?, 0, ?)`)
  .run("Fabian's Red Card", inviteToken, bcrypt.hashSync('redcard', 10), adminId, now).lastInsertRowid);
sqlite.prepare("INSERT INTO memberships (league_id, user_id, role, created_at) VALUES (?, ?, 'admin', ?)").run(leagueId, adminId, now);

// --- players ---------------------------------------------------------------
const PLAYERS = [
  'Fabian', 'Marcus', 'Devon', 'Priya', 'Liam', 'Noah', 'Sofia',
  'Theo', 'Jonas', 'Amara', 'Ravi', 'Chloe',
];
const entryIds = []; // { entryId, name }
// admin (Fabian) gets entry too
const insUser = sqlite.prepare('INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)');
const insMember = sqlite.prepare("INSERT INTO memberships (league_id, user_id, role, created_at) VALUES (?, ?, 'member', ?)");
const insEntry = sqlite.prepare('INSERT INTO entries (league_id, user_id, label, created_at) VALUES (?, ?, ?, ?)');

for (const name of PLAYERS) {
  let uid;
  if (name === 'Fabian') uid = adminId;
  else {
    uid = Number(insUser.run(name.toLowerCase(), name, bcrypt.hashSync('demo-pass', 10), now).lastInsertRowid);
    insMember.run(leagueId, uid, now);
  }
  const eid = Number(insEntry.run(leagueId, uid, name, now).lastInsertRowid);
  entryIds.push({ entryId: eid, name });
}

// --- realistic results for matches 1..11 -----------------------------------
const SCORERS = {
  MEX: ['Raúl Jiménez', 'Santiago Giménez'], RSA: ['Lyle Foster', 'Percy Tau'],
  KOR: ['Son Heung-min', 'Lee Kang-in'], CZE: ['Patrik Schick'],
  CAN: ['Jonathan David', 'Alphonso Davies'], BIH: ['Edin Džeko'],
  USA: ['Christian Pulisic', 'Folarin Balogun'], PAR: ['Miguel Almirón'],
  BRA: ['Vinícius Júnior', 'Rodrygo'], MAR: ['Achraf Hakimi'],
  QAT: ['Akram Afif'], SUI: ['Breel Embolo'],
  HAI: ['Frantzdy Pierrot'], SCO: ['Scott McTominay'],
  AUS: ['Mitchell Duke'], TUR: ['Arda Güler'],
};
const RESULTS = [
  { n: 1, h: 2, a: 1, fs: 'Raúl Jiménez', ft: 'home' },        // MEX-RSA
  { n: 2, h: 1, a: 1, fs: 'Patrik Schick', ft: 'away' },       // KOR-CZE
  { n: 3, h: 3, a: 0, fs: 'Jonathan David', ft: 'home' },      // CAN-BIH
  { n: 4, h: 2, a: 2, fs: 'Christian Pulisic', ft: 'home' },   // USA-PAR
  { n: 5, h: 1, a: 2, fs: 'Frantzdy Pierrot', ft: 'home', underdog: 'home' }, // HAI-SCO upset-ish
  { n: 6, h: 0, a: 1, fs: 'Arda Güler', ft: 'away' },          // AUS-TUR
  { n: 7, h: 3, a: 1, fs: 'Vinícius Júnior', ft: 'home' },     // BRA-MAR
  { n: 8, h: 0, a: 0, fs: null, ft: 'none' },                  // QAT-SUI
  { n: 9, h: 1, a: 1, fs: 'Achraf Hakimi', ft: 'home' },       // CIV-ECU (names approx)
  { n: 10, h: 2, a: 0, fs: 'Florian Wirtz', ft: 'home' },      // GER-CUW
  { n: 11, h: 2, a: 1, fs: 'Cody Gakpo', ft: 'home' },         // NED-JPN
];
const matchRow = sqlite.prepare('SELECT * FROM matches WHERE id = ?');
const finishMatch = sqlite.prepare(`UPDATE matches
  SET status='finished', home_score=?, away_score=?, first_scorer=?, first_scoring_team=?,
      result_source='manual', underdog_team_id=? WHERE id=?`);
for (const r of RESULTS) {
  const m = matchRow.get(r.n);
  const underdogId = r.underdog === 'home' ? m.home_team_id : r.underdog === 'away' ? m.away_team_id : null;
  finishMatch.run(r.h, r.a, r.fs, r.ft, underdogId, r.n);
}

// --- picks for every entry on matches 1..16 --------------------------------
const insPick = sqlite.prepare(`INSERT INTO picks
  (entry_id, match_id, pred_home, pred_away, pred_scorer, pred_first_team, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
const scoreGuess = () => Math.floor(rand() * 3); // 0..2 mostly
for (const { entryId } of entryIds) {
  for (let n = 1; n <= 16; n++) {
    const m = matchRow.get(n);
    const ph = scoreGuess();
    const pa = scoreGuess();
    const homeCode = [...teamIdByCode.entries()].find(([, id]) => id === m.home_team_id)?.[0];
    const scorerPool = homeCode && SCORERS[homeCode] ? SCORERS[homeCode] : null;
    const predScorer = ph + pa === 0 ? null : scorerPool && rand() > 0.5 ? pick(scorerPool) : null;
    const predFirst = ph + pa === 0 ? 'none' : rand() > 0.5 ? 'home' : 'away';
    const t = m.kickoff_utc ? Date.parse(m.kickoff_utc) - 3_600_000 : now;
    insPick.run(entryId, n, ph, pa, predScorer, predFirst, t, t);
  }
}

// nudge a few entries toward stronger results so the board isn't uniform
function forcePick(entryName, n, ph, pa, scorer, ft) {
  const e = entryIds.find((x) => x.name === entryName);
  const t = now - 7 * 86400_000;
  sqlite.prepare(`UPDATE picks SET pred_home=?, pred_away=?, pred_scorer=?, pred_first_team=?, updated_at=?
                  WHERE entry_id=? AND match_id=?`).run(ph, pa, scorer, ft, t, e.entryId, n);
}
forcePick('Marcus', 1, 2, 1, 'Raúl Jiménez', 'home'); // exact + scorer + first → big
forcePick('Marcus', 3, 3, 0, 'Jonathan David', 'home');
forcePick('Priya', 5, 1, 2, 'Frantzdy Pierrot', 'home'); // underdog hit
forcePick('Devon', 7, 3, 1, 'Vinícius Júnior', 'home');
forcePick('Sofia', 2, 1, 1, 'Patrik Schick', 'away');

// --- boosters: a few players boost a finished match in its matchday --------
const insBooster = sqlite.prepare(`INSERT INTO boosters (entry_id, matchday, match_id, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?)`);
function boost(entryName, matchId) {
  const e = entryIds.find((x) => x.name === entryName);
  const m = matchRow.get(matchId);
  const t = Date.parse(m.kickoff_utc) - 3_600_000;
  insBooster.run(e.entryId, m.matchday, matchId, t, t);
}
boost('Marcus', 1); // doubles Marcus's big match-1 haul
boost('Priya', 5);
boost('Devon', 7);
boost('Sofia', 2);
boost('Liam', 3);

// --- compute matchPoints with the REAL engine -----------------------------
const rules = DEFAULT_SCORING_RULES;
const ROUND_MULT = { group: 1, r32: 1, r16: 1, qf: 1, sf: 1, third: 1, final: 1 };
const BOOSTER_MULT = 2;
const finished = sqlite.prepare("SELECT * FROM matches WHERE status='finished'").all();
const picksForMatch = sqlite.prepare('SELECT * FROM picks WHERE match_id = ?');
const boosterFor = sqlite.prepare('SELECT * FROM boosters WHERE entry_id = ? AND matchday = ?');
const insPoints = sqlite.prepare(`INSERT INTO match_points (entry_id, match_id, breakdown, total)
  VALUES (?, ?, ?, ?)`);
for (const m of finished) {
  const underdogSide = m.underdog_team_id == null ? null
    : m.underdog_team_id === m.home_team_id ? 'home'
    : m.underdog_team_id === m.away_team_id ? 'away' : null;
  const result = {
    homeScore: m.home_score, awayScore: m.away_score, firstScorer: m.first_scorer,
    firstScoringTeam: m.first_scoring_team ?? 'none', underdogSide, stage: m.stage,
  };
  for (const p of picksForMatch.all(m.id)) {
    const b = boosterFor.get(p.entry_id, m.matchday);
    const breakdown = scorePick(
      { predHome: p.pred_home, predAway: p.pred_away, predScorer: p.pred_scorer, predFirstTeam: p.pred_first_team },
      result, rules,
      { roundMultiplier: ROUND_MULT[m.stage] ?? 1, boosted: b?.match_id === m.id, boosterMultiplier: BOOSTER_MULT },
    );
    insPoints.run(p.entry_id, m.id, JSON.stringify(breakdown), breakdown.total);
  }
}

const counts = sqlite.prepare(`SELECT
  (SELECT COUNT(*) FROM users) u, (SELECT COUNT(*) FROM entries) e,
  (SELECT COUNT(*) FROM matches WHERE status='finished') f,
  (SELECT COUNT(*) FROM match_points) mp`).get();
console.log(`seed-demo: ${counts.u} users, ${counts.e} entries, ${counts.f} finished matches, ${counts.mp} point rows.`);
console.log(`  admin: admin / demo-admin   ·   invite: /join/${inviteToken}   ·   join password: redcard`);
sqlite.close();
