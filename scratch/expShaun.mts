/**
 * Shaun's question: "the team that scored first shouldn't be the same amount of
 * points as the game winner" — is firstTeam (2 pts) too easy relative to
 * outcome (2 pts)? Measure hit probabilities on the 19 real-odds matches for
 * (a) an optimal picker and (b) a casual favorite-picker, so the answer is
 * numbers rather than vibes. Imports the existing validated sim models
 * (read-only) from the main checkout's scratch directory.
 */
import { MODELS } from '/Users/krisstudio/Developer/Projects/fabiansredcard/scratch/sim/tournament.mts';

let optFT = 0,
  optOC = 0,
  casFT = 0,
  casOC = 0;
console.log(
  'match'.padEnd(26),
  'P(best firstTeam)'.padEnd(19),
  'P(best outcome)'.padEnd(17),
  'P(fav firstTeam)'.padEnd(18),
  'P(fav outcome)',
);
for (const m of MODELS) {
  const bestFT = Math.max(m.pHomeFirst, m.pAwayFirst, m.pNoGoal);
  const bestOC = Math.max(m.pHomeT, m.pDrawT, m.pAwayT);
  const favSide = m.pHomeT >= m.pAwayT ? 'home' : 'away';
  const favFT = favSide === 'home' ? m.pHomeFirst : m.pAwayFirst;
  const favOC = favSide === 'home' ? m.pHomeT : m.pAwayT;
  optFT += bestFT;
  optOC += bestOC;
  casFT += favFT;
  casOC += favOC;
  console.log(
    `${m.home} v ${m.away}`.slice(0, 25).padEnd(26),
    bestFT.toFixed(3).padEnd(19),
    bestOC.toFixed(3).padEnd(17),
    favFT.toFixed(3).padEnd(18),
    favOC.toFixed(3),
  );
}
const n = MODELS.length;
console.log('\n--- means over', n, 'real matches ---');
console.log(`optimal pick:  P(firstTeam hit) = ${(optFT / n).toFixed(3)}  vs  P(outcome hit) = ${(optOC / n).toFixed(3)}`);
console.log(`favorite pick: P(firstTeam hit) = ${(casFT / n).toFixed(3)}  vs  P(outcome hit) = ${(casOC / n).toFixed(3)}`);
console.log(`at 2 pts each: EV(firstTeam) = ${((2 * optFT) / n).toFixed(2)}  vs  EV(outcome line alone) = ${((2 * optOC) / n).toFixed(2)}`);
console.log('\nNote: outcome credit also rides on every exact-score pick (exact implies the');
console.log('outcome was called), so the outcome dimension pays more per match in practice.');
