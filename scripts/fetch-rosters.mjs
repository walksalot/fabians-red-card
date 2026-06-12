// Fetches all 48 World Cup squads from ESPN's free, key-less roster API and
// writes data/rosters.json keyed by FIFA code. ESPN abbreviations were verified
// to match our FIFA codes 1:1, and using ESPN names here means the scorer
// dropdown offers EXACTLY the names the auto-results feed will report — picks
// and results can't drift apart on spelling.
//
// Validation: 48 teams, every squad 18-35 players, every player has a name.
const TEAMS_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/teams';
const ROSTER_URL = (id) => `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/teams/${id}/roster`;

import fs from 'node:fs';

const ours = JSON.parse(fs.readFileSync('data/teams.json', 'utf8'));
const ourCodes = new Set(ours.map((t) => t.code));

const teamsRes = await fetch(TEAMS_URL);
if (!teamsRes.ok) throw new Error(`teams list HTTP ${teamsRes.status}`);
const teamsJson = await teamsRes.json();
const espnTeams = (teamsJson.sports?.[0]?.leagues?.[0]?.teams ?? []).map((t) => t.team);
if (espnTeams.length !== 48) throw new Error(`expected 48 ESPN teams, got ${espnTeams.length}`);

const rosters = {};
const problems = [];
for (const team of espnTeams) {
  const code = team.abbreviation?.toUpperCase();
  if (!ourCodes.has(code)) {
    problems.push(`ESPN team ${team.displayName} (${code}) not in our 48`);
    continue;
  }
  const res = await fetch(ROSTER_URL(team.id));
  if (!res.ok) {
    problems.push(`${code}: roster HTTP ${res.status}`);
    continue;
  }
  const json = await res.json();
  const players = (json.athletes ?? [])
    .map((a) => ({
      // ESPN's fullName for mononym players is "Casemiro null" (lastName is the
      // literal string "null"); strip the artifact or saved picks score zero.
      name: (a.fullName || a.displayName || '').trim().replace(/\s+null$/i, ''),
      position: a.position?.abbreviation ?? null,
    }))
    .filter((p) => p.name.length > 0);
  if (players.length < 18 || players.length > 35) {
    problems.push(`${code}: suspicious squad size ${players.length}`);
  }
  rosters[code] = players;
  await new Promise((r) => setTimeout(r, 120)); // be polite to the free feed
  process.stdout.write(`${code}:${players.length} `);
}
console.log('');

const missing = [...ourCodes].filter((c) => !rosters[c]);
if (missing.length) problems.push(`missing squads: ${missing.join(', ')}`);
if (problems.length) {
  console.error('ROSTER FETCH PROBLEMS:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}

fs.writeFileSync('data/rosters.json', JSON.stringify(rosters, null, 1) + '\n');
const total = Object.values(rosters).reduce((n, r) => n + r.length, 0);
console.log(`data/rosters.json written: ${Object.keys(rosters).length} squads, ${total} players.`);
