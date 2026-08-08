# Adversarial browser QA for the Music Timeline game

A repeatable, multi-phase QA process that tests the LIVE site the way real
players use it: real Chromium/Chrome sessions, clicking through visible UI.
No unit tests here - those live in `tests/`.

## Shape of one round

1. **Test** - 13 QA agents in parallel, each a distinct user mission
   (first-run, roster, setup options, two full classic games, token economy,
   advanced/expert, co-op, persistence + localStorage sabotage, QR + listen
   page, accessibility, responsive sweep, CDP performance audit, chaos user).
2. **Adjudicate** - one judge dedupes all raw findings into clusters, discards
   by-design reports, proposes severity per the rubric.
3. **Adversarial verify** - a skeptic re-reproduces every cluster from scratch,
   stance set to refute; S1/S2 candidates get a second independent skeptic;
   a split decision demotes to S3.

Severity points: S1 Critical=13, S2 Major=8, S3 Minor=3, S4 Nit=1.
Convergence: a round with zero confirmed S1/S2 and weighted score <= 5.

## Running a round

From the repo root (Workflow tool inside a Claude Code session):

```
Workflow({
  scriptPath: '<repoRoot>/qa/round.workflow.mjs',
  args: {
    round: <N>,
    brief: '<repoRoot>/qa/BRIEF-REMOTE.md',
    repoRoot: '<repoRoot>',
  },
})
```

The workflow returns `{ round, raw, clusterCount, confirmed, rejected, score,
bySev, coverage }`. Persist it to `qa/results/round-<N>.json`.

Then ALWAYS regenerate the visual scorecard — Kris reads these, and a stale one
is worse than none (standing instruction, 2026-08-08):

```bash
node qa/make-scorecard.mjs <N>      # writes qa/results/round-<N>-scorecard.html
```

It reads only `qa/results/round-<N>.json` (plus `round-<N>-evidence/` if present),
so it can never drift from the data. Re-run it any time that JSON changes, and
state on the page which fleet(s) the numbers cover and whether the findings are
already fixed — a scorecard that reads as "still broken" after the fixes shipped
is the failure mode to avoid.

`BRIEF-REMOTE.md` is written for a machine with direct internet access.
(Inside the original sandboxed session, a `scratch/qa/BRIEF-LIVE.md` variant
exists with agent-proxy launch flags instead.)

Fixes happen between rounds, get deployed, and the next round tests the live
deployment. Evidence and throwaway drivers land under `scratch/qa/` (gitignored);
only `qa/results/` is committed.
