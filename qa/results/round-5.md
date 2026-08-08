# Round 5 - local fleet vs live prod (post round-4-fix deploy)

**Score: 9** (S1:0 S2:0 S3:2 S4:3) - 5 confirmed of 6 clusters from 6 raw; 1 refuted by adversarial verification (pass-screen-doubletap-starts-song). Trajectory: 93 -> 36 -> 37 -> 12 -> 9. Four points from the convergence bar.

## Confirmed

### [S3] roster-chip-first-tap-swallowed-after-edit
First tap on a re-enabled guest chip is silently swallowed when it directly follows editing a player name field

*Adjudication:* Single report (its two variants - rename and clear-name - share the same replaceChildren-on-blur root cause, so one cluster). Not by-design. Rubric fit is S3 'janky-but-recoverable flow': the tap is silently dead but the chip visibly stays enabled and a second tap works, so no feature is outright broken (S2 would require that) and no player is irreversibly lost from the roster. Reporter's S3 stands.

### [S3] streak-banner-plus-one-at-token-cap
Streak reveal banner asserts '+1 token' while the cap-honest ledger on the same screen shows the streak paid 0

*Adjudication:* Single report. The underlying token math is correct (cap honored, ledger honest), so this is not a wrong game-rule outcome (S1) and no feature is broken (S2) - it is exactly the rubric's S3 'misleading copy', aggravated slightly by directly contradicting the ledger on the same reveal. Reporter's S3 stands.

### [S4] listen-disclosure-label-stale-when-open
Listen page streaming-links disclosure keeps 'Show streaming links / this reveals the song title' while open with links visible

*Adjudication:* Distinct from the footnote finding on the same page: this is the disclosure summary not being rewritten on toggle, a different element and code path. Native <details> exposes expanded state to AT and the chevron shows state, so no a11y failure - this is S4 wording/inconsistency polish (inconsistent with the already-fixed host-screen toggle). Reporter's S4 stands.

### [S4] listen-footnote-clip-ends-in-stream-failure
Listen page stream-failure state keeps footnote 'Back to the game when the clip ends' though no clip will play

*Adjudication:* Separate defect from the disclosure-label finding: different element (footnote vs summary), different trigger (stream failure vs toggle), different code path (stumble() vs toggle handler) - so its own cluster. Impact is momentary confusion from a flavor-text footnote; the status line above it is honest. S4 wording polish, not S3 misleading copy, because the authoritative status message in the same view already tells the guest the truth. Reporter'

### [S4] win-name-16char-wraps-320
16-char two-word winner name wraps to an orphan second line at 320px, missing the round-4 one-line claim by 0.5px

*Adjudication:* Single report, reproduced in two independent games. Nothing is hidden or clipped and the wrap is at a word boundary the CSS comment ('balance stays for multi-word names') arguably anticipates - this is cosmetic polish at the smallest supported width, S4, even though it technically regresses the round-4 fix claim. Reporter's S4 stands.
