// Validates the seeded World Cup schedule against the official tournament
// structure and prints the proof queries (counts + June 11-12 spot check).
// Exits non-zero on any violation.
import Database from 'better-sqlite3';

const dbPath = process.env.DB_PATH ?? '.data/app.db';
const db = new Database(dbPath, { readonly: true });
const problems = [];

const total = db.prepare('SELECT COUNT(*) c FROM matches').get().c;
const group = db.prepare("SELECT COUNT(*) c FROM matches WHERE stage='group'").get().c;
const teams = db.prepare('SELECT COUNT(*) c FROM teams').get().c;
console.log(`matches total: ${total} (expected 104)`);
console.log(`group-stage matches: ${group} (expected 72)`);
console.log(`teams: ${teams} (expected 48)`);
if (total !== 104) problems.push(`total matches ${total} != 104`);
if (group !== 72) problems.push(`group matches ${group} != 72`);
if (teams !== 48) problems.push(`teams ${teams} != 48`);

console.log('\nstage breakdown:');
for (const r of db.prepare('SELECT stage, COUNT(*) c FROM matches GROUP BY stage ORDER BY MIN(id)').all()) {
  console.log(`  ${r.stage}: ${r.c}`);
}
const expectedStages = { group: 72, r32: 16, r16: 8, qf: 4, sf: 2, third: 1, final: 1 };
for (const [stage, want] of Object.entries(expectedStages)) {
  const got = db.prepare('SELECT COUNT(*) c FROM matches WHERE stage=?').get(stage).c;
  if (got !== want) problems.push(`stage ${stage}: ${got} != ${want}`);
}

const badGroups = db
  .prepare(`SELECT group_letter, COUNT(*) c FROM teams GROUP BY group_letter HAVING c != 4`)
  .all();
for (const g of badGroups) problems.push(`group ${g.group_letter} has ${g.c} teams (want 4)`);

const badApps = db
  .prepare(`
    SELECT t.code, COUNT(*) c FROM matches m
    JOIN teams t ON t.id IN (m.home_team_id, m.away_team_id)
    WHERE m.stage = 'group' GROUP BY t.code HAVING c != 3`)
  .all();
for (const a of badApps) problems.push(`team ${a.code} plays ${a.c} group matches (want 3)`);

const groupMatchCounts = db
  .prepare(`SELECT group_letter, COUNT(*) c FROM matches WHERE stage='group' GROUP BY group_letter HAVING c != 6`)
  .all();
for (const g of groupMatchCounts) problems.push(`group ${g.group_letter} has ${g.c} matches (want 6)`);

console.log('\nJune 11-12 fixtures (kickoff_utc):');
const opening = db
  .prepare(`
    SELECT m.id, m.kickoff_utc, h.name home, a.name away, m.venue, m.city, m.group_letter
    FROM matches m
    LEFT JOIN teams h ON h.id = m.home_team_id
    LEFT JOIN teams a ON a.id = m.away_team_id
    WHERE m.matchday IN ('2026-06-11', '2026-06-12')
    ORDER BY m.kickoff_utc`)
  .all();
for (const m of opening) {
  console.log(
    `  match ${String(m.id).padStart(3)} | ${m.kickoff_utc} | Group ${m.group_letter} | ${m.home} v ${m.away} | ${m.venue}, ${m.city}`,
  );
}
if (opening.length === 0) problems.push('no matches found on June 11-12');

if (problems.length) {
  console.error('\nVALIDATION FAILED:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log('\nAll fixture invariants hold.');
