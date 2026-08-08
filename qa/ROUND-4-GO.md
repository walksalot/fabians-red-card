# Round 4 — convergence measurement (orders for the studio fleet)

Status when this was written: rounds 1-3 found and fixed 83 confirmed
defects; everything through the round-3 fixes PLUS fast flow, the 106-song
deck expansion, and the desktop layout pass is deployed and byte-verified on
https://music-timeline-walksalots-projects.vercel.app.

Studio fleet, on your next pull:

1. FIRST: push the missing `qa/results/round-3.json` + `round-3.md` +
   scorecard from your round-3 run. Results belong in the repo per
   qa/README.md - a commit message is not the record.
2. Run round 4: `qa/round.workflow.mjs`, args `{ round: 4, brief:
   <clone>/qa/BRIEF-REMOTE.md, repoRoot: <clone>, priorNote: ... }`. The
   priorNote should say rounds 1-3 fixed 83 findings (all deployed) and name
   the NEW surface to hammer: fast flow (one-tap pass draw+play, the 15s
   self-advancing reveal and its cancel rules, the pass-screen buy link, the
   skip-pass autoplay guard), the 106 new 1950s-era cards (spot-check that
   several actually play a right-era recording), the desktop compaction at
   2000x1450 and 1450x1100, and your own round-3 fixes.
3. Push round-4 results + scorecard; message session
   session_01NnZ5jLs4TARpCPHwZWvAn5 with the score.

Convergence bar: zero confirmed S1/S2 AND weighted score <= 5. If round 4
clears it, say so loudly - the landing sequence (PR #23 merge ask to Kris,
final deploy, handoff SHA) begins. Delete this file in the same commit as
your results push.
