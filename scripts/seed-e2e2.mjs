// Builds the deterministic mid-tournament e2e database (.data/e2e2.db) for the
// gameplay Playwright suite (e2e/gameplay.spec.ts). World state at the pinned
// clock FAKE_NOW=2026-06-12T00:00:00Z:
//   - match 1 (MEX v RSA, kicked off 2026-06-11T19:00Z): locked, result NOT yet
//     entered — the spec has the admin enter it in the browser.
//   - match 2 (KOR v CZE, kicks off 2026-06-12T02:00Z): open for picks/booster.
//   - paula and victor are members with pre-kickoff picks on match 1
//     (paula exact 2-1 + scorer + first team = 20 pts once entered; victor 4).
//   - penny has NO membership — she joins via the league password 'lockerroom'.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

const root = process.cwd();
const dbPath = '.data/e2e2.db';
process.env.DB_PATH = dbPath;

const fixturesPath = path.join(root, 'data', 'fixtures.json');
if (!fs.existsSync(fixturesPath)) {
  console.error(`seed-e2e2: ${fixturesPath} not found — run the fixtures pipeline first.`);
  process.exit(1);
}

fs.mkdirSync(path.join(root, '.data'), { recursive: true });
for (const suffix of ['', '-wal', '-shm', '-journal']) {
  fs.rmSync(path.join(root, dbPath + suffix), { force: true });
}

const seed = spawnSync('node', ['scripts/seed.mjs'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, DB_PATH: dbPath, SEED_LEAGUE_NAME: "Fabian's Red Card" },
});
if (seed.error || seed.status !== 0) {
  console.error(`seed-e2e2: scripts/seed.mjs failed (${seed.error?.message ?? seed.status})`);
  process.exit(1);
}

const sqlite = new Database(path.join(root, dbPath));
sqlite.pragma('foreign_keys = ON');
const nowMs = Date.now();

sqlite.prepare("UPDATE leagues SET invite_token = 'e2e2-invite-token-0001' WHERE id = 1").run();
sqlite
  .prepare("UPDATE users SET password_hash = ? WHERE username = 'admin'")
  .run(bcrypt.hashSync('e2e-admin-pass', 10));
// private league with a join password — the password door the spec walks through
sqlite
  .prepare('UPDATE leagues SET join_password_hash = ?, is_private = 1 WHERE id = 1')
  .run(bcrypt.hashSync('lockerroom', 10));

function addUser(username, displayName, password) {
  const { lastInsertRowid } = sqlite
    .prepare('INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(username, displayName, bcrypt.hashSync(password, 10), nowMs);
  return Number(lastInsertRowid);
}
function addMember(userId, label) {
  sqlite
    .prepare("INSERT INTO memberships (league_id, user_id, role, created_at) VALUES (1, ?, 'member', ?)")
    .run(userId, nowMs);
  const { lastInsertRowid } = sqlite
    .prepare('INSERT INTO entries (league_id, user_id, label, created_at) VALUES (1, ?, ?, ?)')
    .run(userId, label, nowMs);
  return Number(lastInsertRowid);
}

const paulaId = addUser('paula', 'Paula', 'e2e-paula-pass');
const paulaEntry = addMember(paulaId, 'Paula');
const victorId = addUser('victor', 'Victor', 'e2e-victor-pass');
const victorEntry = addMember(victorId, 'Victor');
addUser('penny', 'Penny', 'e2e-penny-pass'); // no membership on purpose

// Pre-kickoff picks on match 1 (kickoff 2026-06-11T19:00:00Z). Inserted directly
// with timestamps before kickoff — simulating picks made in time.
const t = (iso) => Date.parse(iso);
const insertPick = sqlite.prepare(`
  INSERT INTO picks (entry_id, match_id, pred_home, pred_away, pred_scorer, pred_first_team, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
insertPick.run(paulaEntry, 1, 2, 1, 'Raul Jimenez', 'home', t('2026-06-11T10:00:00Z'), t('2026-06-11T10:00:00Z'));
insertPick.run(victorEntry, 1, 1, 0, 'Hirving Lozano', 'home', t('2026-06-11T11:00:00Z'), t('2026-06-11T11:00:00Z'));

// Match 1 is mid-game at FAKE_NOW: live feed snapshot for the "if it ended
// now" board. Paula (2-1 RJ home): outcome 2 + scorer 8 + first-team 2 = 12.
// Victor (1-0 HL home): exact 10 + first-team 2 = 12.
sqlite.prepare(`UPDATE matches SET live_home = 1, live_away = 0, live_status = 'in',
  live_updated_at = ?, live_first_scorer = 'Raúl Jiménez', live_first_scoring_team = 'home'
  WHERE id = 1`).run(t('2026-06-11T23:59:00Z'));

const counts = sqlite
  .prepare(`SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM picks) AS picks,
            (SELECT COUNT(*) FROM matches) AS matches`)
  .get();
console.log(`seed-e2e2: ready at ${dbPath} — ${counts.users} users, ${counts.picks} picks, ${counts.matches} matches.`);
sqlite.close();
