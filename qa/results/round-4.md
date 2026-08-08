# Round 4 - local fleet vs live prod (post round-3-fix deploy)

**Score: 12** (S1:0 S2:0 S3:3 S4:3) - 6 confirmed of 6 clusters from 7 raw findings. First round with nothing above Minor. All 6 findings were fixed in 1f90991 (merged a0159b4), deployed and byte-verified.

## Confirmed

### [S3] reveal-autonext-cancel-only-on-control-taps
Reveal's 15s auto-advance is only cancelled by taps on [data-action] controls; taps on the card/verdict are ignored, and the one cancelling tap (a vote chip) flips the recorded vote

*Adjudication:* Two independent testers (seeds 44004 and 555/4441, different areas) hit the identical root defect: the cancel logic lives only in the click handler's [data-action] branch, so non-control taps never cancel. The vote-chip flip is a corollary of the same root (the only cancelling non-Next controls are stateful toggles), so it is one cluster, not two. Severity S3, not S2: no control is broken or unreachable - Next player and the chips work, the auto-advance is the fast-flow feature itself, and the f

### [S3] reveal-autonext-no-accessible-indication
Fast-flow auto-advance countdown has no text/ARIA equivalent, disappears entirely under prefers-reduced-motion, and Tab navigation does not cancel it

*Adjudication:* Kept separate from the cancel-scope cluster: although the Tab-does-not-cancel aspect shares that root cause, the core defect here is distinct and needs a different fix - the countdown has no non-visual representation at all, and reduced-motion strips its only indicator. Severity S3 per the rubric's 'minor a11y' line: no focus trap and no unreachable control (a keyboard user activating any control via Enter fires a click and cancels; mouse/touch users are unaffected), and the game continues. Bord

### [S3] reveal-rail-clips-8th-avatar-desktop
Reveal roster rail half-clips the 8th player's avatar at tablet/desktop widths despite large empty margins

*Adjudication:* Single-source layout defect at the max table size. S3 per the rubric's 'overflow that doesn't hide controls': what is clipped is an avatar (information, and scrollable into view), not a control, and it occurs only at the 8-player maximum on tablet/desktop - the game plays on unimpeded. Not S2 because no control is hidden and nothing is broken, but stronger than a nit since it appears on every reveal of a full game and reads as broken layout.

### [S4] challenge-lock-pills-active-player-color
Challenge lock pills render in the active player's seat colour instead of each challenger's own colour

*Adjudication:* Real cosmetic defect contradicting the app's own colour-identity convention, but the pill text ('Ben challenged') carries the correct information, so nothing is actually mislabelled - only the colour cue is inconsistent. That is the rubric's S4 'subtle inconsistency', matching the reporter's own proposal; S3 'misleading' would require the identity information itself to be wrong or absent.

### [S4] duplicate-deck-song-puff-magic-dragon
Deck holds the same song twice: 'Puff, the Magic Dragon' (1963) exists under two ids differing only by '&' vs 'and' in the artist slug

*Adjudication:* Genuine content defect, not by-design, with solid evidence (normalized scan, live-fetched file identical to repo). S4: a single duplicate in 1186 cards is a subtle data inconsistency - both draws produce a legal, correctly-judged turn with the correct year, so no game-rule outcome is wrong; the worst case (same song twice in one night, second naming attempt trivial) is rare polish-level impact.

### [S4] win-screen-orphan-letter-320
Win screen at 320px wraps a 16-char winner name leaving a single orphan letter on its own line

*Adjudication:* Pure typography polish at the smallest supported width with a worst-case-length name: nothing hidden, nothing broken, all controls and information intact. Classic S4 per the rubric ('polish: spacing, wording'), matching the reporter's own proposal.
