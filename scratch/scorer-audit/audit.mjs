// Scorer suffix-match exploit quantification — scoring-fairness audit.
// READS ONLY: data/rosters.json, data/teams.json, data/fixtures.json. Writes nothing.
//
// normalizeName + scorerMatches are copied VERBATIM from src/lib/scoring.ts:74-104
// (same algorithm the live scorer awards the 8 points with).

import fs from 'node:fs';
import path from 'node:path';

const root = '/Users/krisstudio/Developer/Projects/fabiansredcard';
const rosters = JSON.parse(fs.readFileSync(path.join(root, 'data/rosters.json'), 'utf8'));
const teams = JSON.parse(fs.readFileSync(path.join(root, 'data/teams.json'), 'utf8'));
const fixtures = JSON.parse(fs.readFileSync(path.join(root, 'data/fixtures.json'), 'utf8'));

// ---- BEGIN verbatim copy from src/lib/scoring.ts ----
/** Case-, whitespace-, diacritic- and period-insensitive name comparison key. */
export function normalizeName(s) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\./g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

export function scorerMatches(pick, actual) {
  const p = normalizeName(pick);
  const a = normalizeName(actual);
  if (p === '' || a === '') return false;
  if (p === a) return true;
  const pT = p.split(' ');
  const aT = a.split(' ');
  if (pT.length >= aT.length) return false;
  return aT.slice(aT.length - pT.length).join(' ') === p;
}
// ---- END verbatim copy ----

const codeToName = Object.fromEntries(teams.map((t) => [t.code, t.name]));

// 1) Per-team last-token (surname) collisions: 2+ squad players sharing the
//    final normalized token — one pick string hits all of them.
const teamCollisions = {};
let totalCollidingGroups = 0;
let totalPlayersInCollidingGroups = 0;
for (const [code, squad] of Object.entries(rosters)) {
  const byLast = new Map();
  for (const p of squad) {
    const toks = normalizeName(p.name).split(' ');
    const last = toks[toks.length - 1];
    if (!byLast.has(last)) byLast.set(last, []);
    byLast.get(last).push(p.name);
  }
  const collisions = [...byLast.entries()]
    .filter(([, names]) => names.length >= 2)
    .map(([token, names]) => ({ token, count: names.length, players: names }))
    .sort((a, b) => b.count - a.count);
  if (collisions.length > 0) {
    teamCollisions[code] = { team: codeToName[code] ?? code, collisions };
    totalCollidingGroups += collisions.length;
    totalPlayersInCollidingGroups += collisions.reduce((s, c) => s + c.count, 0);
  }
}

// Candidate pick strings for a set of players: every whole-token proper suffix
// of every name (what scorerMatches accepts), plus the full normalized name.
function candidatePicks(players) {
  const cands = new Set();
  for (const p of players) {
    const toks = normalizeName(p).split(' ');
    cands.add(toks.join(' '));
    for (let i = 1; i < toks.length; i++) cands.add(toks.slice(i).join(' '));
  }
  return cands;
}

function coverage(pick, players) {
  return players.filter((a) => scorerMatches(pick, a)).length;
}

// 2) Per fixture (both squads combined — first scorer can come from either
//    team): the single pick string matching the most players.
const evaluable = fixtures.filter(
  (f) => f.home_code && f.away_code && rosters[f.home_code] && rosters[f.away_code],
);
const fixtureBest = [];
for (const f of evaluable) {
  const combined = [...rosters[f.home_code], ...rosters[f.away_code]].map((p) => p.name);
  let best = { pick: null, count: 0, players: [] };
  for (const cand of candidatePicks(combined)) {
    const matched = combined.filter((a) => scorerMatches(cand, a));
    if (matched.length > best.count) best = { pick: cand, count: matched.length, players: matched };
  }
  fixtureBest.push({
    n: f.n,
    fixture: `${f.home} v ${f.away}`,
    codes: `${f.home_code}/${f.away_code}`,
    bestPick: best.pick,
    playersCovered: best.count,
    matchedPlayers: best.players,
    crossesTeams:
      best.players.some((m) => rosters[f.home_code].some((p) => p.name === m)) &&
      best.players.some((m) => rosters[f.away_code].some((p) => p.name === m)),
  });
}
fixtureBest.sort((a, b) => b.playersCovered - a.playersCovered || a.n - b.n);

