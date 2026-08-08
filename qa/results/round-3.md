# QA round 3 — results (laptop fleet)

**Score: 37** (S1:0 S2:2 S3:6 S4:3) — 11 confirmed of 13 clusters from 14 raw
findings, adversarially verified. Trajectory: R1 93 → R2 129 (two-fleet merged)
→ **R3 37**.

**Baseline:** measured against the deploy of HEAD `98ba854` — the verifier
hash-checked that the live `ui.js`/`engine.js` matched that commit before
confirming anything. The fixes in `7e27dae`/`5353080` landed MID-ROUND and are
not reflected in these results; round 4 measures the post-fix deploy (which
also carries fast flow, the 106-card 1950s deck expansion, and the desktop
layout pass).

**Coverage:** 10 of 13 testers completed — `qr-listen`, `perf-network`, and
`responsive` died on transient API connection errors, so those areas went
untested this round (round 4 must cover them). One cluster lost its verifier
(NO_VERDICT below), and both S2s lost their second skeptic to the same API
errors — they stand on single-skeptic confirmation with full scripted evidence.

## Confirmed

### [S2] advanced-vote-cannot-record-no
Advanced/expert group vote cannot be completed as instructed: a partial vote
strands the verdict at "Waiting for the group…" (no control records a No);
toggling a chip ON flashes a false green "Correct. The card is yours." with the
win cue and scoreboard bump until the correcting OFF tap; and Next stays live
while the vote is open, silently forfeiting a correctly placed card. 19/19
scripted checks; evidence in `scratch/qa/round-3/verify-advanced-vote-*`.
*Believed addressed by `7e27dae` — round 4 confirms.*

### [S2] play-again-erases-finished-game-record
"Play again" clears the finished game's saved result at tap time, so a reload
during post-game setup loses the winner/recap/pot record that the
finished-game resume feature exists to preserve.

### [S3] vinyl-disc-stale-countdown-label
The resting vinyl shows a stale countdown — "31s" every turn after the first,
"1s" after a Spotify-mode turn — instead of resetting to the ready state.

### [S3] guest-chip-first-tap-swallowed
The first tap on an enabled "Played before" guest chip does nothing when focus
is still in a name field — the keystroke-repaint rebuilds the chip under the
finger and swallows the tap.

### [S3] coop-venmo-hint-false-promise
The setup Venmo hint still promises "The winner screen will pay @handle" while
Co-op is selected, but co-op deliberately never renders a payee.

### [S3] streak-banner-cap-contradiction
The streak banner promises "+1 token" on the reveal even when the token cap
makes the real payout 0 — the engine reports the honest delta; the banner
doesn't read it.

### [S3] stale-overlay-focus-escape
The stale-tab overlay claims `aria-modal="true"` but Tab walks focus out onto
the covered, inert play controls behind it.

### [S3] stepper-disable-drops-focus
A setup stepper's "+" disabling at its bound while focused drops keyboard
focus to `<body>`, stranding keyboard users.

### [S4] expert-year-stepper-no-disable
The expert "Your year call" stepper silently clamps at its bounds instead of
disabling like every other stepper now does.

### [S4] coop-verdict-individual-wording
The co-op reveal verdict says "Correct. The card is yours." though the card
joins the team's shared timeline.

### [S4] setup-draft-debounce-no-flush
Setup-form edits made within ~500 ms of a reload are silently lost — the
debounced draft save never flushes on pagehide.

## Rejected

- NOT_REPRODUCIBLE: menu-home-intercepts-challenge-tap
- NO_VERDICT (verifier lost to API error): deserialize-semantic-validation-gap
