// Builds the deterministic e2e database (.data/e2e.db) for the Playwright suite.
//
// 1. Deletes any stale e2e db files.
// 2. Runs the regular seed (scripts/seed.mjs) against DB_PATH=.data/e2e.db.
// 3. Pins the values the e2e journey depends on: a fixed invite token, a fixed
//    admin password, and a removable member ('walter') for the admin flow.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

const root = process.cwd();
const dbPath = '.data/e2e.db';
process.env.DB_PATH = dbPath;

const fixturesPath = path.join(root, 'data', 'fixtures.json');
if (!fs.existsSync(fixturesPath)) {
  console.error(
    `seed-e2e: ${fixturesPath} not found. The core fixtures data has not landed yet; ` +
      'data/fixtures.json (and data/teams.json) must exist before the e2e seed can run.',
  );
  process.exit(1);
}

// --- 1. start from a clean database (including WAL/SHM sidecar files) ------
fs.mkdirSync(path.join(root, '.data'), { recursive: true });
for (const suffix of ['', '-wal', '-shm', '-journal']) {
  fs.rmSync(path.join(root, dbPath + suffix), { force: true });
}

// --- 2. run the regular seed against the e2e database ----------------------
const seed = spawnSync('node', ['scripts/seed.mjs'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    DB_PATH: dbPath,
    SEED_LEAGUE_NAME: process.env.SEED_LEAGUE_NAME ?? "Fabian's Red Card",
  },
});
if (seed.error) {
  console.error(`seed-e2e: failed to spawn scripts/seed.mjs: ${seed.error.message}`);
  process.exit(1);
}
if (seed.status !== 0) {
  console.error(`seed-e2e: scripts/seed.mjs exited with code ${seed.status}`);
  process.exit(1);
}

// --- 3. pin deterministic e2e fixtures -------------------------------------
const sqlite = new Database(path.join(root, dbPath));
sqlite.pragma('foreign_keys = ON');
const nowMs = Date.now();

// (a) fixed invite token so the spec can visit /join/e2e-invite-token-0001
sqlite.prepare("UPDATE leagues SET invite_token = 'e2e-invite-token-0001' WHERE id = 1").run();

// (b) fixed admin password (seed.mjs generates a random one)
sqlite
  .prepare("UPDATE users SET password_hash = ? WHERE username = 'admin'")
  .run(bcrypt.hashSync('e2e-admin-pass', 10));

// (c) member 'walter' with membership + entry in league 1 (remove-member victim)
const { lastInsertRowid: walterId } = sqlite
  .prepare(
    'INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)',
  )
  .run('walter', 'Walter', bcrypt.hashSync('e2e-walter-pass', 10), nowMs);
sqlite
  .prepare(
    "INSERT INTO memberships (league_id, user_id, role, created_at) VALUES (1, ?, 'member', ?)",
  )
  .run(walterId, nowMs);
sqlite
  .prepare("INSERT INTO entries (league_id, user_id, label, created_at) VALUES (1, ?, 'Walter', ?)")
  .run(walterId, nowMs);

const counts = sqlite
  .prepare(
    `SELECT (SELECT COUNT(*) FROM users) AS users,
            (SELECT COUNT(*) FROM memberships) AS memberships,
            (SELECT COUNT(*) FROM matches) AS matches`,
  )
  .get();
console.log(
  `seed-e2e: ready at ${dbPath} — ${counts.users} users, ${counts.memberships} memberships, ${counts.matches} matches.`,
);
sqlite.close();
