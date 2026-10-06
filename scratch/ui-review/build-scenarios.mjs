// Builds per-scenario throwaway SQLite DBs for the UI screenshot library.
// Source of truth: scratch/ui-review/db/base.db (made by scripts/seed-demo.mjs).
// Every mutation here is display fabrication for screenshots only.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const root = process.cwd(); // repo root
const dbDir = path.join(root, 'scratch/ui-review/db');
const basePath = path.join(dbDir, 'base.db');
if (!fs.existsSync(basePath)) {
  console.error('base.db missing — run: DB_PATH=scratch/ui-review/db/base.db node scripts/seed-demo.mjs');
  process.exit(1);
}

const rosters = JSON.parse(fs.readFileSync(path.join(root, 'data/rosters.json'), 'utf8'));
const t = (iso) => Date.parse(iso);

function clone(name) {
  const dest = path.join(dbDir, `${name}.db`);
  for (const suffix of ['', '-wal', '-shm', '-journal']) fs.rmSync(dest + suffix, { force: true });
  fs.copyFileSync(basePath, dest);
  const db = new Database(dest);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

/** Reset a finished match back to scheduled (results never happened yet). */
function unfinish(db, ids) {
  const stmt = db.prepare(`UPDATE matches SET status='scheduled', home_score=NULL, away_score=NULL,
    first_scorer=NULL, first_scoring_team=NULL, result_source=NULL WHERE id=?`);
  for (const id of ids) stmt.run(id);
  db.prepare(
    `DELETE FROM match_points WHERE match_id IN (${ids.join(',')})`,
  ).run();
}

/** Only attach scorer odds to names that really exist in the roster (squad list keys the prices). */
function rosterName(code, fragment) {
  const hit = (rosters[code] ?? []).find((p) => p.name.toLowerCase().includes(fragment.toLowerCase()));
  return hit?.name ?? null;
}

function setOdds(db, matchId, odds, updatedIso, scorerPrices) {
  db.prepare('UPDATE matches SET odds_json=?, odds_updated_at=? WHERE id=?')
    .run(JSON.stringify({ ...odds, updatedAtMs: t(updatedIso) }), t(updatedIso), matchId);
  const ins = db.prepare('INSERT INTO scorer_odds (match_id, player_name, american, updated_at) VALUES (?, ?, ?, ?)');
  for (const [code, fragment, price] of scorerPrices) {
    const name = rosterName(code, fragment);
    if (name) ins.run(matchId, name, price, t(updatedIso));
    else console.warn(`  ! no roster match for ${code} ~ ${fragment}`);
  }
}

// --- A: all upcoming (pre-tournament morning of matchday 1) -----------------
{
  const db = clone('upcoming');
  unfinish(db, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  setOdds(db, 1, {
    provider: 'DraftKings', homeML: '-165', drawML: '+280', awayML: '+475',
    homeProb: 0.58, drawProb: 0.25, awayProb: 0.17,
    overUnder: 2.5, overOdds: '+105', underOdds: '-125',
    openHomeML: '-150', openDrawML: '+270', openAwayML: '+440',
  }, '2026-06-11T15:30:00Z', [
    ['MEX', 'Raúl Jiménez', '+330'], ['MEX', 'Santiago Gimenez', '+360'],
    ['MEX', 'Alexis Vega', '+550'], ['RSA', 'Foster', '+800'], ['RSA', 'Appollis', '+900'],
  ]);
  setOdds(db, 2, {
    provider: 'DraftKings', homeML: '-140', drawML: '+260', awayML: '+400',
    homeProb: 0.55, drawProb: 0.26, awayProb: 0.19,
    overUnder: 2.5, overOdds: '+110', underOdds: '-130',
    openHomeML: '-120', openDrawML: '+260', openAwayML: '+360',
  }, '2026-06-11T15:30:00Z', [
    ['KOR', 'Son', '+450'], ['KOR', 'Kang-in', '+700'], ['CZE', 'Schick', '+500'],
  ]);
  db.close();
  console.log('upcoming.db ready (FAKE_NOW=2026-06-11T16:00:00Z)');
}

// --- B: mixed — CAN-BIH finished w/ points, USA-PAR upcoming (the owner's screenshot scenario)
{
  const db = clone('mixed');
  unfinish(db, [4, 5, 6, 7, 8, 9, 10, 11]);
  setOdds(db, 4, {
    provider: 'DraftKings', homeML: '+115', drawML: '+230', awayML: '+250',
    homeProb: 0.46, drawProb: 0.30, awayProb: 0.24,
    overUnder: 2.5, overOdds: '-105', underOdds: '-115',
    openHomeML: '+120', openDrawML: '+230', openAwayML: '+240',
  }, '2026-06-12T21:30:00Z', [
    ['USA', 'Pulisic', '+450'], ['USA', 'Balogun', '+500'],
    ['USA', 'Weah', '+650'], ['PAR', 'Almirón', '+650'], ['PAR', 'Enciso', '+700'],
  ]);
  db.close();
  console.log('mixed.db ready (FAKE_NOW=2026-06-12T22:00:00Z)');
}

// --- C: all finished — keep only matchday 1, both matches full-time ---------
{
  const db = clone('finished');
  db.prepare('DELETE FROM match_points WHERE match_id > 2').run();
  db.prepare('DELETE FROM picks WHERE match_id > 2').run();
  db.prepare('DELETE FROM boosters WHERE match_id > 2').run();
  db.prepare('DELETE FROM scorer_odds WHERE match_id > 2').run();
  db.prepare('DELETE FROM matches WHERE id > 2').run();
  db.close();
  console.log('finished.db ready (FAKE_NOW=2026-06-12T06:00:00Z) — matches 3+ removed to force the all-finished fallback');
}

// --- D: live — SWE-TUN (match 12) in progress at 71', 1-0 Isak --------------
{
  const db = clone('live');
  const isak = rosterName('SWE', 'Isak') ?? 'Alexander Isak';
  db.prepare(`UPDATE matches SET live_home=1, live_away=0, live_status='in',
    live_updated_at=?, live_first_scorer=?, live_first_scoring_team='home', live_clock=?
    WHERE id=12`).run(t('2026-06-15T03:14:00Z'), isak, "71'");
  db.close();
  console.log('live.db ready (FAKE_NOW=2026-06-15T03:15:00Z)');
}

// --- E: tie — Priya's record cloned from Sofia's so all four tiebreak keys match
{
  const db = clone('tie');
  const sofia = db.prepare("SELECT id FROM entries WHERE label='Sofia'").get().id;
  const priya = db.prepare("SELECT id FROM entries WHERE label='Priya'").get().id;
  db.prepare('DELETE FROM picks WHERE entry_id=?').run(priya);
  db.prepare(`INSERT INTO picks (entry_id, match_id, pred_home, pred_away, pred_scorer, pred_first_team, created_at, updated_at)
    SELECT ?, match_id, pred_home, pred_away, pred_scorer, pred_first_team, created_at, updated_at FROM picks WHERE entry_id=?`)
    .run(priya, sofia);
  db.prepare('DELETE FROM match_points WHERE entry_id=?').run(priya);
  db.prepare(`INSERT INTO match_points (entry_id, match_id, breakdown, total)
    SELECT ?, match_id, breakdown, total FROM match_points WHERE entry_id=?`)
    .run(priya, sofia);
  db.prepare('DELETE FROM boosters WHERE entry_id=?').run(priya);
  db.prepare(`INSERT INTO boosters (entry_id, matchday, match_id, created_at, updated_at)
    SELECT ?, matchday, match_id, created_at, updated_at FROM boosters WHERE entry_id=?`)
    .run(priya, sofia);
  db.close();
  console.log('tie.db ready (FAKE_NOW=2026-06-15T03:15:00Z) — Sofia & Priya fully tied');
}