// 3) Generic strings across all evaluable fixtures.
const GENERIC = ['junior','jr','silva','hernandez','lopez','gonzalez','rodriguez','martinez','garcia','fernandez','santos','mohammed','ali','kim','lee','park','son','sane','williams','jones','smith','dia','traore','toure','mendy','ndiaye','sarr'];
const genericStats = {};
for (const g of GENERIC) {
  let max = 0;
  let maxFixture = null;
  let sum = 0;
  let fixturesWithHit = 0;
  for (const f of evaluable) {
    const combined = [...rosters[f.home_code], ...rosters[f.away_code]].map((p) => p.name);
    const c = coverage(g, combined);
    sum += c;
    if (c > 0) fixturesWithHit++;
    if (c > max) { max = c; maxFixture = `${f.home} v ${f.away} (match ${f.n})`; }
  }
  genericStats[g] = {
    maxPlayersInOneFixture: max,
    maxFixture,
    avgPlayersPerFixture: +(sum / evaluable.length).toFixed(3),
    fixturesWithAtLeastOneHit: fixturesWithHit,
  };
}

// 4) Honest vs exploiter: distribution of the BEST single-pick coverage per fixture.
const counts = fixtureBest.map((f) => f.playersCovered).sort((a, b) => a - b);
const median = (arr) =>
  arr.length % 2 ? arr[(arr.length - 1) / 2] : (arr[arr.length / 2 - 1] + arr[arr.length / 2]) / 2;
const bestPerFixture = {
  median: median(counts),
  max: counts[counts.length - 1],
  mean: +(counts.reduce((s, c) => s + c, 0) / counts.length).toFixed(3),
  distribution: counts.reduce((m, c) => ((m[c] = (m[c] ?? 0) + 1), m), {}),
};
// Coverage of every colliding pick (>=2 players) per fixture — the "any
// colliding-surname pick" view, not just each fixture's single best.
const collidingPickCoverages = [];
for (const f of evaluable) {
  const combined = [...rosters[f.home_code], ...rosters[f.away_code]].map((p) => p.name);
  for (const cand of candidatePicks(combined)) {
    const c = coverage(cand, combined);
    if (c >= 2) collidingPickCoverages.push(c);
  }
}
collidingPickCoverages.sort((a, b) => a - b);
const anyCollidingPick = {
  totalCollidingPickFixturePairs: collidingPickCoverages.length,
  median: median(collidingPickCoverages),
  max: collidingPickCoverages[collidingPickCoverages.length - 1],
};

// 5) Reverse check: identical FULL normalized names appearing on 2+ teams
//    (and duplicates within one team).
const fullNames = new Map();
for (const [code, squad] of Object.entries(rosters)) {
  for (const p of squad) {
    const key = normalizeName(p.name);
    if (!fullNames.has(key)) fullNames.set(key, []);
    fullNames.get(key).push({ code, name: p.name });
  }
}
const fullNameCollisions = [...fullNames.entries()]
  .filter(([, occ]) => occ.length >= 2)
  .map(([key, occ]) => ({ normalized: key, occurrences: occ }));
const crossTeamFullCollisions = fullNameCollisions.filter(
  (c) => new Set(c.occurrences.map((o) => o.code)).size >= 2,
);

const result = {
  rosterTeams: Object.keys(rosters).length,
  totalPlayers: Object.values(rosters).reduce((s, sq) => s + sq.length, 0),
  evaluableFixtures: evaluable.length,
  nonEvaluableFixtures: fixtures.length - evaluable.length,
  teamSurnameCollisions: {
    teamsWithCollisions: Object.keys(teamCollisions).length,
    totalCollidingSurnameGroups: totalCollidingGroups,
    totalPlayersInCollidingGroups,
    perTeam: teamCollisions,
  },
  top10ExploitableFixtures: fixtureBest.slice(0, 10),
  genericStrings: genericStats,
  honestVsExploiter: {
    honestPickCoverage: 1,
    bestSinglePickPerFixture: bestPerFixture,
    anyCollidingPick,
  },
  fullNameCollisions: {
    crossTeam: crossTeamFullCollisions,
    sameTeam: fullNameCollisions.filter(
      (c) => new Set(c.occurrences.map((o) => o.code)).size === 1,
    ),
  },
};

console.log(JSON.stringify(result, null, 2));
