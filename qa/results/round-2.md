# Music Timeline — adversarial QA round 2

**Target:** https://music-timeline-walksalots-projects.vercel.app/index.html (live)
**Runner:** studio Mac (32 cores, 13 testers in parallel)
**Browser:** real Google Chrome 151.0.7922.76 via `chromium.launch({ channel: 'chrome' })`
**Audio codec:** `canPlayType('audio/mp4; codecs="mp4a.40.2"')` → `"probably"` — real AAC decoder, so previews were held to the strict "must genuinely play" standard.

## Score

| | S1 Critical | S2 Major | S3 Minor | S4 Nit | Weighted |
|---|---|---|---|---|---|
| Confirmed | 1 | 5 | 20 | 9 | **122** |

- Raw findings from testers: **42**
- Clusters after dedupe/discard: **37**
- Confirmed after adversarial verification: **35**
- Refuted / by-design / not reproducible: **2**

**Convergence gate** (zero S1/S2 and weighted ≤ 5): ❌ not met

### Reading this score honestly

Round 1 scored 93 across 25 defects; this round scores 122 across 35. **The app did not get worse.** Round 1's fixes held — the skeptics re-tested them and none came back. The rise is mostly reach: 29 of the 35 confirmed are S3/S4 polish, and the testers spent this round inside surfaces round 1 never got to (co-op recap wording, offline/storage-full behaviour, landscape, the listen-page QR, screen-reader labels).

One caveat worth stating plainly: 35 of 37 clusters survived verification, which is a high pass rate for an adversarial gate. Two things explain most of it — the adjudicator had already dropped by-design reports before verification, and the missions are largely disjoint so there was little duplicate inflation to strip. It is not proof the gate was soft, but it is the number to watch: if round 3 also refutes ~2 of ~37, the skeptic stance is worth re-tuning.

## Confirmed findings (ranked by severity)

### 1. [S1 Critical · 13 pts] Winner screen's pot is read from the live setup draft, so editing buy-in in a never-started setup rewrites the pot of the game you resume

**id:** `buyin-draft-leaks-into-resumed-game`

**Expected:** A game started with the buy-in switched OFF ends with no pot block at all; a buy-in never started cannot attach itself to an already-running game.

**Actual:** The winner screen shows 'THE POT / $40 / Send it to @kid-who-fiddled' with a live Venmo button and a QR pre-filling a $20 payment, because payoutFor() reads view.setup.buyin instead of a per-game snapshot.

**Repro:**
1. Open /index.html?debug=1&seed=1234 with localStorage cleared
2. New game -> remove 2 rows so 2 players remain -> name them Eve and Fin -> tap each row's 'Skip photo' -> tap the target '-' once (First to 5). Leave the Buy-in switch OFF (default)
3. Shuffle & start. Play 2 turns normally (Play song, tap a gap, Place, Next player)
4. On the play screen tap menu -> Home. Home shows 'Resume game / Turn 3 - Eve, Fin'
5. Tap New game. Flip Buy-in ON, tap '+' 18 times ($20 each), type @kid-who-fiddled in the Venmo field. Setup reads 'Pot: $40 with 2 players'
6. Do NOT start. Tap 'close' (#btn-setup-back) to go home
7. Tap Resume game and play out to the win screen

**Why this severity:** The rubric names 'money math wrong anywhere' as S1 outright, and this is the strongest form of it: the stake the table agreed to is replaced by a number nobody agreed to, in both directions (an abandoned draft can also shrink or erase a real pot), and the screen hands out a scannable payment request for it. Single reporter, but the mechanism named (renderPot/payoutFor reading the live draft) is specific and falsifiable, with script and screenshots. Distinct from the co-op-loss pot cluster: that one is 'never checks the result', this one is 'never snapshots the stake'.

**Verifier:** v1: I tried to refute this on four axes and it survived all of them; it reproduced verbatim on the first attempt in my own fresh Chrome 151 session (canPlayType => "probably"), with zero console/pageerror output.

EXACT REPRO, first try (script /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-buyin-draft-leaks-into-resumed-game-1/v1-repro.mjs, run from the repo root against the live Vercel target): 2-player game (Eve/Fin, First to 5) started with the buy-in switch verifiably OFF ("buyin checkbox checked: false"), 2 turns played, menu -> Home ("Resume game / Turn 3 - Eve, Fin"), then New game -> buy-in ON -> '+' x18 -> "@kid-who-fiddled" (setup read "Pot: $40 with 2 players") -> #btn-setup-back without starting -> Resume -> played out. Win screen rendered exactly the reported text: "The pot $40 Send it to @kid-who-fiddled Open Venmo Other phones can scan this to pay.", #btn-venmo visible, QR frame visible, #win-qr aria-label "Scan to send $20 to @kid-who-fiddled". Screenshot: .../verify-buyin-draft-leaks-into-resumed-game-1/repro-04-pot.png and repro-05-win.png. Nothing in the reported actual is exaggerated - the $40, the handle, the live button and the $20-per-head QR are all there.

CONTROL (same script, `control` arg): identical steps but entering New game and touching nothing -> "win-pot visible: false". So the abandoned draft edit is the sole cause, not stale storage or a seed artifact.

MECHANISM CONFIRMED, NOT INFERRED: the debug seam shows the running game object has no stake field at all ("state.buyin present? false" - keys list contains no buyin), and shipped ui.js payoutFor() (line ~2952) opens with `const buyin = view.setup.buyin;` and computes potFor({ amount: buyin.amount, playerCount: state.players.length }) - the live draft crossed with the live game.

THE "STAKE IS REMEMBERED PER DEVICE, NOT PER GAME" DEFENCE FAILS, and this is the strongest refutation attempt: in the repro run localStorage `music-timeline:v1:buyin` held {"enabled":false,"amount":200,"handle":null} at the very moment the screen displayed $40 to @kid-who-fiddled. The app's own persisted per-device stake said the opposite of what it rendered. saveBuyin() only runs inside startGame(), so an abandoned draft is never the device's remembered stake - it is just unsaved in-memory text that the win screen reads anyway.

REVERSE DIRECTION ALSO CONFIRMED (v2-reverse.mjs, both cases), which is worse than the reported case because a real agreed stake exists: game started with a genuine $2/head to @realaunt (setup: "Pot: $4 with 2 players"); an abandoned draft changed it to $6/head "@some-other-cousin"; the resumed game's win screen paid out "pot: $12 | venmo: @some-other-cousin", QR "Scan to send $6 to @some-other-cousin" - money redirected to a person who was never in this game, at an amount nobody agreed. Second case: the draft merely switched the buy-in OFF -> the winner screen showed NO pot block at all, i.e. the agreed stake vanished from the settle-up screen.

MITIGATION I FOUND AND WEIGHED: reloading the page and re-entering the finished game re-renders the same win screen correctly ($4 / @realaunt, QR $2) - which does not soften the finding, it proves the rendered value was wrong rather than the storage, and no family reloads the phone before the cousin across the table scans the QR that is on screen.

SEVERITY - S1 held, not upgraded or charitably inflated. The rubric names "money math wrong anywhere" as S1 outright and separately names a vanishing stake as S1 data loss; this hits both, and the wrong number is not decorative - it ships as a scannable, pre-filled Venmo pay request for the wrong amount to the wrong handle. The by-design list only exempts "the buy-in never charges money; it builds a Venmo deeplink only", which excuses the absence of a charge, not a deeplink naming a recipient and amount from a game that was never started. I considered S2 (the game itself survives, and the path needs someone to wander into New game and back out) but rejected it: the corruption lands precisely on the one screen the room uses to settle up, and the reverse-direction case needs only an ordinary "let me set up the next round" detour to redirect a real pot.

Evidence dir (all absolute): /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-buyin-draft-leaks-into-resumed-game-1/ - v1-repro.mjs, v2-reverse.mjs, repro-*.png, control-*.png, rev-redirect-*.png, rev-off-*.png. No app file was modified; all interaction was via visible-UI clicks, with the seam read only for assertions. | v2: I set out to refute this and could not. It reproduced verbatim on my first attempt in my own fresh Chrome 151 session (canPlayType => "probably"), with zero console errors and zero pageerrors across all five runs.

EXACT REPRO, first try (my own script, written independently: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-buyin-draft-leaks-into-resumed-game-2/v2-repro.mjs, run from the repo root against the live Vercel target, UI-only clicks). 2-player game (Eve/Fin, First to 5) started with the buy-in verifiably OFF ("PRE-START buyin checked: false", buyin-block not visible), 2 turns played, menu -> Home ("Resume game | Turn 3 - Eve, Fin"), then New game -> buy-in ON -> '+' x18 -> "@kid-who-fiddled" (draft read "Pot: $40 with 2 players") -> #btn-setup-back without starting -> Resume -> played out. Win screen: "The pot $40 Send it to @kid-who-fiddled Open Venmo Other phones can scan this to pay.", #btn-venmo visible, #win-qr aria-label "Scan to send $20 to @kid-who-fiddled". Screenshots repro-04-pot.png / repro-05-win.png. Nothing in the reported actual is exaggerated.

REFUTATION 1 - "it's stale storage or the seed, not the draft". Failed. Control run (same script, `control`): identical steps, entering New game and touching nothing -> "win-pot visible: false". The draft edit is the sole cause.

REFUTATION 2 - "by design: the stake is remembered per device, not per game" (the app's own comment in startGame). Failed, decisively. At the moment the screen displayed $40 to @kid-who-fiddled, localStorage `music-timeline:v1:buyin` held {"enabled":false,"amount":200,"handle":null} - I logged it at start, during the draft, and at the win screen, unchanged throughout. saveBuyin() runs only inside startGame(), so an abandoned draft is never the device's remembered stake; the win screen is reading unsaved in-memory text. The by-design list's only buy-in exemption is "the buy-in never charges money; it builds a Venmo deeplink only", which excuses the absence of a charge, not a deeplink naming a recipient and amount from a game nobody started.

REFUTATION 3 - "the Open Venmo button is decorative / the wrong number never becomes a real money request". Failed. I tapped #btn-venmo on the poisoned win screen with venmo.com blocked at the network layer and captured the outbound URL: https://venmo.com/kid-who-fiddled?txn=pay&amount=20.00&note=Timeline%20-%20Eve%20took%20the%20pot - a live, pre-filled pay request for $20 to a handle from a setup that was never started, in a game whose buy-in was switched off. (v2-deeplink.mjs; deeplink-01-win.png.)

REFUTATION 4 - "the reverse direction is speculative". Failed; I verified it myself rather than taking v1's word. Game started with a genuine agreed stake ($2/head to @realaunt; stored as {"enabled":true,"amount":200,"handle":"realaunt"}), abandoned draft changed it -> win screen paid out "$12 | @some-other-cousin", QR "Scan to send $6 to @some-other-cousin", while storage still held the agreed $2/@realaunt (rev-redirect-03-win.png). Second case: the draft merely toggled the buy-in off -> "win-pot visible: false", the agreed stake gone from the settle-up screen (rev-off-03-win.png). Worth noting the reverse path is cheaper than the reported one: with a saved stake, re-entering New game shows the buy-in block already ON and pre-filled, so tapping '+' a few times - an ordinary "let me set up the next round" detour - is enough, no toggle needed. Tapping New game does not destroy the in-progress game (Resume survived every run), so backing out of it is a normal thing to do.

REFUTATION 5 - "a reload fixes it, so it's transient". Failed as mitigation: after reload the same finished game re-renders correctly ($4 / @realaunt / QR $2), which proves the rendered value was wrong rather than the storage. Nobody reloads the phone before the cousin across the table scans the QR that is on screen.

MECHANISM, verified not inferred: the running game object carries no stake at all (state keys logged; buyin/stake/pot all absent), and shipped public/music/ui.js payoutFor() (line 2952) opens `const buyin = view.setup.buyin;` then `potFor({ amount: buyin.amount, playerCount: state.players.length })` - the live setup draft crossed with the live game.

SEVERITY - S1 held on a cold rubric read, not inflated. The rubric names "money math wrong anywhere" as S1 outright, and separately names a vanishing stake as S1 data loss; this trips both, and the wrong number ships as a scannable, pre-filled payment request for the wrong amount to the wrong person. I seriously weighed S2 ("a feature is broken but the game survives") since the game itself is unharmed and no money moves automatically - and rejected it: the corruption lands on the one screen the room uses to settle up, and the rubric's money line is unconditional.

Evidence dir (mine, all absolute): /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-buyin-draft-leaks-into-resumed-game-2/ - v2-repro.mjs, v2-reverse.mjs, v2-deeplink.mjs, repro-*.png, control-*.png, rev-redirect-*.png, rev-off-*.png, deeplink-01-win.png. No app file was modified; all interaction was visible-UI clicks, with state/localStorage read only to assert.

**Reported by:** setup-options:Buy-in edits made in a setup screen that was never started rewrite the pot of the game you then resume — a game played with no buy-in ends with "The pot $40, send it to @kid-who-fiddled" and a scannable payment QR

**Evidence:** `round-2-evidence/S1-buyin-draft-leaks-into-resumed-game--control-01-setup-no-buyin.png`, `round-2-evidence/S1-buyin-draft-leaks-into-resumed-game--control-02-home-resume.png`, `round-2-evidence/S1-buyin-draft-leaks-into-resumed-game--control-03-draft-untouched.png`, `round-2-evidence/S1-buyin-draft-leaks-into-resumed-game--control-05-win.png`, `round-2-evidence/S1-buyin-draft-leaks-into-resumed-game--repro-01-setup-no-buyin.png`

### 2. [S2 Major · 8 pts] Challenge button disables once every opponent has challenged, so the take-back control inside the sheet is unreachable and the token cannot be refunded

**id:** `challenge-takeback-unreachable`

**Expected:** The sheet reopens showing 'Locked in - tap to take it back'; tapping removes the challenge and refunds the token.

**Actual:** #btn-challenge is disabled with no tooltip, and the take-back control exists only inside that sheet (the lock pills are plain <li>, the badge a <span>, and querySelectorAll('[data-action="open-challenge"]') returns only the disabled button). The gate is anyCanChallenge, which counts 'already challenged' as blocked. Only 'skip this card' recovers the token, and that discards the song for the table.

**Repro:**
1. Open /index.html?debug=1&seed=131 at 393x852
2. New game -> remove rows 3 and 4 so 2 players remain (Ann, Bob) -> 'Skip photo' once per row -> Shuffle & start -> Continue
3. Tap the vinyl to draw the card
4. Tap 'Challenge · 1 token' -> tap Bob -> tap either gap on Bob's timeline -> tap 'Lock in — spend 1 token' (Bob drops 2 -> 1 token, a 'Bob challenged' pill appears)
5. Tap 'Challenge · 1 token' again to take it back

**Why this severity:** The rubric's S2 list names 'challenge flow dead-ends' and 'unreachable control' explicitly. Not S1: the token is spent, not the game broken, and the card still resolves. Notable that this makes the round-1 take-back fix 100% unavailable in every 2-player game, so the impact is structural rather than an edge case.

**Verifier:** v1: Reproduced first try in real Google Chrome (393x852) against the live Vercel site with the filed steps verbatim (?debug=1&seed=131, 2 players Ann/Bob, skip-photo once per row, draw, Challenge -> Bob -> gap -> Lock in). Evidence, scripts and screenshots: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-challenge-takeback-unreachable-1/ (verify.mjs, verify2.mjs, verify3.mjs; 20-2p-dead-button-with-pill.png).

Every claim in the finding checked out, none exaggerated: token went Bob 2 -> 1 through the UI; after lock-in #btn-challenge has disabled=true, title=null, no aria-disabled, so a real tap does nothing (Playwright's actionability click timed out at 4s - not a forced click); the only [data-action="remove-challenge"] node lives inside the closed sheet with a zero-size rect and the "Locked in - tap to take it back" copy is present but invisible; #challenge-locks holds a plain <li> with no data-action; querySelectorAll('[data-action="open-challenge"]') returns only the one disabled button.

I tried to refute it four ways and all failed: (1) tapping the "Bob challenged" pill - sheet stays closed; (2) keyboard - the disabled button cannot even take focus (b.focus() leaves activeElement elsewhere), Enter does nothing; (3) the menu sheet offers only close-menu/show-scoreboard/show-rules/home/end-game - no route; (4) full page reload + Resume game - the challenge persists in saved state and the button is still disabled=true. Not covered by any by-design item.

The mechanism is as reported: ui.js computes anyCanChallenge from challengeBlockedReason(), which returns 'Already challenged this card', so the gate that guards re-entry counts the very players who need the take-back as blocked; confirmChallenge() closes the sheet unconditionally. The app's own source comment on the remove-challenge handler says stranding a player with a spent token is what the round-1 fix existed to prevent, so this is a defect, not intent. Only doSkipCard() refunds challenge tokens, and it discards the card for the table (verified: challenges cleared, card advanced Baby Love -> Rhythm of the Night) - and nothing in the UI tells a player that.

One correction that broadens rather than narrows the report: it is not 2-player-only. In a 3-player game the button stayed live after Bob challenged (take-back reachable) but went dead the moment Cid also challenged - same dead end. 2p is just the case where one challenge guarantees it.

Severity S2 held, not upgraded or downgraded: the rubric names both "challenge flow dead-ends" and "unreachable control" under S2 verbatim. Not S1 - the game is not stuck, the card resolves, no rule outcome is wrong, and the token is technically recoverable. Not S3 - this is not "janky but recoverable"; the control is genuinely unreachable, the app displays copy promising a take-back it cannot deliver, and the only recovery costs the table the song. No console errors or pageerrors during any run; audio played normally (preview counting down on the play screen). | v2: Reproduced first try in real Google Chrome (channel:'chrome', canPlayType AAC = "probably", 393x852) against the live Vercel site with the filed steps verbatim (?debug=1&seed=131, 2 players Ann/Bob, skip-photo once per row, tap vinyl, Challenge -> Bob -> gap -> Lock in). My own scripts and screenshots: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-challenge-takeback-unreachable-2/ (repro.mjs, repro2.mjs, repro3.mjs; 31-2p-locked-in.png shows the greyed "Challenge · 1 token" beside the live "Bob challenged" pill).

Every factual claim held, none exaggerated. Tokens through the UI: Ann:2/Bob:2 before, Ann:2/Bob:1 after lock-in. After lock-in #btn-challenge has disabled=true, title=null, aria-disabled=null — and the app clearly knows how to explain a disabled control, because #btn-place next to it carries title "Tap a gap in your timeline first". The only [data-action="open-challenge"] node on the page is that one disabled button; the only [data-action="remove-challenge"] node is inside the closed sheet with visible=false, and its "Locked in - tap to take it back" copy is present but never rendered visible; #challenge-locks holds a plain <li> with no data-action and no tabindex.

Five refutation attempts, all failed. (1) A genuine finger-level tap — page.mouse.click at the button's centre coordinates, not el.click() and not a forced click — left sheetOpen=false; the Playwright actionable click timed out at 3.5s. (2) Tapping the "Bob challenged" pill: nothing. (3) Keyboard: b.focus() leaves activeElement=BODY (a disabled button cannot take focus), Enter does nothing. (4) The menu sheet offers only close-menu/show-scoreboard/show-rules/home/end-game. (5) Reload + Resume game: the challenge persists in saved state and the button is still disabled=true. I also enumerated every visible [data-action] on the play screen after lock-in — 12 controls, none of them a route back into the sheet. Nothing in the brief's by-design list covers it.

Two checks that strengthen rather than weaken the report. In a 3-player game I drove the take-back through the UI and it works exactly as advertised (Bob's row reads "Locked in - tap to take it back", tapping it clears state.challenges and restores his row to "2 tokens") — so this is a gate bug neutering a working feature, not a missing feature; and the button went dead the moment Cid also challenged, so it is not 2-player-only, 2p is just the case where one challenge guarantees it. And I verified the only recovery: #btn-skip-card does refund (Bob 1 -> 2) but advances the deck (1077 -> 1076), i.e. it costs the whole table that song, and nothing in the UI points a player to it.

Severity S2 held, neither upgraded nor downgraded. I pushed hard for S3 ("janky-but-recoverable") and it does not fit: the control is genuinely unreachable rather than awkward, the app renders copy promising an action that can never be performed in a 2-player game, and the substitute recovery imposes a table-wide cost to undo one player's mis-tap on a small gap target. The rubric names both "challenge flow dead-ends" and "unreachable control" under S2. Not S1 — no crash, nothing stuck, the card still resolves, no wrong rule outcome, no data loss. Zero console errors or pageerrors across all three runs, and audio played normally (paused=false, currentTime 1.51s, readyState 4, real audio-ssl.itunes.apple.com src).

**Reported by:** tokens-bets:Once every opponent has challenged, the Challenge button goes dead — so "Locked in, tap to take it back" is unreachable and the token cannot be refunded (always true in a 2-player game)

**Evidence:** `round-2-evidence/S2-challenge-takeback-unreachable--01-01-play-fresh.png`, `round-2-evidence/S2-challenge-takeback-unreachable--02-02-sheet-open.png`, `round-2-evidence/S2-challenge-takeback-unreachable--03-03-gap-picked.png`

### 3. [S2 Major · 8 pts] Co-op defeat screen still renders the buy-in pot block with a live Venmo link and payment QR, although nobody won

**id:** `coop-loss-shows-pot-payout`

**Expected:** Nobody won, so the pot block is suppressed (or says the stake goes back) — not a payment link.

**Actual:** #win carries data-outcome="loss" and reads 'GAME OVER / So close', yet #win-pot renders directly beneath with '$6', 'Send it to @teamhost', an 'Open Venmo' button, a scannable QR and 'Other phones can scan this to pay.' renderPot()/payoutFor() only check that buy-in is enabled and the pot is non-zero.

**Repro:**
1. Open /index.html?debug=1&seed=77 with localStorage cleared
2. New game -> remove one row so 3 players remain -> 'Skip photo' once per row
3. Select mode Co-op; in 'Mistakes allowed' tap '-' until it reads 1
4. Flip Buy-in ON (leave $2) and type @teamhost in the Venmo field (setup reads 'Pot: $6 with 3 players')
5. Shuffle & start, continue, tap Play song, choose a gap that is wrong for the year shown, Place, Next player

**Why this severity:** Two testers, two areas, one root: the pot renderer never looks at the outcome. S2 rather than S1 because the arithmetic itself is right ($2 x 3) — the defect is that a payout surface appears where no payout exists, i.e. a mode misbehaving on a real-money screen. Distinct from the buy-in-draft cluster, which is a wrong amount from a wrong source; a fix to one does not fix the other.

**Verifier:** v1: Reproduced first try, three times, in my own real-Chrome session (channel: 'chrome', 393x852, fresh localStorage), following the reported steps verbatim: https://music-timeline-walksalots-projects.vercel.app/index.html?debug=1&seed=77 -> New game -> remove one row (3 players) -> Skip photo once per row -> Co-op -> "Mistakes allowed" stepped down to 1 -> Buy-in ON at $2 with @teamhost (setup line read exactly "Pot: $6 with 3 players") -> Shuffle & start -> continue -> Play song -> wrong gap (card 1977 into gap after 2017) -> Place -> Next player.

Result screen: #win carries data-outcome="loss"; window.__timeline.state.result = {reason:"mistake-limit", winnerIds:[], coopWon:false}; eyebrow "GAME OVER", headline "So close". Directly beneath, #win-pot is visible (327x365 px, in-viewport without extra scrolling) and reads "THE POT / $6 / Send it to @teamhost / Open Venmo / Other phones can scan this to pay.", with a rendered 140x140 QR SVG. No console errors. Screenshots: scratch/qa/round-2/verify-coop-loss-shows-pot-payout-1/03-final.png and 10-loss-full.png; structured assertions in result.json.

I pushed on three refutation angles and all failed:
1. "It's inert copy, not a live payment link." Wrong. I tapped #btn-venmo on the loss screen with all venmo.com requests aborted at the route layer: it opened https://venmo.com/teamhost?txn=pay&amount=2.00&note=Timeline%20-%20the%20pot in a new tab, and #win-qr's aria-label is "Scan to send $2 to @teamhost". Every phone in the room is being asked for a real $2 (result3.json).
2. "Maybe the buy-in model is 'everyone pays the host', so a loss screen showing it is fine." The app's own setup copy refutes that: the Buy-in card reads "Everyone chips in the same. Winner takes the pot." (01-setup.png). There is no winner (winnerIds: []).
3. "By design?" The by-design list only exempts "the buy-in never charges money; it builds a Venmo deeplink only" — that covers the absence of a charge, not a payout prompt in a no-winner state. The game-rules paragraph says the payout QR belongs on "the winner screen".

The reported root cause is literally true in shipped source (ui.js): payoutFor() returns non-null on `buyin.enabled` plus `pot.totalCents > 0` and never consults the outcome; renderPot() is called unconditionally from the win-screen renderer, including its "No winner" branch. (Side note, broader not narrower: the same branch fires for a classic game ended early with no winner.)

Severity held at S2, not upgraded and not downgraded. Not S1: the arithmetic is right ($2 x 3 = $6 shown, $2 per-player on the link), so "money math wrong" does not fit. Not S3: this is not wording polish — three functional controls (payment button, scannable QR, "scan this to pay" caption) render in a state where no payout exists, which is the S2 line "a feature is broken but the game survives / a mode misbehaves", on a real-money surface. The reporter's own severity call was correct. | v2: Reproduced 3/3 in my own fresh real-Chrome sessions (channel:'chrome', 393x852, localStorage cleared), following the reported steps verbatim — seeds 77, 5, 77. Scripts and evidence: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-coop-loss-shows-pot-payout-2/ (repro.mjs, repro2.mjs, repro3.mjs, result-a/b/c.json, a-03-final.png, b-03-final.png).

What I saw on the end screen: #win data-outcome="loss"; window.__timeline.state.result = {reason:"mistake-limit", winnerIds:[], shared:false, coopWon:false}; eyebrow "GAME OVER", title "So close". Directly beneath, #win-pot is visible at 327x365 with bounding box top=305.9 / bottom=671.3 in an 852px viewport at scrollY=0 (fullyVisible:true — no scrolling needed), text exactly "THE POT / $6 / Send it to @teamhost / Open Venmo / Other phones can scan this to pay.", plus a rendered 140x140 QR SVG. Zero console errors or pageerrors in all three runs. Every string the reporter quoted matched verbatim.

Refutation attempts, all failed:
1. "Inert copy, not a live payment surface." Wrong. I tapped #btn-venmo as a user would, with venmo.com stub-fulfilled at the route layer so nothing left the machine: it opened https://venmo.com/teamhost?txn=pay&amount=2.00&note=Timeline%20-%20the%20pot (also captured as the only venmo request). #win-qr's aria-label is "Scan to send $2 to @teamhost". Three live controls in a no-payout state.
2. "Maybe the model is 'everyone pays the host regardless of outcome'." The app's own setup copy refutes it, and I captured it in-run: the Buy-in card reads "Everyone chips in the same. Winner takes the pot." and the handle field reads "Venmo handle — optional / The winner screen will pay @teamhost". There is no winner (winnerIds: [], coopWon: false) and this is not the winner screen.
3. "Off-screen / needs hunting." No — in-viewport without scrolling, confirmed geometrically and in a-03-final.png.
4. "By design." The by-design list exempts only "the buy-in never charges money; it builds a Venmo deeplink only" — that covers the absence of a charge, not a payout prompt in a no-winner state. The brief's own description puts the payout QR "on the winner screen".
5. "Root cause claim is invented." It is literally true in shipped source (https://music-timeline-walksalots-projects.vercel.app/ui.js): payoutFor() returns non-null on view.setup.buyin.enabled plus pot.totalCents > 0 and consults winners() only to pick a note string; renderPot() is called unconditionally as the last line of renderWin(), including its coop-loss, "Stopped early" and "No winner" branches. So it is broader than reported, not narrower.
6. "Edge config from stepping mistakes to 1." Losing is a normal co-op outcome at any limit; the stepper only shortens the path, and the source shows every no-winner end hits the same branch.

Severity held at S2 — not upgraded, not downgraded. Not S1: arithmetic is right ($2 x 3 = $6 displayed, $2.00 per person on the link), the game is not stuck or unwinnable, no data loss. Not S3: this is not wording polish — a payment button, a scannable QR and "Other phones can scan this to pay." render live in a state with no payout, which is the S2 line "a feature is broken but the game survives / a mode misbehaves", on a real-money surface where a family that just lost can actually send $6 to one handle. The reporter's severity call was correct.

**Reported by:** setup-options:Co-op loss screen still asks the room to pay the pot — 'Game over / So close' is followed by 'THE POT $6 / Send it to @teamhost / Open Venmo' plus a payment QR, although nobody won, coop:Co-op defeat screen still shows the buy-in pot payout block, telling a team that just lost to send the pot to one handle

**Evidence:** `round-2-evidence/S2-coop-loss-shows-pot-payout--01-setup.png`, `round-2-evidence/S2-coop-loss-shows-pot-payout--02-reveal.png`, `round-2-evidence/S2-coop-loss-shows-pot-payout--03-final.png`

### 4. [S2 Major · 8 pts] 'Place the card' and 'Next player' occupy identical coordinates, so a second tap up to 800ms later skips the whole reveal

**id:** `doubletap-place-skips-reveal`

**Expected:** The reveal (year, title, artist, verdict, token award) stays up until the player deliberately taps 'Next player'.

**Actual:** Both buttons render at x=197,y=807, so the second tap fires next-turn immediately: the app jumps to 'Pass the phone to Player 2', the turn advances and the reveal is never seen. Reproduced at 60/120/200/300/500/800ms gaps, 6/6.

**Repro:**
1. Open /index.html?debug=1&seed=11 in Chrome at 393x852
2. New game -> remove one row so 3 remain -> 'Skip photo' once per row -> Shuffle & start -> Continue
3. Tap the vinyl to draw the card
4. Tap a gap to select a placement (a deliberately wrong gap shows the worst case)
5. Tap 'Place the card' once, then tap the exact same spot 200ms later

**Why this severity:** S2: the reveal is the payoff of every turn and an ordinary impatient double-tap destroys it, but the engine still resolves the placement correctly, so no rule outcome is wrong and nothing is unrecoverable beyond that turn's information. Shares a root class with the play-again mode-flip cluster (no tap guard across a screen transition); kept separate because the surfaces, consequences and likely fix sites differ.

**Verifier:** v1: I tried to refute this and could not. Fresh Chrome 151 sessions at 393x852 against the live Vercel site, ?debug=1&seed=11, 3 players, one skip-photo tap per row, wrong gap chosen deliberately. Scripts: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-doubletap-place-skips-reveal-1/{lib.mjs,01-measure.mjs,02-doubletap.mjs,03-claim.mjs}.

COORDINATE CLAIM (01-measure.mjs, single tap only, then measure): #btn-place box is x=25,y=780,w=343,h=54 -> tap point (197,807). At t=+67ms after that one tap, document.elementFromPoint(197,807) already returns id="btn-next-player", text "Next player", data-action="next-turn". #btn-next-player's own rect is y 768-822 (later 758-812), so the exact point a finger just used for "Place here" sits inside "Next player" from ~60ms onward and stays there indefinitely - the window is if anything larger than the reported 800ms. Reveal was still up and correct on the single-tap control (phase=revealed, flip=true, "1981 / Tainted Love / Soft Cell / Not quite. The card is discarded.").

BEHAVIOUR (02-doubletap.mjs, page.mouse.click at (197,807), wait D, click same point): reproduced 5/5 - D=60, 200, 800 with mouse, and D=200, 300 with a real touch context (hasTouch, isMobile, dSF 3, page.touchscreen.tap). Every run: phase placing -> turn-start, turn 1 -> 2, activeIndex 0 -> 1, visible ["pass"], screen reads "PASS THE PHONE TO Player 2". No console errors, no pageerror. Screenshot 02-200ms.png shows the pass screen; the reveal was never readable (at +60ms it is present but data-flipped="false", i.e. the card has not turned over yet).

Two corrections to the finding, neither material: the button is labelled "Place here", not "Place the card"; and the two button centres are 197,807 vs 197,795 - they are not literally identical, but the Place centre lies inside the Next-player rect, which is what makes the second tap land.

SEVERITY - I looked for a reason to downgrade to S3 "janky-but-recoverable" and found evidence pushing the other way instead. 03-claim.mjs: player presses "I can name it" (+1 token if the group confirms on the reveal screen), then places. Single-tap baseline -> reveal shows the "DID PLAYER 1 NAME IT?" vote panel, group taps Title+Artist, identifyConfirmed/identifyAwarded true, tokens [3,2,2]. Same seed, same claim, double-tap at 200ms -> tokens [2,2,2], placement still correct (timeline 2 cards), vote panel never seen. So one accidental extra tap silently destroys an earned token award with no way back - the identify-confirmation flow dead-ends exactly like the rubric's S2 example, and on a wrong placement the discarded card's year/title/artist exists on no other surface. The engine still judges the placement correctly and nothing is stuck or lost from saved state, so this is not S1. S2 stands as proposed. | v2: I set out to refute this and could not; the exact reported steps worked on the first try, 6/6. Fresh real-Chrome sessions (channel:'chrome') at 393x852 against the live Vercel site, ?debug=1&seed=11, New game -> remove one row so 3 remain -> one skip-photo tap per row -> Shuffle & start -> Continue -> tap vinyl -> tap a wrong gap -> tap Place -> tap the same point again. My own scripts, written from scratch: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-doubletap-place-skips-reveal-2/{lib.mjs,01-geometry.mjs,02-doubletap.mjs,03-claim.mjs}. Zero pageerrors, zero console errors in every run.

GEOMETRY (01-geometry.mjs, ONE tap then measure only): #btn-place rect x=25,y=780,w=343,h=54 -> centre (197,807). Polling document.elementFromPoint(197,807) after that single tap returns id="btn-next-player", data-action="next-turn", disabled=false at t=+55ms and at every sample through +2014ms. #btn-next-player's own rect is x=25,y=768,h=54 during the transition and x=25,y=758,h=54 at rest. So the exact pixel a finger just used for "Place here" is live "Next player" within ~55ms and stays that way forever. The single-tap control was correct: phase=revealed, "1981 / Tainted Love / Soft Cell / Not quite. The card is discarded."

BEHAVIOUR (02-doubletap.mjs): reproduced 6/6 - mouse at D=60, 200, 800 and 1500ms, real touch context (hasTouch, isMobile, dSF 3, page.touchscreen.tap) at D=200ms, and a CORRECT placement at D=250ms. Every single run: phase placing -> turn-start, turn 1 -> 2, activeIndex 0 -> 1, visible ["pass"], screen reads "PASS THE PHONE TO Player 2". The card flip finishes at ~500ms (data-flipped goes false->true), so at 60-300ms the reveal is on screen but literally unreadable.

TWO CORRECTIONS to the finding, neither material. (a) The vulnerable window is NOT "up to 800ms" - it never closes; 1500ms still reproduces and elementFromPoint still resolves to Next player at 2s. The finding understates itself. (b) The wording "identical coordinates" is imprecise: the button is labelled "Place here", not "Place the card", and the two centres are (197,807) vs (197,785). What is true, and is the whole mechanism, is that Place's centre lies inside Next player's rect with 42-54px of 54px vertical overlap - a wide band, not a knife edge.

NOT BY DESIGN. The brief's by-design list does not touch this, and the app's own source argues the other way: ui.js comments a deliberate 650ms cooldown on #btn-skip-card because "a double-tap during the card-swap moment used to burn a second (unheard) song", and asserts "Place and Buy get their guard from engine state". That guard (state.placementCommitted) only stops a second PLACE; it does nothing about the second tap landing on the next screen's button. This is an unclosed gap in a hazard the author already recognised.

SEVERITY - I hunted for the S3 downgrade and the evidence pushed back. 03-claim.mjs, same seed, correct placement, player presses "I can name it" first. Single-tap baseline: #confirm-panel visible on the reveal, group taps Title + Artist, confirmations.identify=true, outcome.identifyAwarded=true, tokens [2,2,2] -> [3,2,2]. Double tap at 200ms: tokens stay [2,2,2], panel never rendered, no error, no route back. Engine side confirms it is silent rather than penalising (identifyAwarded = claimIdentify && confirmations.identify === true; unconfirmed simply pays nothing). So one accidental extra tap dead-ends the identify-confirmation flow and forfeits an earned token - structurally the rubric's own S2 example ("challenge flow dead-ends"). Not S1: placement always resolved correctly (wrong gap -> timelines stayed [1,1,1] discarded; correct gap -> [2,1,1] kept), nothing stuck, nothing lost from saved state, no wrong rule verdict. Not S3: "janky-but-recoverable" does not cover a flow that dead-ends silently with an unrecoverable in-game cost, and on a wrong placement the discarded card's year/title/artist exists on no other surface (the live HTML has no discard/history view; win-recap is the win screen only). S2 stands as proposed.

**Reported by:** chaos:A second tap on "Place the card" lands on "Next player" and skips the whole reveal (year, title, artist, verdict) — reproducible for a full 800ms after the first tap

**Evidence:** `round-2-evidence/S2-doubletap-place-skips-reveal--01-after-single-tap.png`, `round-2-evidence/S2-doubletap-place-skips-reveal--01-before-place.png`, `round-2-evidence/S2-doubletap-place-skips-reveal--02-200ms-touch.png`

### 5. [S2 Major · 8 pts] In phone landscape the vinyl / play control sits underneath the pinned timeline sheet and cannot be tapped

**id:** `landscape-hides-play-control`

**Expected:** The record is visible and tapping it draws the card and starts the preview.

**Actual:** #btn-play-song sits at y230-269 beneath the fixed timeline sheet; elementFromPoint returns #timeline-hint/#play-actions, no <audio> is ever created and the status stays 'Tap play to draw the mystery song.' It is reachable only in one narrow scroll band.

**Repro:**
1. Open /index.html?debug=1&seed=41 at 852x393 (iPhone 14/15 landscape); 568x320, 667x375 and 926x428 behave the same, as does rotating a running game
2. New game -> 'Skip photo' once on each of the 4 rows -> Shuffle & start -> Continue on the pass screen
3. Observe the play screen: only the header strip and the 'YOUR TIMELINE' sheet are visible; the vinyl is nowhere on screen
4. Tap the middle of the band between header and sheet (x=426 y=249 at 852x393)

**Why this severity:** Exactly the rubric's S2 example — 'broken layout that hides controls at a common size'. Not S1 because rotating to portrait recovers the game and one scroll band exposes a sliver of the control, so the game is not permanently stuck. Verified across four landscape sizes and in natively-sized contexts, not just resizes.

**Verifier:** v1: Reproduced first try in my own real-Chrome session (canPlayType => "probably"), exactly as written: fresh page at 852x393 native (not a resize), ?debug=1&seed=41, New game, one 'Skip photo' per row, Shuffle & start, Continue. The play screen at scrollY=0 shows only the header strip and the YOUR TIMELINE sheet — the vinyl is nowhere on screen (screenshot 03-play-screen.png). #btn-play-song measures top=230 bottom=269, and elementFromPoint at its center returns p#timeline-hint inside div.playfoot. My own probe swept EVERY pixel of the button's box and found zero hittable points at scroll 0 (anyHit: null), so the control is fully occluded, not just partly. Tapping the reported point (426,249) with a real mouse click left audioCount=0, card=null, phase='turn-start'. Zero console errors or pageerrors.

Mechanism confirmed from the live CSS: `.playfoot { position: sticky; bottom: 0; z-index: 5; background: var(--paper) }` — an opaque sticky sheet that, on a short viewport, is tall enough to cover the flow content above it. app.css contains no `@media (orientation: ...)` rule at all and there is no rotate-your-phone overlay in ui.js/index.html, so this is not a deliberate landscape posture; ui.js comments elsewhere explicitly plan for "a rotated phone", i.e. landscape is an expected state. Nothing on the brief's by-design list touches layout or orientation.

Refutation attempts that failed:
- "Only reproduces at one contrived size": no. 568x320, 667x375 and 926x428 all show anyHit:null at scroll 0, and rotating a running portrait game (393x852 -> 852x393) flips the control from hittable to occluded. Portrait 393x852 and tablet landscape 1024x768 are fine, so it is specifically phone landscape.
- "One-time setup artifact": no. I played a full turn and turn 2 also lands at scrollY=0 with the control occluded, so a landscape player must hunt for the record on every single turn.
- "Narrow scroll band is exaggerated": if anything it is understated. Measured hittable band = scrollY 125-270 of 392 at 852x393, 95-280 of 366 at 926x428, and only 195-260 of 446 at 568x320 — a 65px window in a 446px scroll range; scroll past it and the record disappears above the header again.

The one place the report overstates is the title's "cannot be tapped": four wheel notches (240px) reveal the vinyl, and a real mouse click on it then works perfectly (audio-ssl.itunes.apple.com src, paused=false, currentTime 2.7s, readyState 4). The finding's own "actual" and rationale already concede this and correctly decline S1. It stays S2 on the rubric's own wording — "broken layout that hides controls at a common size" — not S3, whose layout clause is explicitly "overflow that does NOT hide controls". Aggravating, and independently verified: the landscape player's visible affordances are a gap strip and an enabled "Place here", and taking that obvious path drives phase straight to 'revealed' with a card they never heard, so the failure is not merely cosmetic — it silently converts the game into blind guessing. | v2: Reproduced first try in my own fresh real-Chrome session (canPlayType => "probably"), exactly as written: 852x393 native viewport, /index.html?debug=1&seed=41, New game, one 'Skip photo' per row, Shuffle & start, Continue. Screenshot 852x393-02-play-scroll0.png shows only the header strip and the YOUR TIMELINE sheet — no vinyl anywhere. #btn-play-song measures top=229.7 bottom=268.5 (a 38.8px square, position:absolute); .playfoot measures top=108.5 height=284.5, position:sticky, z-index:5, background rgb(255,248,231) — opaque and 284.5px tall in a 393px viewport, so it swallows everything below the header. I swept all 1521 pixels of the button's box with elementFromPoint: hitCount=0, anyHit=null (returns #timeline-hint 1092x, div.playfoot 273x, #timeline-strip 78x). A real mouse click at the reported (426,249) left audioCount=0, card=null, phase='turn-start'. Zero console errors or pageerrors.

Refutation attempts that all failed:
1) "Contrived viewport." No. anyHit=null at 852x393, 844x390 (iPhone 14), 926x428 (Pro Max), 667x375, 740x360, and — the strongest test — Playwright's real devices['iPhone 13 landscape'] descriptor (750x342, dpr 3, iOS UA, touch): also anyHit=null. Portrait 393x852 (anyHit {187,262}) and tablet landscape 1024x768 (anyHit {503,260}) are fine, so it is specifically the short viewport. Rotating a running portrait game 393x852 -> 852x393 flips the control from reachable:true to anyHit:null with no scroll change. It is not even orientation-bound: portrait 393x500 also gives anyHit=null, i.e. any viewport under ~570px tall.
2) "Deliberate landscape posture / rotate-your-phone gate." No. I fetched the live app.css (68,137 bytes): zero @media (orientation: ...) and zero max-height media queries in the whole stylesheet, and .playfoot is an uncapped `position: sticky; bottom: 0; z-index: 5; background: var(--paper)`. No overlay, and the rest of the game is fully interactive in landscape. Nothing on the brief's by-design list touches layout or orientation.
3) "Some other control still draws the card." No. Dumping every button reachable at scroll 0 gives menu, the two gap buttons, 'I can name it', 'Challenge' and a disabled 'Place here'; #btn-replay, #btn-skip-card and #btn-buy-card are also unreachable. There is no alternative path to start the song.

Where the report overstates, and why it does not change the verdict: the title's "cannot be tapped" is imprecise — wheel-scrolling to scrollY 180-240 exposes 82-87% of the button and a real locator click then works perfectly (src audio-ssl.itunes.apple.com/.../mzaf_9643900716597219222.plus.aac.p.m4a, paused=false, currentTime 5.63, readyState 4, phase 'listening'). But the finding's own `actual` and `rationale` already state exactly that and correctly decline S1. My finer sweep matches the reported band: hittable only for scrollY 125-265 of a 392 range; 0% hittable at scroll 0/60/120 and scrolled off the top by 300. The required gesture is also backwards — you must scroll DOWN to pull content UP from behind a sheet pinned to the BOTTOM, on a screen that looks complete at rest.

Severity S2 confirmed, no downgrade. The rubric's S2 example is "broken layout that hides controls at a common size" and this is that verbatim: the game's single primary control is 100% occluded at the default scroll position on every phone-landscape size, on the main screen, on every turn (I played a full turn; turn 2 also lands at scrollY=0 occluded). S3 does not apply — its layout clause is explicitly "overflow that does NOT hide controls." Not S1: portrait recovers it, scrolling recovers it, and the game is neither stuck nor unwinnable. Aggravating and independently verified: at scroll 0 the landscape player's only reachable affordances are the gaps and 'Place here', and taking that obvious path drove phase straight to 'revealed' ("1966 / The Good, the Bad and the Ugly", "Not quite. The card is discarded.") with audioCount=0 — the game silently degrades to blind guessing.

Evidence: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-landscape-hides-play-control-2/ (r1.mjs, r2.mjs, r3.mjs, r1-852x393.log, r2.log, r3.log, 852x393-02-play-scroll0.png, r3-A-after-4-notches.png, r3-A-after-click.png, r3-B-rotated.png, r3-C-after-place.png, plus r2-*.png per size).

**Reported by:** responsive:In landscape on a phone, the record / "tap play" control is completely hidden behind the pinned timeline sheet and tapping where it sits does nothing

**Evidence:** `round-2-evidence/S2-landscape-hides-play-control--01-setup.png`, `round-2-evidence/S2-landscape-hides-play-control--02-after-start.png`, `round-2-evidence/S2-landscape-hides-play-control--03-play-screen.png`

### 6. [S2 Major · 8 pts] A stale second tab writes over newer progress — the 'changed in another tab' toast warns but does not stop the write

**id:** `second-tab-clobbers-progress`

**Expected:** A tab that has been told its snapshot is stale refuses to write over newer progress (forces the reload it just recommended).

**Actual:** Tab B writes turn 4 from its stale turn-3 snapshot; storage becomes turn 4 / Ann 3 cards / Bob 2 cards, tab A resumes at turn 4, Bob's turn-4 card is gone, and neither tab reports the loss.

**Repro:**
1. Tab A: start a 2-player game (Ann, Bob), play 2 turns so it reads 'turn 3'
2. Open the same URL in tab B; tap 'Resume game' (B mirrors turn 3)
3. Back in tab A, play 2 more turns (A reaches turn 5; Ann 3 cards, Bob 3 cards)
4. Switch to tab B — still turn 3, with the toast 'This game changed in another tab — reload to catch up'
5. Ignore the toast and take B's turn normally (Start the turn -> Play song -> tap a gap -> Place -> Next player)
6. Reload tab A and tap 'Resume game'

**Why this severity:** S2 rather than S1: real, unrecoverable loss of a round of play, but the saved game itself does not vanish, the app does detect and warn about the condition, and it takes a second tab to trigger. If verification shows the clobber can wipe an entire game (not just a turn) with no warning path, S1 becomes arguable.

**Verifier:** v1: Reproduced first try, UI-only, real Chrome 151, exact steps as written — no variation needed. Script: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-second-tab-clobbers-progress-1/repro.mjs (seed=11, 2 players Ann/Bob).

Run 1 matched the reported numbers verbatim. A after 2 turns = turn 3 (Ann 2c, Bob 2c). B opened the same URL, tapped "Resume game", mirrored turn 3. A played 2 more turns = turn 5, Ann 3c ["1956 In the Still of the Night","1967 Purple Haze","1994 Love Is All Around"], Bob 3c ["1978 Boogie Oogie Oogie","1981 Tainted Love","1998 Rosa Parks"]; localStorage music-timeline:v1:game agreed (turn 5, deck 1074). Switching to B: still turn 3, toast "This game changed in another tab — reload to catch up." rendered twice (screenshot 05-B-stale-toast.png). The toast blocks nothing — "Start the turn" is fully tappable. B played one normal turn (#btn-pass-continue -> #btn-play-song -> gap -> #btn-place -> next player) and storage became turn 4 / Ann 3c / Bob 2c / deck 1075. Bob's turn-4 card (1998 Rosa Parks) is gone from storage. A reloaded, tapped "Resume game", and landed on turn 4 with Bob at 2 cards. Zero pageerrors, zero console errors.

Adversarial checks that failed to break it: (a) not covered by the brief's by-design list — that list covers autoplay, offline, module warnings, photos, QR/LAN, and the Venmo deeplink, nothing about multi-tab or storage arbitration; (b) not a hidden/bypassed control — every click was a visible locator click, no page.evaluate clicking; (c) not step-drift — the reported steps are the steps that work.

I then tested the finding's own severity escape hatch ("if the clobber can wipe an entire game, S1 becomes arguable") with variant-bigger-gap.mjs: B resumed at turn 1, A played 8 turns to turn 9 (Ann 5c, Bob 5c, deck 1070), then B took ONE turn. Storage collapsed to turn 2 / Ann 2c / Bob 1c / deck 1077 — seven turns of play destroyed by a single stale write. So the loss is not bounded to one round; it scales with how stale the second tab is. Two aggravating details: after B's write B shows no warning at all (its text is a clean "Ann's turn. Turn 1."), and A's home screen after reload cheerfully offers "Resume game — Turn 2 — Ann, Bob" with no loss notice. The finding's "neither tab reports the loss" is accurate.

Holding S2 rather than upgrading, applying the rubric coldly. S1's data-loss clause is "saved game/roster/stake vanishes" — here the saved game does not vanish, it regresses to a valid earlier state and remains fully playable, which is squarely S2's "a feature is broken but the game survives". Two real mitigations keep it off S1: both tabs do detect the divergence and warn before the write, and it takes a second tab plus ignoring an explicit on-screen instruction to reload. It is clearly above S3 because the loss is unrecoverable, not "janky-but-recoverable" — once B writes, A's newer state is gone from localStorage entirely, as A's reload confirms.

Evidence dir: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-second-tab-clobbers-progress-1/ (01-08 = exact repro, v2-01..v2-05 = magnitude variant). | v2: I tried hard to break this one and could not. Reproduced first try, exact steps as written, no variation, real Google Chrome 151, UI-only clicks (page.evaluate used only to read `window.__timeline.state` / localStorage). My script: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-second-tab-clobbers-progress-2/repro.mjs (seed=11, Ann/Bob).

Numbers matched the report verbatim, independently of round 1. A after 2 turns = turn 3 (Ann 2c, Bob 2c). B opened the same URL, tapped "Resume game", mirrored turn 3. A played 2 more turns = turn 5, Bob 3c incl. "1998 Rosa Parks"; localStorage `music-timeline:v1:game` agreed (turn 5, deck 1074). B, still on turn 3, played one ordinary turn (#btn-pass-continue -> #btn-play-song -> gap -> #btn-place -> #btn-next-player) and storage regressed to turn 4 / Ann 3c / Bob 2c / deck 1075. Bob's turn-4 card is gone. A reloaded, its home card read "Resume game — Turn 4 — Ann, Bob", and it resumed at turn 4. Zero pageerrors, zero console errors in both runs.

Attempts to refute, and what they actually showed:

1. BY_DESIGN? ui.js:3529 does carry the comment "Two tabs on one game is last-writer-wins by design (one phone is the whole premise)". I decided that is not enough. The brief's by-design list covers autoplay, offline, module warnings, photos, QR/LAN and the Venmo deeplink — nothing about multi-tab or storage arbitration — and the app itself contemplates the second tab (it renders a working Resume card there and ships a `storage`-event staleness detector). A source comment is developer intent, not a brief exemption; the same comment concedes "a stale tab should not be a silent time machine", which is precisely what it is.

2. Is the warning a real mitigation? No — this is worse than reported. `alertUser()` (ui.js:329-347) self-dismisses the toast after 4500 ms. Round 1 saw the toast only because it switched tabs ~2 s after A's write. In variant-recovery.mjs I waited 15 s before touching B, a human tab-switch pace, and the toast was gone: `{"visible":false}`, screenshot v2-01-B-no-warning-at-human-pace.png shows a clean, confident "turn 3 / 2 of 10 cards" pass screen with no warning at all. So in the realistic case the stale write happens with nothing on screen. This kills one of the two mitigations round 1 used to hold S2 — it argues up, not down.

3. Is the loss really unrecoverable? Here I did find the report overstated. Tab A, left open and unreloaded, still holds turn 5 in memory; when it simply plays its next turn, its save restores everything — storage went to turn 6 with "1998 Rosa Parks" back and Ann's new card added, and a fresh third tab confirmed "Resume game — Turn 6" (v2-04, v2-05). So the loss becomes permanent only when the newer tab is reloaded — which is exactly what that tab's own toast instructs ("reload to catch up"). Also, "neither tab reports the loss" is imprecise: the still-open tab A does get a toast at B's write (R3 `{"visible":true}`), though it says "changed in another tab", never that progress was lost. These correct the record but do not overturn the defect.

Severity, applied coldly: not S1 — the saved game does not vanish, nothing is stuck or unwinnable, no money math or rule outcome is wrong; it regresses to a valid, fully playable earlier state. Above S3 — this is not visual, not copy, and not merely "janky-but-recoverable": persisted progress silently rolls back, resume then reports a turn number that never was, and the only recovery path is undiscoverable and is destroyed by following the app's own advice. That lands on S2's definition almost verbatim, "a feature is broken but the game survives... resume misses". Holding S2; I have no hard evidence for an upgrade and no honest basis for a downgrade.

Evidence: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-second-tab-clobbers-progress-2/ (01-09 = exact repro; v2-01..v2-05 = human-pace-warning and recovery variant; repro.mjs, variant-recovery.mjs).

**Reported by:** persistence:A second tab silently overwrites the first tab's progress — the 'changed in another tab' toast warns but does not stop the stale tab from writing

**Evidence:** `round-2-evidence/S2-second-tab-clobbers-progress--01-A-after-2-turns.png`, `round-2-evidence/S2-second-tab-clobbers-progress--02-B-home.png`, `round-2-evidence/S2-second-tab-clobbers-progress--03-B-resumed.png`

### 7. [S3 Minor · 3 pts] Advanced/Expert reveal shows a definitive red 'wrong' verdict before the group has voted, and the loudest button makes it permanent

**id:** `advanced-expert-premature-wrong-verdict`

**Expected:** The verdict stays neutral/pending until the group votes — the markup already ships that state (#verdict-banner data-verdict="neutral", 'Waiting for the reveal').

**Actual:** The banner turns red (data-verdict="wrong") the instant the card flips and states the loss in past tense ('Right spot, but you had to name it too.'); voting both chips flips it green. Tapping the 54px pink 'Next player' — far more prominent than the two thin vote chips — discards the correctly-placed card (timeline unchanged, discard pile 1). Reproduced on 6 seeds in both advanced and expert.

**Repro:**
1. Open /index.html?debug=1&seed=4242 at 393x852
2. New game; 'Skip photo' once per row; tap the Advanced mode row; Shuffle & start; continue past the pass screen
3. Tap the vinyl to draw and play the card
4. Tap a gap that is correct for the card's year (seed 4242 turn 1: 1973 'Kodachrome', timeline [1977], gap 0 is correct), then 'Place here'
5. Look at the reveal BEFORE tapping the Title or Artist chips
6. Tap the big pink 'Next player' without voting

**Why this severity:** Raised to S2 above the reporter's S3: this is 'a mode misbehaves' in the rubric's sense — in two of four modes every correct placement first reads as a loss, and the visual hierarchy pushes the table toward making that false verdict real. Not S1: once the chips are tapped the engine resolves correctly, and discarding on no-claim is arguably the intended rule, so no engine outcome is provably wrong. The unused neutral state in the shipped markup is strong evidence of intent.

**Verifier:** Reproduced verbatim in real Chrome (canPlayType aac = \"probably\") against the live Vercel site at 393x852. Seed 4242 with a 2-player roster yields exactly the reported turn 1: 1973 \"Kodachrome\", timeline [1977], gap 0 correct. On the reveal before any vote, #verdict-banner is data-verdict=\"wrong\", bg rgb(255,227,227), text \"Right spot, but you had to name it too.\", with the whole reveal screen red-tinted via the :has() rule. Same on the default 4-player roster (2009 \"Fireflies\", gap 1) and in expert mode on seed 7 (2019 \"Memories\", year call set exact). Tapping Title then Artist flips it to correct / \"Correct. The card is yours.\" and the card is kept; tapping \"Next player\" unvoted leaves the timeline unchanged with the card in discard. So the observable claim is true and precisely stated. The S2 justification does not hold. (1) Its central evidence is factually wrong: the neutral state is NOT unused - verdictFor() returns neutral/\"Card skipped. No penalty.\" for skipped cards (ui.js:2256) - and \"Waiting for the reveal\" is merely the static pre-reveal placeholder in index.html:981, so it is not evidence of intent. (2) The visual-hierarchy claim is overstated: at 393x852 the vote panel (\"DID PLAYER 1 NAME IT? / Group votes - tap what they got right\", chips 151x39) sits at y=558 directly under the banner and 90px ABOVE the 54px Next button, both fully in view, nothing hidden; at 320x568 the vote prompt is on screen while \"Next player\" is entirely below the fold (y=716 vs 568), i.e. you must scroll past the votes to reach it. (3) The mode does not misbehave: the engine resolves correctly once voted (verified in advanced and expert), and discarding an un-named correct placement is the documented rule - the setup row reads \"Advanced - the spot only counts if you also name title and artist\" (index.html:543) and the rules sheet says a correctly-placed card lost on title/artist/year \"is discarded\" (index.html:1126). What remains is premature, past-tense, red verdict copy for a decision the same screen is still asking the table to make, fully recoverable by a control visible immediately beneath it - the rubric's \"misleading copy, janky-but-recoverable flow\" (S3), not \"a mode misbehaves\" (S2). Evidence in /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-advanced-expert-premature-wrong-verdict-1/ (repro.mjs, repro2.mjs, repro3.mjs, 03-reveal-before-vote-advanced.png, B3-both-votes-advanced-4242.png, C1-320x568-reveal.png). No app files modified.

**Reported by:** adv-expert:Advanced/Expert reveal announces "Right spot, but you had to name it too." in red before the group has cast a single vote

**Evidence:** `round-2-evidence/S3-advanced-expert-premature-wrong-verdict--01-setup-advanced.png`

### 8. [S3 Minor · 3 pts] A photo added before a name is typed is filed under the placeholder 'player 1', so a later unnamed row is offered a previous player's face

**id:** `avatar-saved-under-placeholder-name`

**Expected:** A brand-new unnamed row offers no saved faces; the library should only key on names a person actually typed.

**Actual:** The new row shows 'PREVIOUS PLAYER 1 PHOTOS' containing Ada's face, adoptable in one tap (aria-label 'Use this saved photo for Player 1'). localStorage music-timeline:v1:avatars reads {"player 1":[img],"ada":[img]}.

**Repro:**
1. Open /index.html on a fresh profile (localStorage cleared), tap New game
2. On the FIRST row (still showing the default 'Player 1'), tap the circle and choose a photo — do not type a name first
3. Type the real name over it ('Ada') and blur
4. 'Skip photo' on rows 2-4, Shuffle & start
5. Reload, tap New game (roster pre-fills Ada / Player 2 / Player 3 / Player 4)
6. Tap '+ Add player' — the new empty row is auto-named 'Player 1' — and scroll to it

**Why this severity:** S3: wrong-but-recoverable roster state (one tap to change, no game rule affected), driven by a concrete storage-key bug the reporter dumped from localStorage. Related to but distinct from the empty-'previous photos'-block cluster: that one is a lookup returning nothing, this one is a write keyed on a placeholder.

**Verifier:** I tried to refute this and could not — it reproduced on the first attempt with the reported steps verbatim, and again on two independent fresh-profile runs (3/3), against the live site in real Chrome 151 at 393x852.

WHAT I SAW (scripts + screenshots in /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-avatar-saved-under-placeholder-name-1/: repro.mjs, repro2-visibility.mjs, repro3-scrolled.mjs):
- After tapping the circle on the untouched first row (still reading "Player 1") and picking a photo through the real file chooser, before typing anything: music-timeline:v1:avatars = {"v":1,"t":...,"d":{"player 1":["data:image/jpeg;base64,..."]}}. The write keys on the app's own placeholder.
- Typing "Ada" over it adds a second key: {"player 1":[img],"ada":[img]} — one face, filed twice.
- After Shuffle & start, reload, New game (roster pre-fills Ada / Player 2 / Player 3 / Player 4), "+ Add player" mints a fifth row auto-named "Player 1". That row renders a visible block reading "PREVIOUS PLAYER 1 PHOTOS" containing Ada's face, button aria-label "Use this saved photo for Player 1". The offered image is byte-identical to Ada's (both 1327 chars, identical === true).
- Visibility is real, not DOM-only: after 120px of scrolling the face hit-tests unobstructed (elementFromPoint returns the .saved-avatar button) and photographs plainly — /12-leak-row-closeup.png. One tap sets it: row 5 goes hasPhoto=true, status "Photo added", src identical to Ada's. No console errors or pageerrors in any run.

WHY NOT BY_DESIGN: nothing on the brief's by-design list touches this, and the app's own source contradicts the behaviour. storage.js rememberPerson explicitly refuses /^player\s*\d+$/i with the comment "'Player 3' is the placeholder this app puts in an empty row, not somebody's name"; ui.js isUntouchedRow repeats that judgement and its comment says "storage.js makes the same call". rememberAvatar (storage.js ~line 421) applies no such filter, so the avatar library is the one place that treats the placeholder as a person. That is an internal inconsistency, not an intended feature.

WHY NOT REFUTED/exaggerated: every factual claim held. The only nit is that the reporter quoted the stored value without its {"v":1,"t":...,"d":{...}} envelope — immaterial, the inner map is exactly as reported. Screen copy is exactly "PREVIOUS PLAYER 1 PHOTOS" as quoted (CSS uppercases "Previous Player 1 photos").

SEVERITY: S3 stands, and I checked both directions. Not S2 — no feature dead-ends, no control is hidden or unreachable, the game is unaffected and the wrong face is an offer the user can ignore or overwrite. Not S1 — no data loss, no money math, no game-rule outcome. I also considered demoting to S4 "inconsistency", but it clears the nit bar: a row for a person who has not been named yet displays and can adopt a different player's photograph in one tap, and the row's status then reads "Photo added", so the setup checklist looks satisfied with the wrong face on the wrong human. That is exactly the rubric's S3 "misleading copy / janky-but-recoverable flow". Confidence high; the only auto-apply path in the code (addPersonToGame's avatarsFor fallback) is fed by the guest list, which rememberPerson keeps placeholders out of, so there is no escalation route to S2 from here.

**Reported by:** roster:Avatar library files a face under the app's own placeholder name, so a later empty row named "Player 1" is offered a previous player's photo

**Evidence:** `round-2-evidence/S3-avatar-saved-under-placeholder-name--01-fresh-roster.png`

### 9. [S3 Minor · 3 pts] Co-op Scoreboard prints the shared timeline and shared token pool once per player under a 'Standings' heading

**id:** `coop-scoreboard-duplicates-shared-state`

**Expected:** One team card, matching every other co-op surface (the pass screen's 'THE TEAM' box, the rail's 'team 4/10 · 0/3 missed' pills, and the win recap the engine collapses to one shared row).

**Actual:** A 'Standings' screen with 8 identical rows: same shared timeline (1982, 1982, 1994, 2021), same '6 to go', and each row drawing the single 6-cap shared pool as its own 2 dots. Verified programmatically that all 8 rows differ only by name.

**Repro:**
1. Open /index.html?debug=1&seed=503 with localStorage cleared
2. New game -> tap the Co-op mode tile -> add rows until there are 8 players -> 'Skip photo' once on each
3. Shuffle & start; play 3 turns (vinyl, gap, 'Place here', 'Next player')
4. On the play screen tap any avatar in the player rail to open the scoreboard

**Why this severity:** S3: nothing is wrong per row and the mid-game scoreboard is informational, but repeating the shared pool eight times reads as 16 tokens against a cap of 6 — the number a co-op table uses to decide whether to buy a card. Not S2: this is the live scoreboard, not the end-of-game recap the rubric singles out.

**Verifier:** I tried to refute this and could not. It reproduced on the first attempt with the reported steps verbatim (real Google Chrome, 393x852, /index.html?debug=1&seed=503, localStorage cleared, co-op tile, 8 rows, one 'Skip photo' per row, Shuffle & start, 3 correct turns, then tapping a rail avatar), and again unchanged with SEED=11 and 4 players — so it is structural, not seed- or roster-specific.

Measured on the live site (script: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-coop-scoreboard-duplicates-shared-state-1/repro.mjs; screenshot: .../03-scoreboard-coop.png): heading reads "Standings"; #scoreboard-list holds 8 rows; every row shows the same shared timeline (1982, 1982, 1994, 2021), the same "6 to go", and its own 6-dot token strip with 2 filled and aria-label "2 tokens". state confirms mode=coop, tokenCap=6, sharedTokens=2, and players[].tokens=0 for all eight. All 8 rows fit on one 852px viewport, so 16 filled token dots are visible simultaneously against a shared cap of 6. No console errors, no overflow (scrollWidth 393 = clientWidth).

Refutation attempts and why each failed:
- Not by design per the brief: the by-design list covers autoplay, offline previews, module warnings, photos, the LAN QR and the Venmo deeplink — nothing about co-op surfaces. The engine's own docstring ("In co-op every row shows the shared pile", public/music/engine.js:1609) documents the behavior but is not a stated game rule, and the same codebase actively suppresses this exact duplication on three neighbouring co-op surfaces: .roster__count is hidden in co-op, #pass-standings is swapped for #pass-coop ("The team"), and seatLabel() drops the card count in co-op with the comment "the number would be noise eight times over". The scoreboard is the one co-op surface that never got that treatment, which reads as an oversight, not a rule.
- Materially exaggerated? Only trivially. "All 8 rows differ only by name" is slightly imprecise: the active player's row also carries data-active="true" with a visible "up now" flag, and each row has its own seat accent colour. Ignoring name and accent there are exactly 2 distinct row shapes (active vs. not). That does not soften the defect.
- Wrong data? No. Every per-row value is individually correct; the defect is repetition and framing, which is why S3 and not higher.

Severity held at S3, not upgraded and not downgraded. S3 covers "visual defect, misleading copy": a "Standings" heading in a mode with no standings (the sort key degenerates to seat order because cards and tokens are equal), plus a token strip that invites reading 2 tokens per player / 16 for the table when the pool is 2 with a cap of 6 — the number a co-op table uses to decide whether to spend 3 on a card. Not S2: nothing is broken or unreachable, no dead end, no hidden control, the game remains playable and winnable, and the mid-game scoreboard is informational. Not S4: it is more than polish because the misread lands on a decision-relevant number and on a heading that contradicts the mode.

**Reported by:** coop:Co-op Scoreboard prints the shared timeline and shared token pool once per player, under a "Standings" heading

**Evidence:** `round-2-evidence/S3-coop-scoreboard-duplicates-shared-state--01-setup-coop-8.png`

### 10. [S3 Minor · 3 pts] The folded 'Deck & playback' summary is clipped, so the song count is never readable and the thin-deck warning vanishes with the controls

**id:** `deck-summary-always-truncated`

**Expected:** The folded summary carries the live state it exists for — filters plus the song count — and a starved deck stays visible when the section is folded.

**Actual:** #setup-more-state is clipped by CSS (scrollWidth 244 vs clientWidth 151 at 393px; 94px at 320px), so '· 1080 songs' / '· 5 songs' is always ellipsised away. The red deck warning lives inside the foldout and disappears with it, and the summary never mentions the playback source at all.

**Repro:**
1. Open the live site at 393px wide -> New game
2. Read the collapsed 'Deck & playback' row: 'All decades · all gen…'
3. Open the foldout, turn off every decade except the 50s and every genre except Jazz (5 songs match; the red 'That is a thin deck for this many players' notice appears), then fold the section again

**Why this severity:** S3 per the rubric's 'overflow that doesn't hide controls' — no control is unreachable, the foldout can be reopened, and Start still works; what is lost is the warning text at the moment of starting. Measured at two viewport widths in two independent scripts.

**Verifier:** Reproduced exactly as written in my own real-Chrome session (channel:'chrome', live Vercel site, UI-only clicks; scripts at /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-deck-summary-always-truncated-1/verify.mjs and verify2.mjs). At 393px the collapsed 'Deck & playback' summary measures scrollWidth 244 vs clientWidth 151 and paints verbatim 'All decades · all gen…' (w393-02-summary-crop-default.png) — the reported string character-for-character. After turning off every decade but 50s and every genre but Jazz (#eligible-count-value = 5, red #deck-warning visible) and re-folding, it paints '1 decade · 1 genre · …' (w393-05-summary-crop-thin.png); at 320px clientWidth is 94 and it degrades to '1 decade · 1 …', clipping the genre count too — worse than reported. My four refutation attempts all failed: (1) wider phone does not fix it — the default string is clipped at 320/360/393/412/430 (clientWidth 94/134/151/170/188 vs scrollWidth 244), only fitting at >=768px; (2) the count is surfaced nowhere else while folded — a scan of every visible leaf node found it only inside #setup-more-state, since #eligible-count lives inside the foldout; (3) the warning really is hidden — my first rect-based probe suggested otherwise but that was a content-visibility artifact of a closed <details>, and checkVisibility({contentVisibilityAuto:true}) on #deck-warning flips true->false on fold with no red notice in the full-page shot; (4) start-blocking does not cover it — ui.js blocks only when eligible < players+1 (5 < 5 is false) and that reason renders in #setup-photo-reason outside the foldout, so at exactly 5 songs / 4 players the soft warning is the only signal and it is folded away. Not by design: the brief's by-design list omits it and the app's own source contradicts it (index.html ~line 634 'The summary carries the live state, so folding hides the controls, never what is actually switched on'; ui.js ~1239 'Folding may hide the controls; it must never hide the fact that a filter is on'). Severity held at the proposed S3, not upgraded: no control is unreachable, the foldout reopens, Start works, and the full text survives in the accessible name (summary.innerText = 'Deck & playback All decades · all genres · 1080 songs'), so there is no a11y failure — this is the rubric's own 'overflow that doesn't hide controls' bucket. Two immaterial overstatements: 'never readable' is false at >=768px and for the short thin-deck string at 430px.

**Reported by:** setup-options:The 'Deck & playback' summary — the only live state visible when the section is folded — is always truncated, so the song count is never readable and the thin-deck warning is hidden with the controls

**Evidence:** `round-2-evidence/S3-deck-summary-always-truncated--w320-01-collapsed-default.png`

### 11. [S3 Minor · 3 pts] Turning every decade (or genre) chip off silently reopens the full deck while every chip still renders unselected

**id:** `empty-filter-selection-reopens-full-deck`

**Expected:** With nothing selected the deck is empty and Start is blocked, or the chips snap back to all-selected to match the deck actually in use.

**Actual:** The count jumps 94 -> 1080 and the summary reads 'All decades · all genres · 1080 songs' while all 8 chips still report aria-pressed="false". Same for genres: the filter code treats an empty selection as no filter and nothing re-syncs the chips.

**Repro:**
1. Live site -> New game -> open the 'Deck & playback' foldout
2. Tap the decade chips off one at a time: 50s, 60s, 70s, 80s, 90s, 00s, 10s (count falls 1023 -> 869 -> 689 -> 512 -> 352 -> 240 -> 94)
3. Tap the last one (20s) off as well

**Why this severity:** S3: the controls and the deck disagree and a host can be dealt songs from a decade the chips show as excluded — misleading state, but recoverable in one tap and the song count is displayed truthfully alongside it. Not S2 because no control is hidden and the game plays correctly on whatever deck results.

**Verifier:** I tried to refute this and could not — every number and string in the report matched my own session exactly, on the first try, twice.

Live site, real Google Chrome 151 (canPlayType mp4a.40.2 = "probably"), iPhone-sized viewport, UI-only taps. Home -> New game -> tapped the "Deck & playback" summary -> tapped the 8 decade chips off one at a time. Eligible count went 1080 -> 1023 -> 869 -> 689 -> 512 -> 352 -> 240 -> 94 -> **1080**, the exact sequence claimed. At zero selected the section header reads "1080 songs match", the foldout summary reads "All decades · all genres · 1080 songs" (both open and folded), and all 8 chips report aria-pressed="false" and render in the unselected outline style (screenshot v05-deck-section.png). Turning all 14 genre chips off does the same thing: count stays 1080, summary still "all genres", 0 genre chips pressed (v06-all-genres-off.png). Nothing else in the UI resolves the contradiction — the leading "All decades" / "All genres" chip is a plain button that deliberately carries no aria-pressed and gains no active class, so the only truthful signal is the count/summary line.

Impact claim checked, not just asserted: from that all-off state I skipped photos on all 4 rows and started a real game. window.__timeline.state showed deckLen 1076 with a histogram spanning every decade (1950:56 ... 2020:93) and the opening deal included "1955 Maybellene" and "1976 Hotel California" — i.e. songs from decades whose chips read excluded. Source confirms the mechanism rather than contradicting it: filterDeck treats an empty Set as no filter (wantDecade.size === 0 || ...), and renderSetup paints pressed state straight from the empty array, so the chips and the deck disagree with nothing re-syncing them.

Refutation angles I tested and that failed: (a) no hidden "all" indicator exists; (b) the behavior is not in the brief's by-design list (that list covers autoplay, offline, module warnings, photos, QR/LAN, buy-in — not filters); (c) it is not a one-off — a second independent run reproduced it identically.

Severity stays S3, not upgraded. Recovery is genuinely one tap (tapping 80s back on immediately gave "1 decade · all genres · 177 songs"), no control is hidden or unreachable, Start is not wrongly blocked or wrongly enabled, the song count displayed alongside is truthful, and the game plays correctly on whatever deck results. That is squarely the rubric's "misleading copy / janky-but-recoverable flow" band, above S4 polish because a host who does the common "turn everything off, then switch on just the ones I want" gesture and gets interrupted mid-way starts a full-deck game while eight controls say otherwise.

Artifacts (absolute paths):
/Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-empty-filter-selection-reopens-full-deck-1/verify.mjs
/Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-empty-filter-selection-reopens-full-deck-1/verify2.mjs
/Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-empty-filter-selection-reopens-full-deck-1/v05-deck-section.png
/Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-empty-filter-selection-reopens-full-deck-1/v06-all-genres-off.png
/Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-empty-filter-selection-reopens-full-deck-1/v09-in-game.png
No pageerrors, no console errors during the run.

**Reported by:** setup-options:Turning every decade (or genre) chip off silently reopens the full deck — all 8 chips read unselected while the deck jumps back to 1080 songs and the summary says 'All decades'

**Evidence:** `round-2-evidence/S3-empty-filter-selection-reopens-full-deck--v01-setup.png`

### 12. [S3 Minor · 3 pts] Offline play never produces the promised demo timer — the ring freezes at 30s and the error copy points to three internet-only fallbacks

**id:** `offline-demo-timer-missing`

**Expected:** A silent demo timer runs the 30-second turn window, as the home screen and How to play both promise.

**Actual:** No timer at all: the ring stays full and the label stays '30s' across 12 one-second samples, audio sits at MEDIA_ERR_SRC_NOT_SUPPORTED, and the caption offers only 'Show streaming links' and the scan-on-another-phone QR — both internet-only. Grepping the served audio.js/ui.js for demo/timer/countdown finds no offline-timer implementation.

**Repro:**
1. Load /index.html once online so the service worker installs (~4s)
2. Go offline (DevTools offline or airplane mode) and reload — home loads from the worker and reads 'only previews need Wi-Fi — offline gets a demo timer'
3. New game -> 'Skip photo' once on each of the 4 rows -> Shuffle & start -> continue past the pass screen
4. Tap the vinyl (#btn-play-song) and watch for 12 seconds

**Why this severity:** Explicitly NOT covered by the by-design line 'Offline = no previews; a demo timer appears instead' — the claim is that the promised replacement does not exist, which is the opposite of that exemption, and the reporter backs it with a source grep as well as behaviour. S2: offline support is a headline feature and the turn has no timed listening window, but the game can still be played untimed, so it is not stuck.

**Verifier:** I tried hard to break this one and could not: the core fact is real, but the reporter's S2 framing is overstated, so I confirm it at S3.

REPRODUCED (exact steps, my own fresh Chrome 151 session, live Vercel site, seed=808 and again with seed=31). Script: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-offline-demo-timer-missing-1/01-repro.mjs; raw data 01-report.json / 02-report.json; screenshots 01-offline-home.png, 03-offline-after-tap.png, 07-offline-after-skip.png in the same dir.
- Codec probe returned "probably" (real Chrome), navigator.onLine=false after the offline reload, home loaded from the worker and read "Works offline - nothing leaves this phone / only previews need Wi-Fi - offline gets a demo timer".
- After tapping #btn-play-song offline, all 12 one-second samples were identical: #countdown-value "30", #countdown-ring --ring-progress "1", button label "Play song 30s", audio paused=true, currentTime=0, readyState=0, error.code=4 (MEDIA_ERR_SRC_NOT_SUPPORTED) on a real audio-ssl.itunes.apple.com src. No element anywhere on the offline play screen contains the word "demo" except the ring's own accessible title "Preview countdown".
- Source check is decisive and not just a grep: the LIVE files are byte-identical to the checkout (diff of curl'd /ui.js and /index.html vs public/music/* = no differences). The only thing that moves the ring is paintAudio() (ui.js:1683-1697), which reads the shared <audio> element's currentTime via the rAF tick in createPlayer (audio.js:856-866). Both failure paths (ui.js failAudio at ~1651, reached from "That preview would not play here" and "No preview available for this one") start nothing. There is no synthetic clock in ui.js, audio.js or listen.js. The demo timer is promised in exactly two places (index.html:457 home tagline, index.html:1157 How to play) and implemented in zero.

NOT BY_DESIGN: the brief's exemption is "Offline = no previews ... a demo timer appears instead". The exemption covers the missing audio; it presupposes the timer, so the timer's absence is outside it. If anything that line is extra evidence the timer was intended.

WHY S3, NOT S2 - two of the reporter's severity premises fail under test:
1. "Offline support is a headline feature [and it is broken]" is materially overstated. Offline support demonstrably works: entirely offline I created a new game, skipped photos, dealt, placed, revealed, scored and ran through turns 2, 3 and 4 with scores advancing normally (02-report.json "turns"). Nothing about offline play is stuck or lost.
2. "The turn has no timed listening window" is not an offline regression - there is no timed window ONLINE either. The existing round-2 evidence at scratch/qa/round-2/perf-network/06-report.json shows that when the online preview reaches 0 the app does nothing at all: the label reads "Play song 0s", no auto-advance, no lock, no rule effect. The ring is a decorative preview-progress indicator, not a turn gate, so its absence removes no gameplay function.
Also inaccurate: the title's "three internet-only fallbacks". The failure caption reads "That preview would not play here. Use the links below, or skip this card." I clicked "skip this card" while offline and it worked - card went Radar Love -> Back for Good, deck 1075 -> 1073. One of the offered escapes is fully offline-capable; only the streaming links and the QR need internet.

What is left is exactly the rubric's S3 line: misleading copy in two places plus a visual element frozen at its initial value, recoverable and hiding no control. Real, worth fixing (either build the silent 30s clock or delete the two promises), but not S2.

**Reported by:** perf-network:Offline play never shows the promised "demo timer" — the ring stays frozen at 30s and the error points to three internet-only fallbacks

**Evidence:** `round-2-evidence/S3-offline-demo-timer-missing--01-offline-home.png`

### 13. [S3 Minor · 3 pts] Double-tapping 'Play again — same players' silently resets the game mode to Classic

**id:** `playagain-doubletap-resets-mode`

**Expected:** Setup reopens with the same players AND the mode the table just played.

**Actual:** The second tap lands on the 'Classic' mode row, which occupies the same coordinates on the setup screen, so the mode silently flips to Classic. Verified for expert->classic and coop->classic.

**Repro:**
1. Open /index.html?debug=1&seed=31 in Chrome at 393x852
2. New game; leave 3 players; 'Skip photo' once per row; tap the 'Co-op' mode row (or 'Expert'); Shuffle & start
3. Continue to the play screen; open the menu; tap 'End game', then tap again to confirm
4. On the winner screen tap 'Play again — same players', then tap the same spot again ~150ms later

**Why this severity:** S3: a family starts a different game than intended, but it is visible on the setup screen before Shuffle & start and one tap fixes it — no data or cards are lost. Same underlying class as the place/next-player double-tap (no tap guard across a screen transition) but a different screen pair, a different consequence and a different likely fix site, so kept separate to avoid one of the two being lost in a fix.

**Verifier:** Reproduced exactly as written in my own fresh Chrome 151 session at 393x852 against the live site, UI-only. Scripts and screenshots: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-playagain-doubletap-resets-mode-1/ (01-verify.mjs, 02-touch-and-window.mjs).\n\nExpert run: mode chosen = expert, state.mode after start = expert, End game -> #win, tap #btn-play-again (box x=29 y=706 w=335 h=54), 150 ms later tap the same point -> checked mode radio goes expert -> classic, and the game started from that screen runs state.mode = classic. Coop run identical: coop -> classic, new game state.mode = classic. document.elementFromPoint at the button center returns label[for="mode-classic"], exactly the mechanism the finding claims.\n\nThree refutation attempts, all failed. (1) "Play again never preserves the mode anyway" — refuted by a single-tap control in the same script: one tap leaves the radio at expert/coop and the restarted game runs expert/coop. The second tap is the cause. (2) "Mouse double-click is a Playwright artifact, a real phone tap would not do this" — refuted with real touch events (hasTouch/isMobile, page.touchscreen.tap): coop -> classic at 80 ms, 150 ms, 300 ms and 600 ms inter-tap delay, and expert -> classic at 150 ms. The window is wider than the finding claims, so this catches a merely impatient second tap, not only a fast double-tap. (3) "Cosmetic only, does not reach the game" — refuted: #btn-start-game is enabled and the new game's state.mode is classic. Zero pageerrors/console errors in all nine runs. Not covered by the brief's by-design list.\n\nSeverity held at S3, no upgrade: the flipped Classic row renders highlighted on the setup screen before Shuffle & start (compare coop-double-mouse-C-final-setup.png against coop-single-mouse-C-final-setup.png, where the preserved co-op selection sits below the fold and no row is highlighted in view), one tap corrects it, and no cards, roster, saved game or money math are touched. That is "janky-but-recoverable flow", not a broken feature. Note the visual tell is subtle in the other direction too — with co-op/expert preserved, no mode row is highlighted in the visible viewport, so a user has no in-view baseline to notice the change against.

**Reported by:** chaos:Double-tapping "Play again — same players" silently resets the game mode to Classic after a Co-op or Expert game

**Evidence:** `round-2-evidence/S3-playagain-doubletap-resets-mode--coop-double-mouse-A-winscreen.png`

### 14. [S3 Minor · 3 pts] Choosing Spotify/Apple/YouTube changes nothing on the QR — it still encodes the in-app preview page while killing playback on the host phone

**id:** `playback-source-never-reaches-qr`

**Expected:** The QR carries a Spotify link so the scanning phone opens Spotify, as the option label and both hint lines promise.

**Actual:** The QR is unchanged (identical 9,974-char SVG across preview/spotify/apple/youtube) and decodes to <origin>/listen.html#<payload> — the same spoiler-free 30s preview; meanwhile the host phone refuses to play ('Open Spotify to play this card.') and the only streaming link sits on the guesser's own screen, spoiling the title. paintQr() always builds listenUrl() and never consults settings.playbackSource.

**Repro:**
1. Fresh page: open /index.html?debug=1&seed=11 with localStorage cleared
2. New game -> 'Skip photo' once per row -> Shuffle & start -> continue past the pass screen
3. Tap 'menu'. Under 'Play songs with' choose 'Spotify — opens on the scanning phone'. Note the hint: 'The others put a link on the QR, and the scanning phone will see it.'
4. Tap 'done', tap the big vinyl to draw the card
5. Scroll to the QR block and decode the rendered SVG

**Why this severity:** Two independent testers, two areas, same root: the playback-source setting never reaches paintQr(). S2 because an entire user-selectable feature delivers none of what three separate copy strings promise and simultaneously removes playback from the host phone — a broken feature the game survives, not a wrong game outcome. Worth flagging for verification: the brief's by-design list says 'the QR on the play screen opens /listen.html on another phone', so if that is unconditional by design the defect reduces to misleading copy (S3) — but the copy and the setting cannot both be right, so something is defective either way.

**Verifier:** I tried to refute this and could not — the factual core is exactly right — but the severity is inflated, so I confirm at S3 rather than S2.

WHAT I DID (real Chrome 151, channel:'chrome', 393x852, live site https://music-timeline-walksalots-projects.vercel.app, canPlayType(aac)="probably", UI-only clicks; scripts + screenshots at /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-playback-source-never-reaches-qr-1/ — repro.mjs/log.txt, repro2.mjs/log2.txt, repro3.mjs). Fresh localStorage, ?debug=1&seed=11, New game, one click per skip-photo row (4 rows), Shuffle & start, #btn-pass-continue, menu -> #opt-playback-source = spotify -> done -> #btn-play-song. Card drawn: "In the Still of the Night" / The Five Satins.

WHAT REPRODUCED (all confirmed):
1. QR is byte-identical across all four sources. Captured #qr-code svg outerHTML under spotify, apple, youtube, preview on the same card: 10019 chars each, strict equality true (my card differs from the reporter's 9,974, immaterial).
2. Independent decode agrees. I decoded the rendered SVG with Chrome's own BarcodeDetector (not the app's encoder) under spotify AND under preview — both yield the identical string https://.../listen.html#eyJ2IjoxLCJ0IjoiSW4gdGhlIFN0aWxsIG9mIHRoZSBOaWdodCIsImEiOiJUaGUgRml2ZSBTYXRpbnMiLCJuIjoxfQ . No Spotify/Apple/YouTube URL is ever on the QR. Opening that URL gives the spoiler-free 30s preview page ("Only the host's screen knows the year").
3. Host playback is disabled: status "Open Spotify to play this card.", replay disabled, no audio element src. Same card in preview mode plays for real (itunes src, paused=false, currentTime 2.51). So the setting does take effect — just not on the QR.
4. Three copy strings are false, verbatim from the live DOM: option label "Spotify — opens on the scanning phone"; setup hint "The other options put a link on the QR instead — the scanning phone will see the title."; menu note "The others put a link on the QR, and the scanning phone will see it." The QR block's own caption also stays "The scanned page shows a play button and nothing else. No year, no title." while Spotify is selected — the app contradicts itself on one screen. Reproduced from both entry points (setup #playback-source and menu #opt-playback-source). Zero console/pageerror.

WHY S3, NOT S2. The rubric puts "misleading copy" and "janky-but-recoverable flow" at S3, and reserves S2 for a broken feature/dead-end/"QR broken"/"a mode misbehaves". Here: the QR is not broken (it renders and works for its real target); "mode" in this brief means classic/advanced/expert/co-op, not this setting; and the setting is implemented — it disables in-app preview, rewrites the status line, and narrows the host's streaming links to just the chosen service. Two of the reported actuals are materially overstated: (a) "delivers nothing it promises" — with Spotify selected, every scanning phone still gets a playable, title-hiding preview via the QR, so music still reaches the other phones roughly as the label says, just not through Spotify; and the host can reach Spotify in two taps ("Show streaming links" -> "Search Spotify", href verified live); (b) "spoiling the title" — the host-side link is labelled "Search Spotify", never the title, and sits behind a visible warning "Opening a link reveals the song title." (I verified the link and warning are actually visible, box 124x42 at y=595, no horizontal overflow). Nothing is lost or stuck: switching back to preview in the menu restored playback on the same card, same turn, immediately. No game-rule outcome, no data loss, no unreachable control.

NOT BY_DESIGN. The brief's by-design line ("the QR on the play screen opens /listen.html on another phone") scopes QR testability, not a setting that explicitly promises to change the QR's contents. The code (public/music/ui.js: paintQr() -> listenUrl(), which never reads settings.playbackSource; live ui.js is byte-identical to the repo copy) and the copy cannot both be right, so a real defect exists either way — its user-visible shape is over-promising copy plus host playback switched off, which is S3.

**Reported by:** qr-listen:Picking Spotify / Apple Music / YouTube as the playback source never reaches the scanning phone — the QR still encodes the in-app preview page, so the mode delivers nothing it promises, first-run:Menu/setup copy promises the QR carries a Spotify/Apple/YouTube link, but the QR is byte-identical for all four playback sources

**Evidence:** `round-2-evidence/S3-playback-source-never-reaches-qr--01-home.png`

### 15. [S3 Minor · 3 pts] At the 8-player cap an available 'Played before' chip stays enabled and silently seats nobody

**id:** `played-before-chip-noop-at-player-cap`

**Expected:** The chip is disabled at the cap with honest copy (as '+ Add player' correctly is), or tapping says 'Game is full — remove somebody first'.

**Actual:** Nothing happens: row count stays 8, roster unchanged, no toast, tally still '8 players'. Two taps, zero feedback. The app handles the easy case — if any row still carries a default 'Player N' name the chip overwrites that row — so the dead case is specifically 8 real names.

**Repro:**
1. Fresh profile, New game, name rows Ann / Ben / Cal / Dee, 'Skip photo' each, Shuffle & start
2. Reload, New game, remove the Dee row
3. Tap '+ Add player' until there are 8 rows and give every placeholder row a real name (Guest3, Guest4, …) so no row keeps its default name
4. The 'Played before' block still shows a Dee chip in normal style, aria-label 'Add Dee to this game', not disabled
5. Tap the Dee chip. Tap it again.

**Why this severity:** S3: an enabled control that does nothing and explains nothing, but only at the maximum table size and with a working alternative (remove a row first). Distinct root from the disabled-chip styling cluster: here the chip is not disabled at all and the cap branch simply falls through.

**Verifier:** Reproduced verbatim twice on the live Vercel site in my own fresh real-Chrome sessions (scripts: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-played-before-chip-noop-at-player-cap-1/repro.mjs and repro2.mjs). After Ann/Ben/Cal/Dee -> start, reload -> New game -> remove Dee -> add rows to 8 -> give every placeholder row a real name (Guest3..Guest7), the Dee chip reports disabled=false, no disabled attribute, aria-label "Add Dee to this game", title=null, while #btn-add-player is correctly disabled with title "Eight players is the maximum". Both taps were delivered (no disabled-element refusal); row count 8->8, names byte-identical before/after, tally still "8 players", #live-status and #live-alert both empty, no toast, zero console/pageerrors. Root cause confirmed as a stale paint rather than a missing branch: one unrelated re-render (tapping skip-photo on row 4) flips the same chip to disabled=true with title "Eight players is the maximum" without any roster change, because onInput for data-role="player-name" never calls render(), so paintPeople's `full` check is never re-evaluated after typing. Recovery is trivial (remove a row -> chip live again, tap seats Dee). Reported claims all hold, none exaggerated. Nothing on the by-design list covers it. Severity stays S3: not S2 because no feature is actually broken (a 9th player is illegal anyway, the guest list works elsewhere, no control is unreachable, one tap recovers), not S4 because an enabled control that silently no-ops twice while advertising an actionable aria-label to screen readers is beyond polish - it lands squarely on the rubric's "janky-but-recoverable flow / minor a11y" line.

**Reported by:** roster:At the 8-player cap an available "Played before" chip stays enabled and silently seats nobody

**Evidence:** `round-2-evidence/S3-played-before-chip-noop-at-player-cap--01-setup-4.png`

### 16. [S3 Minor · 3 pts] 'Played before' chips for people already in the game are pixel-identical to tappable ones and give no feedback when tapped

**id:** `played-before-chips-disabled-look-identical`

**Expected:** A chip that cannot be used is visibly distinct (dimmed/greyed) or gives feedback on tap.

**Actual:** Disabled chips measure identically to the one live chip (opacity 1, colour rgb(36,28,21), background rgb(255,253,246), same border, filter none, same class). Tapping produces no toast, flash or message while the hint still reads 'Tap somebody to add them.' The only signal is a title attribute a phone never shows.

**Repro:**
1. Fresh profile, New game, name the four rows Ann / Ben / Cal / Dee, 'Skip photo' once per row, Shuffle & start
2. Reload, tap New game (roster pre-fills with all four)
3. Look at the 'Played before' row: Ann, Ben, Cal, Dee chips
4. Tap the Ann chip

**Why this severity:** S3: a missing affordance on the most common return path (roster pre-filled from the last game), recoverable and blocking nothing. Kept separate from the 8-player-cap chip cluster — that chip is genuinely NOT disabled and the fix is cap-handling logic, whereas this one is disabled-state styling.

**Verifier:** I tried to refute this and could not. Exact repro worked first try, twice, deterministically, in real Chrome (canPlayType='probably').\n\nWhat I measured after Ann/Ben/Cal/Dee → Shuffle & start → reload → New game: all four `#people-list [data-action=\"add-person\"]` chips are `disabled: true` yet compute to opacity 1, color rgb(36,28,21), background rgb(255,253,246), border 1px rgb(36,28,21), box-shadow `rgba(36,28,21,.14) 2px 2px 0`, filter none, cursor **pointer**, className exactly `person__add` — i.e. no disabled styling at all. Tapping the Ann chip with a real mouse/finger click at its bounding-box centre: chip styles `NO CHANGE`, `.toast` still hidden, every `[aria-live]` region (`live-status`, `live-alert`) unchanged/empty, and the hint still reads \"Tap somebody to add them.\" Holding the finger down produced no :active feedback (opacity 1, transform none). No console errors, no pageerror.\n\nI also built the side-by-side control the finding implies: removing the Dee row frees exactly one live chip, and Dee (disabled:false) measures byte-for-byte identical to Ann/Ben/Cal (disabled:true) on every one of those properties. The cropped screenshot `09-people-list-crop.png` shows four chips a human cannot tell apart.\n\nRoot cause is visible in the shipped CSS: `.person__add` (app.css:1290) has no `:disabled` rule and is not a `.btn`, while the app's own house convention `.btn:disabled { opacity:.45; cursor:default }` (app.css:339, mirrored by `.betbtn`, `.challenge-option`, `.disc__hub`, `.linkbtn`) exists everywhere else — so this is an inconsistency with the app's own disabled treatment, not a deliberate design.\n\nNothing on the brief's by-design list touches this. One small inaccuracy in the finding, not material: the chip does carry `aria-label=\"Ann is already playing\"`, so screen-reader users are told — the finding says the title attribute is \"the only signal\". That does not rescue the sighted-tap case, which is the substance.\n\nSeverity held at S3, not upgraded and not downgraded. The rubric puts \"visual defect\" and \"misleading copy\" at S3, and both are present at once (four inert chips under copy that says to tap them). It is above S4 polish because it misleads a user into a wasted action on the most common return path; it is below S2 because nothing is blocked, unreachable, or wrong — the roster rows directly beneath show the same four names.

**Reported by:** roster:"Played before" chips for people already in the game look exactly like tappable ones and do nothing when tapped

**Evidence:** `round-2-evidence/S3-played-before-chips-disabled-look-identical--01-setup-ready.png`

### 17. [S3 Minor · 3 pts] When a 30-second preview ends on its own the vinyl reads '0s' and the caption still says 'Playing the preview.'

**id:** `preview-end-state-stale`

**Expected:** After the clip ends the control invites another listen (ring reset to 30s / 'tap to hear it again') and the status stops claiming the song is playing.

**Actual:** The ring is drained, the vinyl shows a play triangle over '0s', and the caption still reads 'Playing the preview.' two seconds later (ended=true, paused=true, currentTime=30.01). Tapping does restart the clip from 0 with zero network, but nothing on screen says so.

**Repro:**
1. Load index.html -> New game -> 'Skip photo' per row -> Shuffle & start -> continue past the pass screen
2. Tap the vinyl (#btn-play-song) and let the clip run all 30 seconds without touching anything
3. Look at the vinyl and the line beneath it

**Why this severity:** S3: stale UI state at the exact moment the player is deciding where to place — the screen claims audio is playing into a silent room and '0s' reads as a used-up listen — but replay still works on tap, so it is misleading rather than broken. Independently reproduced on two seeds.

**Verifier:** I ran the exact repro in my own fresh Chrome session (channel:'chrome', canPlayType => "probably", real audio-ssl.itunes.apple.com src, currentTime advanced 2.79s -> 30.02s, no console errors) against the live Vercel target, on two independent seeds (4242 and 777), via UI-only clicks. Script: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-preview-end-state-stale-1/verify.mjs; evidence a-report.json, b-report.json, a-03-after-end.png, a-04-after-end-plus2s.png in that directory.

Both runs, measured on the real elements rather than a fuzzy text search: after natural end audio.ended=true, paused=true, t=30.02 / 29.98; #audio-status.textContent === "Playing the preview."; #countdown-value === "0" (disc shows "0s"); --ring-progress === "0"; play triangle re-shown, aria-pressed="false". Still identical 2.5s later. The screenshot shows exactly what the finding describes: a play triangle over "0s" with "Playing the preview." underneath. Cause in source: ui.js sets view.audio.status='Playing the preview.' (lines 1611/1646) and paintAudio() (line 1684) intentionally never calls render(), so nothing ever clears that string; the same stale caption also shows after a manual pause (my 06-manual-pause snap: paused=true, status unchanged), so it is "status never updated on stop", not something unique to natural end.

I tried to refute two ways and both failed. (1) The original reporter's own 06-report.json never actually captured the caption — its selector matched unrelated setup copy ("Previews play here and hide the title...") — but reading #audio-status directly proves the claim anyway. (2) Nothing on the brief's by-design list covers it.

One material exaggeration to record, though not enough to refute: "nothing on screen says so" is false. The hub icon flips back to a play triangle, aria-pressed goes to false, the sr-only label reverts to "Play song", and a visible "replay" link sits directly beneath the vinyl. The real defect is narrower — one aria-live status line asserting a false state, plus ring/countdown parked at 0s.

Severity held at S3, not upgraded and not downgraded: the rubric lists "misleading copy" and "minor a11y" under S3, and a role="status" live region claiming audio is playing into a silent room is copy that is factually wrong about system state, not S4 wording polish. It is not S2 because no feature is broken — one tap restarts the clip and the turn proceeds normally.

**Reported by:** perf-network:When a 30-second preview ends on its own, the vinyl reads "0s" and the caption still says "Playing the preview."

**Evidence:** `round-2-evidence/S3-preview-end-state-stale--a-01-before-tap.png`

### 18. [S3 Minor · 3 pts] 'PREVIOUS <NAME> PHOTOS' heading renders with an empty box when a saved face exists but none is offered

**id:** `previous-photos-heading-with-empty-list`

**Expected:** Either Adaline's saved face is offered, or the 'Previous photos' section stays hidden.

**Actual:** Row 4 shows a 'PREVIOUS ADALINE PHOTOS' heading with nothing beneath it, although localStorage music-timeline:v1:avatars contains {"adaline":[img]}. Console: {savedHidden:false, savedLabel:'Previous Adaline photos', savedCount:0}. Reproduced 2/2 runs plus once in a longer sequence.

**Repro:**
1. Fresh profile, tap New game
2. Row 1: tap the circle and choose a photo
3. Row 1: type 'Ada', blur
4. Row 1: retype the name to 'Adaline', blur
5. Row 4: type 'Adaline', blur, and look at row 4

**Why this severity:** S3 visual/flow defect: an empty section under a heading that promises content, in the one feature meant to spare families re-taking photos. Nothing is blocked and the photo can still be added manually, so it does not reach S2.

**Verifier:** I tried to refute this and could not — it is deterministic, not flaky, and I have both the pixels and the source-level cause.

Repro run in my own fresh Chrome 151 session against the live site (`https://music-timeline-walksalots-projects.vercel.app/index.html?debug=1`), UI-only (real file-picker input, real keystrokes via `page.keyboard.type`, real blur). Script: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-previous-photos-heading-with-empty-list-1/v2-exact.mjs. Ran it twice (tags v2, v3) — identical output both times, zero pageerrors, zero console errors.

Row 4 final state, both runs:
`{value:"Adaline", savedHidden:false, savedLabel:"Previous Adaline photos", savedCount:0, boxH:24px}`
and the localStorage library really does hold the face: `music-timeline:v1:avatars` = `{"player 1":1,"ada":1,"adaline":1}`.

Screenshot showing the rendered heading over an empty strip: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-previous-photos-heading-with-empty-list-1/v2-02-row4-crop.png (row reads "Adaline / Photo needed / Skip photo / PREVIOUS ADALINE PHOTOS" with nothing under the heading). Full-page: v2-01-full.png, v3-01-full.png in the same directory.

Cause, per-keystroke trace (my instrumentation, not inference):
```
key 'a' -> "Ada"     hidden=false count=1 sig=1327ch label="Previous Ada photos"
key 'l' -> "Adal"    hidden=true  count=0 sig=1327ch   <- list emptied, signature NOT cleared
key 'e' -> "Adaline" hidden=false count=0 sig=1327ch label="Previous Adaline photos"
```
`paintSavedAvatars()` in public/music/ui.js:752-788 bails out of the empty-list branch (`if (!saved.length) { replaceChildren(list, []); return; }`) without resetting `list.dataset.signature`. Because Adaline's saved face is byte-identical to Ada's, the signature computed for the final name matches the stale one, so the `if (list.dataset.signature === signature) return;` fast path skips the rebuild — after `show(box, true)` and the label write have already run. Heading and box visible, list empty.

Refutation attempts that failed to kill it: (1) my first run did not clear row 4's pre-filled "Player 4" value, producing "Player 4Adaline" and no heading — but the reported repro and any real user do clear the field, so that is not a material step difference, just my own setup error; (2) not environment- or timing-dependent (2/2 with 160 ms settle per key, and the source shows it is purely deterministic given a name whose prefix is also in the library); (3) not on the by-design list.

Severity holds at S3, no upgrade. It is a visible visual/copy defect plus a silently dead convenience feature — the saved Adaline face exists and is never offered, so a family re-picks the photo by hand. Nothing is blocked, the pick-photo and Skip photo controls both work, and no game rule or money math is touched, so it does not reach S2. The precondition (a saved name that is a strict prefix of the name now being typed — Ada/Adaline, Sam/Samantha, Dan/Daniel) is realistic but narrow, which argues against upgrading and not for downgrading below S3, since the empty heading is plainly visible when it happens.

**Reported by:** roster:"PREVIOUS <NAME> PHOTOS" heading renders with an empty box when the saved face exists but nothing is offered

**Evidence:** `round-2-evidence/S3-previous-photos-heading-with-empty-list--face.png`

### 19. [S3 Minor · 3 pts] How to play states a token cap of 5 and says whose the tokens are is the only co-op difference, but co-op caps at 6

**id:** `rules-text-wrong-coop-token-cap`

**Expected:** The rules screen's cap matches the game.

**Actual:** Live co-op renders 6 token pills with aria-label 'Tokens: 2 of 6' (COOP_TOKEN_CAP = 6 vs TOKEN_CAP = 5). Round 1's '6 token pills' fix changed the UI but not the rules text.

**Repro:**
1. Fresh page: Home -> 'How to play'
2. Read 'TOKENS · START WITH 2, HOLD AT MOST 5' and the closing line 'Tokens are spent and earned the same way in every mode. The only difference is whose they are…'
3. Close -> New game -> 'Skip photo' per row -> select mode 'Co-op' -> Shuffle & start -> Continue
4. Look at the token rail next to the active player

**Why this severity:** S3 misleading copy: the game itself behaves consistently, only the rules screen lies, so a table plans its spending around a wrong ceiling in the one mode where the pool is shared. Directly traceable to an incomplete round-1 fix, which makes it a likely-real regression rather than a nit.

**Verifier:** Reproduced first try on the live production site in real Chrome via UI-only steps exactly as written (script: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-rules-text-wrong-coop-token-cap-1/repro.mjs). The rules screen heading reads verbatim "TOKENS · START WITH 2, HOLD AT MOST 5" with no mode qualifier, the digit 6 appears nowhere in the entire rules screen, and the closing aside reads verbatim "Tokens are spent and earned the same way in every mode. The only difference is whose they are: in co-op there is one pool, so a challenge or a bought card is paid for by the whole table." The live co-op game then reports state.tokenCap = 6, renders 6 pills in #play-tokens with aria-label "Tokens: 2 of 6", and this is visible to a sighted user (two filled + four empty dots, 04-coop-play-tokens.png). The wrong number also persists on the in-game rules screen opened from the menu mid-co-op-game. Zero console/page errors. My refutation attempts all failed: (1) "the aside only covers spend/earn, not caps" does not hold, because the H2 is itself an unqualified cap statement and the aside's "the only difference is whose they are" forecloses the exception, while the "four modes" co-op entry lists shared timeline, shared pool and mistake limit but never the cap; (2) not covered by the brief's by-design list, and engine.js:143-149 shows COOP_TOKEN_CAP = 6 is a deliberate design choice with a written rationale, which makes the rules text the defective artifact; (3) the round-1 attribution is accurate — git show 2bb298c changed paintTokens to rebuild the rail to the engine's cap ("the markup ships the classic five pills; the cap is the engine's to set (co-op holds six)"), so before round 1 the rail showed 5 and the copy looked right; that commit touched neither COOP_TOKEN_CAP nor the rules copy. Severity held at S3, not upgraded and not downgraded: the rubric puts "misleading copy" at S3 and this is a factually wrong number rather than a phrasing nit; it is not S2 because engine and rail agree and no feature is broken; I considered S4 because the true cap is displayed beside the active player, but the wrong number survives on the very in-game rules screen a table would consult to settle the question.

**Reported by:** first-run:How to play states the wrong token cap for co-op: it says 'hold at most 5' and 'the only difference is whose they are', but co-op caps at 6

**Evidence:** `round-2-evidence/S3-rules-text-wrong-coop-token-cap--01-rules-token-heading.png`

### 20. [S3 Minor · 3 pts] Reloading during setup restores the player names but silently resets target, mode, streak, buy-in, Venmo handle and deck filters

**id:** `setup-reload-keeps-names-drops-options`

**Expected:** Either the whole setup comes back or none of it does — the app should not restore half of what was entered.

**Actual:** Only the names return. Target back to 10, streak OFF, buy-in OFF, amount and Venmo handle blank, deck filters back to all 8 decades. No message. Closing and reopening the sheet preserves everything, so the loss is specific to reload.

**Repro:**
1. Open /index.html?debug=1 in a fresh profile
2. Tap New game; name two players (Ann, Bob); remove the extra rows
3. Tap '+' next to 'First to' once (target 15); turn ON 'Streak bonus'; turn ON 'Buy-in'; tap '+' on 'Each' ($3, Pot: $6 with 2 players); type '@ann-kibak' in the Venmo field and blur
4. Reload the page, then tap New game again on the home screen
5. Compare with what you configured

**Why this severity:** Two testers, two areas, identical mechanism (names persist, everything else is draft-only until Shuffle & start). S2 not S1: nothing already-saved vanishes — the game has not started and no stake exists yet — but the restored names actively signal 'your setup was remembered', so a family starts a materially different game (wrong target, wrong mode, no pot) without being told. An iOS Safari tab reclaim triggers the reload with no user action, so the path is common.

**Verifier:** Reproduced on the first attempt, exactly as written, in real Google Chrome at 393x852 against the live Vercel site, and again in a second independent trial. Script/evidence: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-setup-reload-keeps-names-drops-options-1/ (05-full2.mjs, 06-mode.mjs, 05-out.txt, 06-out.txt, screenshots A- through G-).

Trial 1 measured, before reload vs after reload+New game: names Ann/Bob -> Ann/Bob (kept); "First to" 15 (approx 70 min) -> 10 (approx 45 min); Streak bonus true -> false; Buy-in true -> false; Venmo "@ann-kibak" -> ""; buy-in amount $3 with "Pot: $6 with 2 players" -> fields gone; deck summary "7 decades - all genres - 1023 songs" -> "All decades - all genres - 1080 songs". No toast, no notice, zero console errors, zero pageerrors. The reporter's control also holds: closing the sheet via "close" and reopening via New game preserved everything (screenshot B-after-close-and-reopen.png), so the loss is genuinely reload-specific. The only localStorage key ever written is music-timeline:v1:players, which is exactly the mechanism claimed.

Trial 2 checked the title's "mode" claim, which the reported repro steps never actually exercised: expert -> classic after reload. Accurate, so no exaggeration there either. Trial 2 also surfaced a detail the reporter missed that cuts FOR the finding: the per-row "skipped" flag lives in the persisted roster, so if photos were skipped before the reload, #btn-start-game comes back enabled (startDisabled: false) - there is no forced re-engagement, and one tap starts the wrong game.

Severity downgraded 8 -> 3. The S2 rationale rests on "a family starts a materially different game without being told," and that overstates it: screenshot G-after-reload-mode.png shows every reverted value plainly rendered on the very screen the user is looking at - a large "10" in the stepper, "approx 45 min", Classic highlighted, both toggles visibly off, and the foldout summary honestly reading "All decades - all gen...". Nothing is hidden, nothing is wrong, and recovery is about five taps. Nothing saved vanishes (the roster is the one thing that survives), no game is in progress, no stake exists, and no money math is wrong, so S1's data-loss line does not apply. The rubric's S2 examples are all "a feature exists and does the wrong thing" (challenge dead-end, wrong recap, broken QR, misbehaving mode); setup-draft persistence simply does not exist, which is S3's "janky-but-recoverable flow" plus the inconsistency of a half-restore with no notice. Also untested here: the reporter's claim that iOS Safari tab reclaim makes this a common no-user-action path is plausible but I only drove Chrome on macOS.

**Reported by:** persistence:Reloading during setup silently resets every game option except the player names (target, mode toggles, streak bonus, buy-in and the Venmo handle all revert to defaults), first-run:A reload during setup restores the player names but silently resets target, mode, streak bonus, buy-in, Venmo handle and deck filters

**Evidence:** `round-2-evidence/S3-setup-reload-keeps-names-drops-options--00-home.png`

### 21. [S3 Minor · 3 pts] Changing 'Play songs with' while a preview is playing leaves the song playing and makes the Pause control dead

**id:** `source-switch-mid-preview-orphans-audio`

**Expected:** Either switching the source stops the running preview, or the button that says 'Pause' pauses it.

**Actual:** The preview keeps playing (audio.paused stays false, currentTime advances 3.99 -> 5.83s across the tap), the button still reads 'Pause 25s', and the status beneath says 'Open Spotify to play this card.' Tapping 'replay' even restarts the clip. Only leaving the play screen or letting the 30s clip end stops it; the Sound-off toggle does stop it correctly, so the defect is specific to the source switch.

**Repro:**
1. Fresh page (localStorage cleared): New game -> 'Skip photo' each row -> Shuffle & start -> continue past the pass screen
2. Tap the vinyl to play the preview (the button now reads 'Pause NNs', audio audible)
3. Tap 'menu', set 'Play songs with' to 'Spotify', tap 'done'
4. Tap the vinyl again (it still says 'Pause')

**Why this severity:** S3 janky-but-recoverable: a visible control that does nothing and audio that will not stop on demand, at the exact moment a table wants silence — but it self-resolves in under 30 seconds, an alternative stop path exists (Sound off / leave the screen), and no game state is affected. Separate root from the QR/playback-source cluster: that one is the QR never reading the setting, this one is the running audio not being torn down when the setting changes.

**Verifier:** Reproduced exactly as written, first attempt, in my own fresh Chrome session (channel:'chrome', canPlayType(aac)=\"probably\", real audio-ssl.itunes.apple.com src, readyState 4, muted=false, volume=1 — genuinely audible, not an environment artifact), then again deterministically on a second seed. Script/log/screenshots: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-source-switch-mid-preview-orphans-audio-1/ (verify.mjs, log.txt, log-seed7.txt, 06-after-pause-tap.png).

I ran a control first to try to refute it as a general broken-pause claim: with source still 'preview', tapping the vinyl DOES pause (paused false->true, label 'Pause 28s' -> 'Play song 28s'). So the defect is specific to the source switch, exactly as the reporter scoped it.

Seed 101: after menu -> 'Play songs with' = Spotify -> done, audio still running (paused:false, ct 10.85, label 'Pause 20s'). Tapping the vinyl: ct 11.44 -> 13.22 (advanced 1.78s), paused stays false, label 'Pause 17s', status flips to 'Open Spotify to play this card.' Second tap: 13.22 -> 15.58, still playing. 'replay' restarts the clip (ct -> 1.34, 'Pause 29s'). Seed 7 identical (9.28 -> 11.10). The claimed contrast holds too: Sound off gives paused:true, ct 0. Zero pageerrors, zero console errors. Reported deltas (3.99 -> 5.83) were not exaggerated; mine are the same magnitude.

Root cause is visible in the shipped ui.js on the live origin: toggleAudio() does `if (settings.playbackSource !== 'preview') { view.audio.failed = true; view.audio.status = 'Open Spotify...'; render(); return; }` BEFORE reaching `if (p.playing) { p.pause(); return; }`, and the settings path (updateSettings -> applySettings) never touches the player — while the sibling handler `if (node.id === 'opt-sound') { updateSettings(...); if (!node.checked) stopAudio(); }` proves teardown was wired for the other switch and simply omitted here. Button label is driven by paintAudio() off the audio clock (`playing ? 'Pause' : ...`), independent of playbackSource, so it keeps saying Pause. Nothing in the brief's by-design list covers this (that list only exempts autoplay-requires-tap, offline previews, module warnings, photos, QR LAN scanning, and the Venmo deeplink), so BY_DESIGN does not apply.

Not a duplicate of verify-playback-source-never-reaches-qr: that root is the QR/streaming-link builder (ui.js ~2189-2198); this one is the toggleAudio early return (~1570).

Severity held at S3, not upgraded and not downgraded. Not S2: the game survives untouched, no game state or rule outcome is affected, no control is unreachable, and two working stop paths exist (Sound off, leaving the play screen) plus the clip self-ends within 30s. Not S4: a control the user taps to silence a room does nothing to the audio and keeps advertising itself as Pause, which is beyond polish/wording — it lands squarely on the rubric's 'janky-but-recoverable flow'.

**Reported by:** first-run:Changing 'Play songs with' while a preview is playing leaves the song playing and makes the Pause control dead

**Evidence:** `round-2-evidence/S3-source-switch-mid-preview-orphans-audio--01-setup.png`

### 22. [S3 Minor · 3 pts] Renaming a player leaves the previous name in every control's screen-reader label until the list re-renders

**id:** `stale-aria-labels-after-rename`

**Expected:** The circle announces 'Add a photo for Rosalind', the remove link 'Remove Rosalind', the toggle 'Skip the photo for Rosalind'.

**Actual:** They still announce the previous value ('Add a photo for Omar' / 'Remove Omar' / 'Skip the photo for Omar'); visible text and the saved-photo lookup update live, only the aria-labels are stale. They correct themselves only when the list re-renders (adding or removing any player).

**Repro:**
1. Fresh profile, New game
2. Row 2 is named 'Player 2'. Type 'Rosalind' over it and blur
3. Inspect that row's three controls in the accessibility tree

**Why this severity:** S3 per the rubric's 'minor a11y (missing label…)' — the labels exist and are reachable, they are just out of date, and the sighted state is correct. Aggravated by the fact that one of the mislabelled controls is destructive (remove), but no control is unreachable, so it does not meet the S2 a11y bar.

**Verifier:** Reproduced verbatim in my own fresh Chrome 151 session against the live production site (UI-only, no evaluate-clicks). Fresh profile (localStorage empty) -> New game -> typed 'Rosalind' over row 2's 'Player 2' and blurred. Row 2 then read: value 'Rosalind', initial 'R', but avatar aria-label 'Add a photo for Player 2', skip 'Skip the photo for Player 2', remove 'Remove Player 2'. Playwright's independent ARIA snapshot agrees: textbox "Player 2 name" containing 'Rosalind' sits between button "Add a photo for Player 2" and button "Remove Player 2"; getByRole('button', {name:'Remove Rosalind'}) returns 0 matches, 'Remove Player 2' returns 1. The avatar button has no text content (img alt="", spans aria-hidden), so the stale aria-label is its ONLY accessible name. Mechanism confirmed in public/music/ui.js:3336-3359 - the player-name input handler mutates draft.name, hand-patches the visible initial and saved-avatar lookup, then returns without render(); the aria-labels are written only in paintRoster's per-draft loop (lines 1131-1146). I attacked the obvious downgrade - that the stale state is transient and self-heals on the next tap - and it failed: using the brief's own documented fast path (Skip photo on every row FIRST, then type the real names), all four rows still announced the old placeholder names with #btn-start-game enabled and reading 'Shuffle & start' (4/4 rows stale at game start). Two imprecisions in the write-up, both non-material: (1) the 'actual' quotes 'Remove Omar' although a single rename leaves the generic placeholder stale, not another human's name - naming a different human needs a second rename, which I did reproduce (input 'Bernadette', labels 'Remove Rosalind'); (2) 'correct themselves only when the list re-renders (adding or removing any player)' is incomplete - Skip photo also refreshes them - but the governing clause 'until the list re-renders' is accurate. Neither alters the steps or the expected/actual. Severity held at the proposed S3 with no upgrade: not S2 because there is no trap and no unreachable control (tab order, touch targets and visible text 'remove'/'Skip photo' are all intact, and the correct value is announced by the input immediately before the two mislabelled buttons); not S4 because the rubric places 'minor a11y (missing label...)' at S3 and a label actively naming the wrong person beside a destructive Remove is not milder than a missing one. Nothing in the by-design list covers it. Evidence: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-stale-aria-labels-after-rename-1/ (verify.mjs, verify2.mjs, log.txt, log2.txt, ax-after-rename.txt, 02-after-rename-blur.png, 05-names-typed-labels-stale.png).

**Reported by:** roster:Renaming a player leaves the old name in every control's screen-reader label until the whole list re-renders

**Evidence:** `round-2-evidence/S3-stale-aria-labels-after-rename--01-setup.png`

### 23. [S3 Minor · 3 pts] When localStorage is full the game saves nothing, warns nobody, and disappears on reload — unlike blocked storage, which does warn

**id:** `storage-full-silent-nosave`

**Expected:** The same treatment as blocked storage: a visible line such as 'This browser won't save games…' so the family knows the night is not being saved.

**Actual:** No warning at any point, the save write fails silently, and after reload the home screen has no 'Resume game' card — the game is simply gone. With storage blocked rather than full, the app does show its warning.

**Repro:**
1. Fill the origin's localStorage to quota before the app loads (addInitScript writing 256 KB then 2 KB chunks until setItem throws)
2. Load the site — home renders normally with no notice
3. New game -> 2 players -> 'Skip photo' each -> Shuffle & start
4. Play a complete turn (Start the turn -> Play song -> tap a gap -> Place -> Next player)
5. Read localStorage['music-timeline:v1:game'] -> null, then reload the page

**Why this severity:** S3, matching the reporter's own medium confidence: the defect proper is the missing warning on a quota failure path that the app already handles correctly for the blocked case, and the trigger (an origin at quota) has to be manufactured. If verification shows a realistic phone path to quota exhaustion — large saved avatars, say — the silent total game loss makes S2 arguable.

**Verifier:** I tried to break this and could not. It reproduced on my first attempt with the reported steps verbatim, in my own fresh real-Chrome session (channel 'chrome', 393x852), against the live Vercel site.

MY RUN (/Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-storage-full-silent-nosave-1/01-exact-repro.mjs, log 01.log): filler wrote 19x256KB + 127x2KB (localStorage at 5,242,172 chars). Home rendered normally; I instrumented a MutationObserver + 150ms poller for any "won't save / storage / quota / full / not saved" text and it captured NOTHING across the whole session. #home-storage-warn and #setup-storage-warn stayed `hidden` at home, setup, start, mid-turn and post-reload; #toast hidden; #live-alert empty; zero console errors, zero pageerrors. After one complete turn localStorage['music-timeline:v1:game'] was null while the in-memory state was turn 2 / Ann 2 cards. Reload -> no #btn-resume-game, plain home screen (05-after-reload.png). Small keys (players 117, people 117, buyin 74 chars) DID persist, so the app kept writing successfully all night while silently dropping the one payload that matters.

REFUTATION ATTEMPTS, all failed (02-controls.mjs, logs 02.log/02b.log):
- Control, untouched storage, same script: saved 139,752 chars, "Resume game — Turn 2 — Ann, Bob" appears. The filler is causal, not the script.
- Blocked storage (SecurityError on every call): the warning IS shown, home and setup, exactly as claimed. The asymmetry is real, not a misread.
- Full to the very last byte (zero headroom): the app warns correctly here too, because storage.js store()'s tiny probe finally fails. So the app handles both neighbours of this case properly and only the in-between band is silent.
- ~200KB headroom: saves and resumes fine.

CODE CONFIRMS THE MECHANISM (read-only fetch of the live storage.js / ui.js): store() probes with a 1-char key, so isPersistent() is true whenever a few dozen bytes are free; the banner is driven only by !isPersistent() (ui.js:987, ui.js:1283). writeRaw() catches the quota error, drops to an in-memory map and returns false "to tell the caller the truth - this will not survive a reload", set()/saveGame() propagate that false — and persist() (ui.js:897-903) discards the return value entirely. Nothing ever surfaces it.

SEVERITY, applied coldly — S3, no upgrade. I checked the reporter's own S2 hypothesis (a realistic phone path via large avatars) and it does not exist on this origin: photos are 192px JPEG q0.72 (ui.js:145), capped at 3 per name x 24 names, so the durable avatar ceiling is roughly 1MB against the 5.24M-char quota I measured; the only other big consumer, the preview cache, is capped at 500 entries and is explicitly sacrificed on a quota error (SACRIFICIAL_KEYS matches audio.js PREVIEW_CACHE_KEY 'music-timeline:preview:v1' exactly, so the self-heal actually works). Nothing but this app writes to this origin, and this app cannot fill it, so reaching the silent band requires a manufactured origin state. Not S4 either — losing a whole evening with no notice is not polish, and the app has a purpose-built warning for the adjacent case. The honest scope: the silent window is "free space below the ~140KB save size but above the ~30-byte probe", which I verified at both edges.

Evidence: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-storage-full-silent-nosave-1/ (01.log, 02.log, 02b.log, 05-after-reload.png = silent loss, 08-C-home.png = the warning the full-to-last-byte case correctly shows).

**Reported by:** persistence:When localStorage is full the game saves nothing, warns nobody, and the entire game disappears on reload — unlike the blocked-storage case, which does warn

**Evidence:** `round-2-evidence/S3-storage-full-silent-nosave--01-home-full-storage.png`

### 24. [S3 Minor · 3 pts] The 'Correct' verdict pill fails WCAG AA at 3.81:1 while the matching 'wrong' pill passes

**id:** `verdict-pill-contrast-fails-aa`

**Expected:** Body-size verdict text meets AA 4.5:1 — the round-1 fix pass claimed secondary text now clears AA.

**Actual:** 3.81:1. The green pair (--good-text #2b8a3e on --good-tint #d3f9d8) misses AA while the red pair it mirrors (#c92a2a on #ffe3e3) passes at 4.51:1. The same --good-text on paper also fails at 4.29:1 for the setup deck tally ('X songs match').

**Repro:**
1. Open /index.html -> New game -> 'Skip photo' once per row -> Shuffle & start -> Start the turn
2. Tap the vinyl, tap a correct gap, tap 'Place here'
3. Inspect .verdict[data-verdict="correct"]: color rgb(43,138,62) on rgb(211,249,216), 13.5px, weight 600

**Why this severity:** S3 is exactly the rubric's 'weak contrast' bucket. Kept above the avatar-initial contrast cluster because the shortfall is larger (3.81 vs a 4.5 target) and it lands on the single line that tells a player whether they kept the card, in a room with dim lighting and arm's-length phones.

**Verifier:** Reproduced first try in real Google Chrome 151 (canPlayType='probably') at 393x852 against the live Vercel site, driving the UI only (New game -> Skip photo x4 -> Shuffle & start -> continue -> vinyl -> legal gap -> Place here). Measured .verdict[data-verdict=\"correct\"] = rgb(43,138,62) on composited rgb(211,249,216) at 13.5px/600 -> 3.809:1; the mirror .verdict[data-verdict=\"wrong\"] = rgb(201,42,42) on rgb(255,227,227), identical size/weight -> 4.508:1 PASS. Independently sampled the painted pixels from the screenshots (darkest glyph 42,135,61 on 208,245,213 -> 3.82:1; red 196,41,41 on 251,223,223 -> 4.52:1), so this is not a computed-style artifact. chainOpacity=1, text-shadow none, prefers-color-scheme dark=false, so no animation/overlay/theme confound. 13.5px at weight 600 is not WCAG large text (needs >=24px, or >=18.66px at >=700), so 4.5:1 is the right threshold. Secondary claim also holds: .sect__match \"1080 songs match\" = rgb(43,138,62) at 12px/600 -> 4.292:1 FAIL. Refutation attempts that failed: not on the brief's by-design list; the pill is not redundant chrome - the full reveal screenshot shows it is the only line stating whether the player kept the card (the large 1977 is the year). One immaterial imprecision: the tally composites against --card #fffdf6, not --paper #fff8e7 as the finding words it, and it lives inside the collapsed Deck & playback foldout (one tap away); the stated 4.29 ratio is exactly correct for the real background and fails either way. Severity held at S3 because the rubric names 'weak contrast' explicitly in the S3 minor-a11y bucket - no upgrade (nothing hidden or unreachable) and no downgrade to S4 (S4 is spacing/wording/animation polish). Evidence: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-verdict-pill-contrast-fails-aa-1/{verify2-out.json,verify2-log.txt,pixels-out.json,w-02-reveal-correct.png,w-03-pill-correct.png,w-05-pill-wrong.png,x-01-deck-tally.png}

**Reported by:** a11y:"Correct" verdict pill text fails WCAG AA at 3.81:1 (the matching "wrong" pill passes)

**Evidence:** `round-2-evidence/S3-verdict-pill-contrast-fails-aa--v-01-setup.png`

### 25. [S3 Minor · 3 pts] The end screen's focused heading always announces 'Winner:', so a co-op loss is read out as 'Winner: So close'

**id:** `win-title-hardcoded-winner-prefix`

**Expected:** The h1 that receives focus announces the outcome that happened, e.g. 'Game over: So close'.

**Actual:** #win-title contains a hardcoded <span class="sr-only">Winner: </span>, so its accessible name is 'Winner: So close' on a loss (#win[data-outcome="loss"]) and it is the focused element on entry. The same prefix mislabels every non-victory ending: 'Stopped early', 'Level when it ended', 'Ahead when it ended', 'Joint winners', 'No winner' — verified live on an end-early game announcing 'Winner: Player 1, Player 2, Player 3 & Player 4'.

**Repro:**
1. Open /index.html -> New game -> remove Player 4 then Player 3 (2 players left) -> 'Skip photo' once per row
2. Pick Co-op, tap 'Fewer mistakes allowed' until the limit reads 1
3. Shuffle & start -> Start the turn -> vinyl -> tap a clearly wrong gap -> Place here -> Next player
4. On the 'GAME OVER / So close' screen read the focused heading's accessible name

**Why this severity:** Lowered from the reporter's S2: the rubric scopes S2 a11y to traps and unreachable controls, and nothing here is unreachable — this is a wrong static label, which the rubric files under S3. It is at the top of the S3 band, though, because it mis-states the game result for one whole user class across all six non-victory endings, and the correction exists only in text they cannot see.

**Verifier:** Reproduced exactly as written, first attempt, real Chrome 151 against the live Vercel target. Co-op loss (2 players, mistake limit 1, one deliberately wrong gap) reaches #win[data-outcome=\"loss\"] with visible eyebrow \"GAME OVER\" and name \"So close\"; document.activeElement is H1#win-title, and Chrome's own computed accessible name via CDP Accessibility.getPartialAXTree is \"Winner: So close\" (Playwright's independent name computation agrees: getByRole('heading',{name:'Winner: So close',exact:true}) matches 1, 'Game over: So close' matches 0). The parent section, aria-labelledby=win-title, is likewise named \"Winner: So close\". A second run confirmed the reporter's other quoted case verbatim: classic 4-player End-game-early yields eyebrow \"LEVEL WHEN IT ENDED\" and heading name \"Winner: Player 1, Player 2, Player 3 & Player 4\". Source backs the generalization to all seven endings: index.html:1052 hardcodes <span class=\"sr-only\">Winner: </span> inside #win-title while renderWin() (ui.js:2579-2648) varies only #win-eyebrow, and focusHeading() (ui.js:922) always focuses #win-title. Not by-design: the brief's by-design list does not cover it, and the HTML comment shows the prefix was intended to mirror the eyebrow, which is dynamic while the prefix is static. One part of the finding IS overstated and I am correcting it rather than refuting on it: the rationale's \"the correction exists only in text they cannot see\" is false. <p id=\"win-eyebrow\">GAME OVER</p> is ordinary non-hidden text read in DOM order immediately before the heading, and announce() writes \"Game over: So close. 1 mistakes reached on 1 card.\" into #live-status (role=status, aria-live=polite) in the same render — I read both live. So a screen-reader user gets the correct outcome from two other channels, and the wrong word is isolated only under heading-jump (H key) navigation or when the region name is spoken. Severity therefore stays S3 but sits at the BOTTOM of the band, not the top as claimed: the rubric puts \"misleading copy\" and \"minor a11y (missing label)\" in S3, and nothing here is a trap or an unreachable control, so S2 is correctly excluded; calling a factually wrong announced game result mere \"wording polish\" would not be defensible either, so S4 is too low. Evidence: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-win-title-hardcoded-winner-prefix-1/ (repro.mjs, repro-endearly.mjs, 03-win-loss.png, 04-end-early.png). Zero console errors or pageerrors in both runs.

**Reported by:** a11y:End-of-game heading always announces "Winner:" — a co-op loss is announced to screen readers as "Winner: So close"

**Evidence:** `round-2-evidence/S3-win-title-hardcoded-winner-prefix--01-setup.png`

### 26. [S3 Minor · 3 pts] The winner's name is clipped off both edges of the win screen at 320, 375 and 393 px

**id:** `winner-name-clipped-on-phone-widths`

**Expected:** The winner's name fits and is fully readable, as the pass screen already achieves with the same name.

**Actual:** #win-title / #win-player-name renders wider than the viewport and is clipped with no horizontal scroll to recover it: 320x568 left=-13 right=333, 375x667 left=-15 right=390, 393x852 left=-9 right=402. It fits only from 428px up.

**Repro:**
1. Open /index.html?debug=1&seed=5 at 393x852
2. New game -> remove rows down to 2 players -> name player 1 'Bartholomewxxxxx' (16 chars, exactly the app's own maxlength) and player 2 'Wilhelmina Grace' -> 'Skip photo' each -> Shuffle & start
3. Play until player 1 reaches the target and the win screen appears

**Why this severity:** S3 per 'overflow that doesn't hide controls' — the buttons below remain usable, only the name is cut. Strengthened by the fact that the input itself permits exactly this length and the pass screen scales the identical name correctly, so the win screen is the outlier; reproduced in two independent runs including at a native (non-resized) 393px viewport.

**Verifier:** I tried to refute this and could not. Ran the reported repro verbatim (live site, ?debug=1&seed=5, New game -> down to 2 rows -> p1 "Bartholomewxxxxx" (16 = the input's own maxlength, confirmed maxlength="16"), p2 "Wilhelmina Grace", one Skip-photo tap each, Shuffle & start, played to a real win) in three separate fresh Chrome 151 sessions at NATIVE, never-resized viewports. Numbers land on the reported values to the rounding digit:

- 393x852: #win-title / #win-player-name left=-9.4 right=402.4 (width 411.8 in a 393 viewport), 9px cut off each edge. Reported: -9 / 402.
- 375x667: left=-14.7 right=389.7, 15px each edge. Reported: -15 / 390.
- 320x568: left=-12.5 right=332.6, 13px each edge. Reported: -13 / 333.

Refutation attempts that failed:
1. "Measured mid-animation / before a fit routine." No fit routine exists — ui.js has no font-size/scrollWidth fitting anywhere, and remeasuring 4s later after confetti settled and document.fonts.ready gave byte-identical rects.
2. "It's an unclipped overflow you can scroll to." No. It is really clipped: main#app carries overflow-x:clip and body carries overflow-x:hidden, documentElement.scrollWidth == clientWidth at all three widths, and window.scrollTo(400,0) leaves scrollX at 0. Screenshots (393-03-win.png, 320-03-win.png) show the leading "B" stem and the trailing glyph physically sliced.
3. "Only happens when Playwright resizes the window." No — every run used a viewport fixed at newContext time and never called setViewportSize.
4. "The pass-screen contrast claim is invented." It holds: same name, same 32px padding, but .pass__name is clamp(32px,10vw,40px) vs .win__name clamp(34px,11vw,42px). Measured pass cut = 0 across all 48 name x width combinations I swept; win is the only outlier. Root cause is exactly that ~7% larger clamp against an unbreakable token (white-space:normal, overflow-wrap:normal, so a 16-char single word has no break opportunity).

Two honest corrections to the report, neither material:
- "It fits only from 428px up" is slightly overstated. My sweep shows the reported name already fits at 412px (Pixel width, left=0.1/right=411.9). The true threshold for that name is ~412px, not 428px. The three phone widths the finding actually names all reproduce.
- It needs a wide-glyph 15-16 char name. Of 8 names swept, only "Bartholomewxxxxx" (16) and the real surname "Balasubramanian" (15) clipped; "Konstantinopoul" (15, narrower glyphs), "Christopherson" (14), and "Christopher John" (16 with a space, so it wraps) all fit. So it is an edge-of-the-input case, not something most rosters hit — but the app's own maxlength permits it, so it is reachable by typing.

Severity S3 per the rubric, unchanged. The rubric's S3 bullet is literally "overflow that doesn't hide controls," and I verified no control is affected: at 320 #btn-win-home measured left=29 right=291 fully on-screen and tappable, "Play again" likewise, zero console errors and zero pageerrors in every run. Not S2 — nothing is hidden, no feature dead-ends. Not S4 — this is the game's climax screen with the winner's name sliced off both edges, which is past "spacing/wording polish."

Evidence (absolute paths):
/Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-winner-name-clipped-on-phone-widths-1/
  verify.mjs, sweep-names.mjs (scripts; run from repo root)
  result-393.json, result-375.json, result-320.json (full-game repro measurements)
  sweep-names.json (8 names x 6 widths, win + pass rects)
  393-03-win.png, 320-03-win.png (full play-to-target win screens)
  sweep-375-Bartholo.png, sweep-393-Balasubr.png (clipping with a real surname)

**Reported by:** responsive:The winner's name is clipped off both edges of the win screen at 320, 375 and 393 px wide

**Evidence:** `round-2-evidence/S3-winner-name-clipped-on-phone-widths--320-01-setup.png`

### 27. [S4 Nit · 1 pts] Player initials on two of the eight seat colours miss WCAG AA (4.20:1 and 4.35:1)

**id:** `avatar-initial-contrast-two-seats`

**Expected:** The initial — the only identifier when the photo is skipped, which is the app's own fast path — meets AA 4.5:1 on every seat colour.

**Actual:** Seat 4 white on rgb(28,126,214) = 4.20:1 and seat 1 white on rgb(12,133,153) = 4.35:1; both are 16px bold, below the 18.66px bold threshold for WCAG large text, so 4.5:1 applies. The other six seats pass (4.48-6.88).

**Repro:**
1. Open /index.html -> New game -> tap '+ Add player' four times to see all eight seat colours
2. Measure each .avatar__initial against its avatar background (16px, weight 700)

**Why this severity:** S4 rather than the S3 contrast band: the shortfall is marginal (4.20 and 4.35 against 4.5), it affects two of eight seats, and the initial is a secondary identifier next to a name. Kept because the measurement is objective and a small token tweak fixes it; the verdict-pill contrast cluster is the one that deserves S3.

**Verifier:** Reproduced exactly as filed, first attempt, in my own real-Chrome session against the live Vercel target (393x852, fresh localStorage). New game -> '+ Add player' x4 gives 8 rows (default 4, MAX_PLAYERS=8, button disables). getComputedStyle on all eight .avatar__initial: seat 1 white on rgb(12,133,153) = 4.347, seat 4 white on rgb(28,126,214) = 4.196, other six 4.482-6.878 — matching the report's "4.48-6.88" exactly. All are 16px / weight 700 (avatar--lg 40px x 0.4), backgroundImage none, so under the 18.66px bold large-text threshold and 4.5:1 applies.

I tried three refutations and all failed. (1) "Computed style isn't what's painted": canvas-sampled the actual avatar screenshots — seat 4 painted glyph 252,252,252 on 28,124,211 = 4.20; seat 1 = 4.38. Same numbers. (2) "seatInk picks a dark ink for light seats so white isn't really used": it does for seats 2/5/6/7/8 (#241c15), but for these two hues white scores higher than dark ink, so white is chosen and 4.2 is the ceiling — engine.js:213 concedes it in a comment ("puts every seat at 4.2:1 or better"). Contrast is not on the brief's by-design list and the rubric names weak contrast as reportable, so this is not BY_DESIGN. (3) "The initial is decorative because the name sits beside it" — this was the reporter's strongest S4 justification and it is factually wrong: on the play screen the same initials render at 12px in the scoreboard strip with only a card count beside them and no name at all, so for seats 1 and 4 the sub-AA glyph is the sole identifier.

Severity: holding the proposed S4 rather than upgrading. The rubric's letter would permit S3 ("minor a11y ... weak contrast") and I disproved one mitigation, but the other two stand — a 0.30 shortfall on a still-legible 4.2:1, affecting 2 of 8 seats. Not inflating a threshold miss into a perceptible defect.

Evidence: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-avatar-initial-contrast-two-seats-1/ (verify.mjs, pixels.mjs, context.mjs, verify-log.txt, pixels-log.txt, context-log.txt, a-01-roster-8.png, a-avatar-seat1..8.png, c-02-play.png). No console errors or pageerrors in any run.

**Reported by:** a11y:Player initials on two of the eight seat colours fail WCAG AA (4.20:1 and 4.35:1)

**Evidence:** `round-2-evidence/S4-avatar-initial-contrast-two-seats--a-01-roster-8.png`

### 28. [S4 Nit · 1 pts] Co-op game-over line reads '1 mistakes reached on 1 card.' when the mistake limit is 1

**id:** `coop-mistake-count-not-pluralised`

**Expected:** '1 mistake reached on 1 card.' — the same plural() helper the app already uses for the card count on the same line.

**Actual:** '1 mistakes reached on 1 card.' The card half is pluralised, the mistake half interpolates state.mistakeLimit raw (ui.js:2623). The same string is pushed to the aria-live region, so screen readers announce it too.

**Repro:**
1. Open /index.html -> New game -> remove Player 4 and Player 3 -> 'Skip photo' once per row
2. Pick Co-op, tap 'Fewer mistakes allowed' until the limit reads 1
3. Shuffle & start -> Start the turn -> vinyl -> tap a clearly wrong gap -> Place here -> Next player
4. Read the summary line under 'So close'

**Why this severity:** Three testers in three areas hit the identical string on the identical screen with the identical trigger (mistake limit 1) — one defect, one line of code. S4 wording nit; it only appears at the stepper's minimum, and 'Lose after 1' is a plausible quick-round setting, which is why it survives rather than being dropped.

**Verifier:** Reproduced verbatim on the live target in real Google Chrome (script: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-coop-mistake-count-not-pluralised-1/repro.mjs; screenshots 01-setup.png, 02-reveal.png, 03-win.png in that dir). Exact steps as reported: New game -> removed Player 4 and Player 3 (2 rows left) -> one 'Skip photo' per row -> Co-op -> tapped 'Fewer mistakes allowed' until the stepper read 'Lose after - 1 +' -> Shuffle & start -> #btn-pass-continue -> #btn-play-song -> computed wrong gap from __timeline.state -> Place here -> Next player. Result state was {"reason":"mistake-limit",...} with mistakes 1/1, and #win-summary read exactly "1 mistakes reached on 1 card." — visible on screen in the screenshot. Ran twice (SEED=31 and SEED=904); identical string both times, zero console/pageerror output. The aria-live claim also holds: #live-status (role="status", aria-live="polite") contained "Game over: So close. 1 mistakes reached on 1 card.", pushed by announce() at ui.js:2651. Source confirmed at public/music/ui.js:2623 — `${state.mistakeLimit} mistakes reached on ${plural(cards, "card")}.` — the plural() helper is applied to the card count two tokens away on the same line but not to the mistake count, and MIN_MISTAKES = 1 (ui.js:127) makes limit 1 a reachable stepper setting, so the reporter's scope claim ("only at the stepper's minimum") is exactly right rather than understated. Refutation attempts failed: nothing on the brief's by-design list (audio-requires-tap, offline previews, module warnings, local-only photos, LAN QR, non-charging buy-in) touches copy, and no step in the repro was materially different from what was reported. Severity holds at S4 and does not warrant an upgrade: S3 covers "misleading copy", but "1 mistakes" is a grammar slip with unambiguous meaning — no control is hidden, no game-rule outcome is wrong, no data is lost. That is squarely S4 "polish: wording, inconsistency."

**Reported by:** a11y:Co-op loss screen reads "1 mistakes reached on 1 card." — the mistake count is not pluralised, coop:Co-op loss screen says "1 mistakes reached on 1 card." when the mistake limit is 1, setup-options:Co-op game-over line reads '1 mistakes reached on 1 card.' when the mistake limit is set to 1

**Evidence:** `round-2-evidence/S4-coop-mistake-count-not-pluralised--01-setup.png`

### 29. [S4 Nit · 1 pts] Co-op play screen says 'you have 2' about the shared token pool

**id:** `coop-you-have-wording-shared-pool`

**Expected:** Shared-pool wording, matching every other co-op surface (the same screen's token row is aria-labelled 'Tokens: 2 of 6', the reveal credits awards to 'Shared pool', the pass screen says 'Shared tokens').

**Actual:** 'Needs 3 tokens (you have 2)' — second person, as if the active player owned a personal pile. Persists all game, including on turn 3 with a different active player.

**Repro:**
1. Open /index.html?debug=1&seed=601 with localStorage cleared
2. New game -> tap the Co-op mode tile -> reduce to 3 players -> 'Skip photo' once per row
3. Shuffle & start, continue to the play screen, and read the line under 'buy a card · 3 tokens'

**Why this severity:** S4 wording inconsistency: the number is correct and every neighbouring surface uses shared-pool language, so this is one string out of step rather than a misbehaviour. Distinct from the co-op scoreboard cluster, which shows a wrong-looking total rather than wrong phrasing.

**Verifier:** Reproduced verbatim on the live site in real Chrome 151 (393x852) using the exact reported steps: ?debug=1&seed=601 with localStorage cleared, New game -> Co-op tile -> reduce to 3 players -> one skip-photo click per row -> Shuffle & start -> pass continue. The co-op play screen renders 'Needs 3 tokens (you have 2)' immediately under 'buy a card · 3 tokens', above the SHARED TIMELINE, on turn 1 (screenshot 04-play.png) and still on turn 3 with a different active player (08-play-turn3.png; state showed mode=coop, activeIndex=2, Player 3, sharedTokens=2), so the persistence claim holds. Zero console errors or pageerrors. My three refutation attempts all failed. (1) 'The neighbouring surfaces are not really shared-pool wording' is false: index.html:779 carries aria-label="Shared tokens" on the co-op pass-screen teambox, ui.js:2399/2411/2424 use state.mode === 'coop' ? 'Shared pool' : nameOf(...) for award/outcome/challenge credit, and ui.js:2068 sets the play token row to the neutral 'Tokens: 2 of 6' (I read that exact aria-label off the live DOM). (2) The brief's by-design list says nothing about token wording and no game rule covers it. (3) The steps were not materially different — the reported repro worked first try, unmodified. Root cause is one mode-blind template at engine.js:1338, `Needs ${BUY_COST} tokens (you have ${tokens})`, where tokensFor() returns the shared pool in co-op; the same string is correct in classic. One honest dent in the finding's rationale that does not change the verdict: it is not the ONLY second-person co-op string — ui.js:2259 renders 'Correct. The card is yours.' on the co-op reveal about a card that joins the shared timeline (captured in reveal.txt), so it is two strings out of step, not one. Severity stays S4 and cannot go lower: the displayed number is correct, nothing is hidden, blocked, or miscomputed, and the rubric places 'wording, inconsistency' at S4. No hard evidence supports an upgrade. Evidence: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-coop-you-have-wording-shared-pool-1/ (repro.mjs, 04-play.png, 08-play-turn3.png, turn1-play.txt, turn3-play.txt, pass.txt, reveal.txt).

**Reported by:** coop:Co-op play screen says "you have 2" about the shared token pool

**Evidence:** `round-2-evidence/S4-coop-you-have-wording-shared-pool--01-setup-coop.png`

### 30. [S4 Nit · 1 pts] The vinyl countdown flips from '30s' to '1s' the moment you tap play in Spotify/Apple/YouTube mode

**id:** `countdown-shows-1s-in-link-mode`

**Expected:** The countdown keeps reading 30s or disappears — this mode plays no in-app clip, so it should not advertise a one-second one.

**Actual:** The disc immediately shows '1s' under the play glyph, next to 'Open Spotify to play this card.', and stays there. Does not happen in preview mode even when the preview fails (with the iTunes host blocked the disc still reads '30s'), pointing at paintAudio() measuring the silent unlock buffer from player.unlock().

**Repro:**
1. Fresh page: open /index.html?debug=1&seed=11 with localStorage cleared
2. New game -> 'Skip photo' once per row -> Shuffle & start -> continue past the pass screen (the disc reads '30s')
3. menu -> 'Play songs with' -> 'Spotify — opens on the scanning phone' -> done (still '30s')
4. Tap the vinyl once

**Why this severity:** S4 cosmetic, as the reporter says — nothing is blocked, and it only appears in a mode that is already broken by the QR/playback-source cluster. Kept separate because it has its own cause (paintAudio reading the unlock buffer) that would survive a fix to the QR.

**Verifier:** I tried to refute this and could not — it reproduced first try, on the exact steps as written, and both of the reporter's controls held.

Session: real Google Chrome (`channel: 'chrome'`), 393x852, `canPlayType('audio/mp4; codecs="mp4a.40.2")` = "probably", live site https://music-timeline-walksalots-projects.vercel.app/index.html?debug=1&seed=11, localStorage cleared, 4 rows skipped once each, Shuffle & start, `#btn-pass-continue`, menu -> `#opt-playback-source` -> spotify -> Done. Zero pageerrors, zero console errors.

Measured (`scratch/qa/round-2/verify-countdown-shows-1s-in-link-mode-1/result.json`):
- Before the tap, Spotify already selected: `#countdown-value` = "30", disc = "30s", `--ring-progress` = 1. Screenshot `07-play-spotify-before-tap.png`.
- 400 ms after tapping `#btn-play-song`: `#countdown-value` = "1", disc renders "1s" under the play triangle with "Open Spotify to play this card." beneath it. Screenshot `08-play-spotify-after-tap-400ms.png` shows it plainly. Still "1" at t+3 s and t+8 s.

Root cause is exactly what the reporter guessed, and I have the number: at that moment `document.querySelector('audio').duration === 0.01` and `src` is `data:audio/wav;base64,UklGRnQAAABXQVZFZm10...` — the 10 ms `SILENCE` buffer that `player.unlock()` installs (public/music/audio.js ~line 920). `paintAudio()` (public/music/ui.js:1684) does `duration = p.duration > 0 ? p.duration : PREVIEW_SECONDS`, so 0.01 wins over the 30 s default and `Math.ceil(0.01)` prints 1. In link mode `toggleAudio()` (ui.js:1565-1574) calls `p.unlock()` and then returns early, so nothing ever replaces that src.

Adversarial controls (`control-log.txt`), 100 ms sampling for 6 s each:
- preview, normal: 30,30,...,29,...,24 — never shows "1". Real preview loaded, `duration` 29.98, `paused` false.
- preview, audio-ssl.itunes.apple.com aborted at the route level: stays "30" for the full 6 s with honest copy "That preview would not play here. Use the links below, or skip this card." The reporter's differential is real.
- YouTube: 30,30,1,1,1... sticks. Apple Music: 30,1,1,1... sticks. So all three link modes, not just Spotify.

Not covered by the brief's by-design list (that list covers tap-to-play, offline, module warnings, photos, LAN QR, and the Venmo deeplink — none of them this).

Severity stays S4. The reporter self-assigned the rubric's floor and it is the right tier: nothing is blocked, the ring itself stays full (`--ring-progress` = 1, so there is no one-second drain animation), the button label still reads "Play song", and the honest instruction "Open Spotify to play this card." is right there. It is a wrong numeral on a disc. One fairness note for the adjudicator, not a downgrade: it only ever appears in a mode the QR/playback-source cluster already breaks, so a user reaching it has bigger problems — but the cause is independent (`paintAudio` reading the unlock buffer) and would survive a QR fix, so keeping it separate is correct.

Evidence, all absolute:
/Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-countdown-shows-1s-in-link-mode-1/repro.mjs
/Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-countdown-shows-1s-in-link-mode-1/control.mjs
/Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-countdown-shows-1s-in-link-mode-1/result.json
/Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-countdown-shows-1s-in-link-mode-1/control-log.txt
/Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-countdown-shows-1s-in-link-mode-1/07-play-spotify-before-tap.png (30s)
/Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-countdown-shows-1s-in-link-mode-1/08-play-spotify-after-tap-400ms.png (1s)
/Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-countdown-shows-1s-in-link-mode-1/ctl-preview-itunes-blocked.png

**Reported by:** qr-listen:The vinyl countdown flips from '30s' to '1s' the moment you tap play in Spotify/Apple/YouTube mode

**Evidence:** `round-2-evidence/S4-countdown-shows-1s-in-link-mode--01-home.png`

### 31. [S4 Nit · 1 pts] manifest.json declares a near-black theme/background for a cream light-themed app, and no apple-touch-icon is provided

**id:** `manifest-theme-mismatch-no-touch-icon`

**Expected:** Install metadata matches the app it installs: a light theme/background, plus an iOS home-screen icon.

**Actual:** The manifest claims a near-black theme and splash background, disagreeing with the page's own theme-color; iOS 'Add to Home Screen' has no apple-touch-icon to use. The manifest and icon.svg themselves load fine and the SW precaches 27 shell entries with working offline reload.

**Repro:**
1. curl /manifest.json — theme_color and background_color are both #0b0b12
2. View index.html's head — <meta name="theme-color" content="#fff8e7"> and <meta name="color-scheme" content="light">; the shipped UI is cream/paper
3. The head has apple-mobile-web-app-* meta and <link rel="icon" type="image/svg+xml"> but no <link rel="apple-touch-icon">

**Why this severity:** S4: metadata-only, nothing in the running app is affected, and the reporter is honest that the black-splash consequence is inferred from metadata rather than observed (they could not install the PWA on that box). The missing apple-touch-icon is verifiable from the served HTML regardless of that limit.

**Verifier:** I set out to refute this and could not — every claim is literally true on the live site, and each refutation angle I tried died on evidence.

Reproduced in real Google Chrome 151 (canPlayType AAC = "probably"), viewport 393x852, against https://music-timeline-walksalots-projects.vercel.app. Scripts: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-manifest-theme-mismatch-no-touch-icon-1/verify.mjs and verify2.mjs.

FACTS, all three repro steps verbatim:
1. /manifest.json (HTTP 200) — "theme_color": "#0b0b12" and "background_color": "#0b0b12". icons[] contains only ./icon.svg twice (any + maskable), no raster.
2. Live post-JS DOM of index.html — exactly one <meta name="theme-color" content="#fff8e7">, <meta name="color-scheme" content="light">, and body computed background is rgb(236,227,205) (cream). Screenshot 01-home-light.png is unambiguously cream/paper.
3. Zero apple-touch-icon links. Not in the served bytes (grep -c = 0), and 0 in the live DOM sampled on all five screens (home, setup, pass, play, play-after-draw) after JS settled — so nothing injects one at runtime. apple-mobile-web-app-capable/-title/-status-bar-style and <link rel="icon" type="image/svg+xml"> are present as reported.

REFUTATION ATTEMPTS THAT FAILED:
- "The manifest matches a dark variant of the app." No dark variant exists. Under emulated prefers-color-scheme: dark (matchMedia confirms matches=true), bodyBg is still rgb(236,227,205) and theme-color is still #fff8e7.
- "Chrome ignores or rejects the manifest, so the mismatch is inert." No. CDP Page.getAppManifest returns errors: [] and Chrome's own computed values are backgroundColor rgba(11,11,18,1), themeColor rgba(11,11,18,1), display kStandalone. The browser really will use near-black for the standalone splash.
- "There's a root-path fallback icon." /apple-touch-icon.png and /apple-touch-icon-precomposed.png both 404; /icon.png 404. Only /icon.svg (200) exists.
- "The document meta overrides the manifest, so nothing is affected." Only partly, and it does not rescue the finding: the document's meta theme-color does win for the app-window/toolbar chrome once loaded, but background_color has no document-level equivalent (confirmed no meta[name=background-color]) and is used solely for the pre-paint splash. The near-black-splash-into-cream-app flash stands as a real consequence.
- "Out of scope because hard-rule-1 says UI-only." Rule 1 constrains how you drive the app, not what is inspectable; the manifest is fetched by the browser as part of loading the page. Not a valid refutation.
- By-design list checked: it covers audio-needs-a-tap, offline previews, module warnings, on-device photos, LAN QR, and the non-charging buy-in. Install metadata is not on it.

The reporter's honest side-notes also check out: SW cache "music-timeline-v8-qa1" holds exactly 27 entries including manifest.json and icon.svg, with an active controller and no console/pageerror output at all.

One imprecision worth noting, not material: "iOS has no apple-touch-icon to use" is right in outcome but slightly off in mechanism — iOS 16.4+ Safari does read manifest icons, but the only icon offered is SVG (Chrome parsed its sizes as 0x0) and Safari needs a raster PNG for the home screen, so iOS still ends up with no usable icon and falls back to a page screenshot. Same user-visible result.

SEVERITY: S4 is correct and already the rubric floor ("polish: ... inconsistency"). Nothing in the running game is affected — the walkthrough played normally with zero errors. I considered S3 ("visual defect") since a black splash flashing to a cream app and a missing home-screen icon are both things a person would see, but upgrades need hard evidence and I did not observe an actual installed splash (I have Chrome's computed color, not a rendered install). The reporter flagged that same limit themselves. Holding at S4.

Evidence: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-manifest-theme-mismatch-no-touch-icon-1/ (01-home-light.png, 02-home-darkmode-emulated.png, screen-setup.png, screen-pass.png, screen-play.png, screen-play-after-draw.png, verify.mjs, verify2.mjs).

**Reported by:** first-run:manifest.json describes a dark app (theme/background #0b0b12) that the cream light-themed page contradicts, and no apple-touch-icon is provided

**Evidence:** `round-2-evidence/S4-manifest-theme-mismatch-no-touch-icon--01-home-light.png`

### 32. [S4 Nit · 1 pts] Player names are silently cut at 16 characters with no limit shown anywhere

**id:** `name-truncated-at-16-silently`

**Expected:** Either the name fits, or the UI says how long a name may be (counter or hint).

**Actual:** The field stops at 16 (maxlength="16", no hint anywhere) and the row reads 'Grandma Josephin' — the name used on the pass screen, player rail, scoreboard and win screen all night. Emoji cost two characters each, so emoji nicknames are cut shorter still.

**Repro:**
1. Fresh profile, New game
2. In row 1 type 'Grandma Josephine' (17 characters)

**Why this severity:** S4: an enforced limit with no affordance is a polish/wording gap, not a broken feature — the name is visibly truncated as it is typed and can be shortened deliberately. Note the interaction with the win-screen clipping cluster: 16 characters is short enough that the app permits names its own win screen cannot render.

**Verifier:** Reproduced on the first attempt against the live site (https://music-timeline-walksalots-projects.vercel.app/index.html?debug=1) in real Google Chrome (canPlayType(aac)="probably"), 393x852, UI-only interaction. Typing "Grandma Josephine" (17 chars) into row 1 leaves "Grandma Josephin" (16). Input attributes: maxLength=16, maxlength="16", title=null, aria-describedby=null, no pattern, placeholder only "Name". Every sub-claim survived adversarial checking: (1) "no hint anywhere" — a leaf-text regex scan for any character/limit copy found zero hits on home, on the setup screen, and across the entire 3,384-char "How to play" screen, and no hint appears after the cap is hit; a scoped grep of index.html/ui.js/listen.* also found no such copy; (2) the emoji sub-claim is exact — typing ten U+1F383 leaves eight (16 UTF-16 units, 8 graphemes), so emoji do cost two each; (3) propagation is real — the truncated name appears on the pass screen ("PASS THE PHONE TO Grandma Josephin"), in STANDINGS, on the play-screen rail ("Now playing: Grandma Josephin"), and in window.__timeline.state.players[0].name, which is the same source ui.js uses for the win title. Variations I tried in an attempt to refute: real clipboard Meta+V paste of the full 17-char name (also truncated to 16, no hint), and locator.fill() (same). Not covered by the brief's by-design list. No console errors or pageerrors in either run. The strongest refutation angle — that maxlength is universal web practice and the user does see typing stop — is one the finding itself concedes in its rationale, and it does not make the claim false: the limit is stated nowhere. Severity holds at the proposed S4 and no higher: nothing is hidden, no control is unreachable, no rule outcome or money math is wrong, and no data is lost — it is a polish/affordance gap in the rubric's S4 sense. No basis to downgrade further, since S4 is the lowest tier. Evidence: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-name-truncated-at-16-silently-1/02-typed-17char.png (row reads "Grandma Josephin", helper copy under the roster is about photos only), 11-after-paste.png, 12-play-screen.png, 10-rules.png; scripts repro.mjs and variations.mjs in the same directory.

**Reported by:** roster:Player names are silently cut at 16 characters with no limit shown anywhere

**Evidence:** `round-2-evidence/S4-name-truncated-at-16-silently--00-home.png`

### 33. [S4 Nit · 1 pts] Before the song is drawn, the play screen shows the 'Scan to play it on your own phone' heading and body copy with no QR beneath it

**id:** `qr-caption-orphaned-before-draw`

**Expected:** Either the whole scan block stays hidden until there is a card to scan, or a placeholder appears with the caption.

**Actual:** .qr__frame is hidden (#qr-code measures [0,0,0,0] with empty innerHTML) but the caption 'Scan to play it on your own phone' and 'The scanned page shows a play button and nothing else. No year, no title.' still render as an orphan heading. After tapping play the QR appears and the caption moves beneath it.

**Repro:**
1. Open /index.html?debug=1&seed=41 at 820x1180 (iPad portrait, where the whole play screen is above the fold)
2. New game -> 'Skip photo' once per row -> Shuffle & start -> Continue
3. Look below the vinyl, before tapping play

**Why this severity:** S4 and the reporter agrees it is cosmetic with nothing blocked. Most visible on tablets where the whole play screen fits above the fold, which is a less common surface for this app — but it is a straightforward measured DOM state, not a judgement call.

**Verifier:** Reproduced on the first attempt with the exact reported steps (820x1180, ?debug=1&seed=41, New game -> skip-photo once per row -> Shuffle & start -> Continue, inspect before tapping the vinyl). Every measured claim is accurate: .qr__frame carries the hidden attr with display:none and rect [0,0,0,0]; #qr-code has innerHTML.length 0 and rect [0,0,0,0]; #qr-caption ("Scan to play it on your own phone") and .qr__sub ("The scanned page shows a play button and nothing else. No year, no title.") are both visible, caption top=524. documentElement.scrollHeight == clientHeight == 1180, so the orphaned caption is genuinely on screen under the vinyl with no code beneath it. After tapping play the QR paints (10,175-char SVG, rect [312,537,196,196]) and the caption moves to top=758, i.e. beneath it, exactly as reported. No console or page errors. Screenshots at .../verify-qr-caption-orphaned-before-draw-1/820x1180-03-play-before-draw.png and -04-play-after-draw.png. Three refutation attempts all failed. (1) Scoping: the finding says this is "most visible on tablets ... a less common surface"; at 393x852 the caption is ALSO fully in the viewport before the draw (captionInViewport true, top 524 of 852) with the sub line clipped mid-sentence by the sticky timeline strip, so the report under-states its reach rather than exaggerating it. (2) By design: the brief's by-design list covers the QR's LAN target and the untestability of phone-scanning, not this pre-draw state, so BY_DESIGN does not apply by the stated definition. ui.js paintQr() does document the "block stays, frame goes" decision deliberately, but its own stated premise is not implemented - the comment says "the caption explains why the code is not here yet," while the shipped caption and sub are byte-identical before and after the draw and never mention the code's absence. Intent unimplemented is a polish gap, not a settled design. (3) a11y upgrade: refuted. ariaSnapshot() of #qr-block before the draw is region "Scan to play it on your own phone" with two paragraphs and NO img node - the role="img" QR is correctly excluded because its ancestor .qr__frame is display:none - so there is no phantom "QR code" announcement to justify S3. Severity holds at the proposed S4 with no upgrade: nothing is hidden, no control is unreachable, no game-rule or money outcome is affected, and the state self-heals on the very next tap; the screen's primary instruction directly above the caption reads "Tap play to draw the mystery song," so no user is led into a wrong action, which keeps it out of S3 "misleading copy" and squarely in S4 wording/inconsistency polish. Evidence: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-qr-caption-orphaned-before-draw-1/ (verify.mjs, a11yqr.mjs, log-820x1180.txt, log-393x852.txt, PNGs).

**Reported by:** responsive:Before the song is drawn, the play screen shows the 'Scan to play it on your own phone' heading and its explanation with no QR code under it

**Evidence:** `round-2-evidence/S4-qr-caption-orphaned-before-draw--393x852-00-home.png`

### 34. [S4 Nit · 1 pts] Resuming into a reveal loses the album artwork — the cover is replaced by the generic music-note placeholder

**id:** `resume-into-reveal-loses-artwork`

**Expected:** The reveal after resume looks like the reveal before it, artwork included.

**Actual:** Everything else is identical (year, title, artist, verdict, mini timeline, token rail) but the cover thumbnail is replaced by the pink music-note placeholder — artwork is fetched only during playback, and resume skips that.

**Repro:**
1. Fresh page (localStorage cleared): New game -> 'Skip photo' each row -> Shuffle & start -> continue past the pass screen
2. Tap the vinyl, tap a gap, tap 'Place here' — the reveal shows year, title, artist and the album cover
3. Reload the page
4. Home -> 'Resume game' — the same reveal returns

**Why this severity:** S4 polish: purely cosmetic, no information lost (year/title/artist all survive) and the next turn repaints normally. Worth keeping because it lands at the moment players are specifically checking that a reload did not break their game.

**Verifier:** I tried to refute this and could not. Two independent fresh runs (real Google Chrome 151, channel=chrome, 393x852, localStorage cleared, `canPlayType('audio/mp4; codecs="mp4a.40.2")` = "probably", zero console/pageerror output) reproduced it on the first attempt using the reported steps verbatim — no variation needed.

Run 1 ("It Takes Two", 1988): before reload the reveal showed `#reveal-artwork` with src `https://is1-ssl.mzstatic.com/.../dj.pcbpnexk.jpg/600x600bb.jpg`, visible, naturalWidth 600, placeholder hidden. After reload -> Home -> Resume game, the SAME reveal returned with `artSrc="(none)"`, `artVisible=false`, `naturalWidth=0`, `#reveal-art-placeholder` (the pink music-note glyph) visible. Run 2 ("Kill This Love", 2019) gave the identical before/after pair.

The three refutation angles I tested all failed:
1. "Screenshot was just too early / artwork loads lazily." No — I re-sampled after an additional 6s of idle; artSrc stayed "(none)" and the placeholder stayed visible. It never arrives.
2. "Network hiccup." No — zero `requestfailed` events, and the one mzstatic response in the session was a 200. It is not a fetch failure; no artwork request is ever issued after resume.
3. "Exaggerated / other things break too." No, and the report is precisely calibrated: my field-by-field diff of the reveal before vs. after resume differs on artwork fields ONLY. Year, title, artist, verdict banner, phase, player attribution all identical.

The stated mechanism is correct: `ui.js` line 2308 reads `view.audio.resolved.artworkUrl`, which is in-memory view state (reset to null at init) and is populated only by audio resolution during playback. `artworkUrl` appears nowhere in `storage.js` or the persisted state, so resume has nothing to paint. The rationale's self-heal claim also checks out — I advanced to the next turn after resuming and artwork painted normally (naturalWidth 600).

Not covered by the brief's by-design list (that list covers autoplay-requires-tap, offline previews, node warnings, photos-stay-local, LAN QR, and the non-charging buy-in — none apply).

Severity: keeping the reporter's S4 rather than upgrading. Cold rubric reading is genuinely borderline — S3 names "visual defect" — but no information is lost (year/title/artist/verdict all survive), the game is unaffected, and the very next turn repaints correctly, which puts it in S4's "inconsistency/polish" bucket. An upgrade would need evidence of hidden controls or lost information, and there is none. Evidence: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-resume-into-reveal-loses-artwork-1/ (01-repro.mjs, 02-selfheal.mjs, 03-reveal-BEFORE-reload.png, 06-reveal-AFTER-resume-plus6s.png, R2-A/B/C-*.png).

**Reported by:** first-run:Resuming into a reveal loses the album artwork - the cover is replaced by the generic music-note placeholder

**Evidence:** `round-2-evidence/S4-resume-into-reveal-loses-artwork--00-setup.png`

### 35. [S4 Nit · 1 pts] Cold first visit transfers ~879 KB for ~492 KB of content because the SW install refetches with cache:'reload'

**id:** `sw-precache-doubles-cold-load`

**Expected:** The precache reuses the HTTP-cache entries the page just filled, so a cold visit costs roughly the unique shell size (~492 KB).

**Actual:** ~879,033 bytes on a cold visit: 17 URLs downloaded twice (379,128 duplicated bytes — previews.json 128,893 B twice, ui.js 41,205 B, deck.js 37,899 B, four woff2s, engine.js, app.css), plus './' and './index.html' both precached so the 24,380-byte document is fetched twice inside install. install uses fetch(path,{cache:'reload'}) justified for a LAN dev server, but Vercel serves everything must-revalidate, so the flag buys nothing.

**Repro:**
1. Fresh browser profile / cleared site data (no SW, no HTTP cache)
2. Load /index.html and wait ~6s for the SW install to finish
3. Compare the page's resource timing (19 requests, ~401 KB) with the service worker's (27 entries, ~500 KB, none from the HTTP cache)
4. Repro script: node scratch/qa/round-2/perf-network/02-sw-precache-bytes.mjs from the repo root

**Why this severity:** S3: no user-visible breakage, but ~46% of every phone's first load at a reunion is redundant bytes competing with the page's own load on weak LTE, and the cause is a specific, cited line in the served sw.js with a justification that does not hold on the production host. The rubric has no perf tier, so this sits at the low end of 'defect that degrades the experience without hiding anything'.

**Verifier:** I tried hard to refute this and could not. Fresh Chrome 151 profile, cold context, loaded https://music-timeline-walksalots-projects.vercel.app/index.html, waited for navigator.serviceWorker.ready plus 4s. My numbers came out byte-identical to the report: page resource timing 17 entries / 379,128 B, SW resource timing 27 entries / 499,905 B, 17 URLs fetched over the network by BOTH (379,128 B duplicated), zero SW entries served from the HTTP cache. Script and raw data: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-sw-precache-doubles-cold-load-1/v1-cold-bytes.mjs and v1-cold-bytes.json.

MECHANISM CONFIRMED IN THE SERVED FILE. /sw.js line 111 is literally `const response = await fetch(new Request(path, { cache: 'reload' }));`, and SHELL (lines 40-81) lists both './' and './index.html', which is why two 24,380 B entries for the same document appear inside install. The in-code justification on line 106-107 — "`cache: 'reload'` skips the HTTP cache, which the LAN server marks immutable" — is false on the production host: curl shows `cache-control: public, max-age=0, must-revalidate` on index.html, app.css, ui.js, previews.json and the woff2s (headers saved to sw-headers.txt in the same directory).

MY BEST REFUTATION ATTEMPT BACKFIRED. I expected to show that must-revalidate makes a default-mode fetch cost the full body anyway, so the flag would be blameless. I measured it inside the live SW (v2-timing-and-counterfactual.mjs): default and `no-cache` both cost transferSize 300 (header-only 304) while `reload` costs the full body — app.css 300 vs 16,724; ui.js 300 vs 41,205; previews.json 300 vs 128,893; deck.js 300 vs 37,899; sora woff2 300 vs 25,584. 1,500 B vs 250,305 B across five files. So the flag is exactly the cause, and the same file's own stale-while-revalidate path already uses `cache: 'no-cache'` (line 166) — the fix is one word already present three lines of code away.

MAGNITUDE IS ACCURATE, IF ANYTHING CONSERVATIVE. My full cold total including the navigation document was 903,413 B (the report's 879,033 omits the 24,380 B navigation doc). Avoidable bytes: 379,128 -> ~5,100 for the 17 duplicates, plus 48,760 -> ~600 for the doubly-precached './' + './index.html' = ~422 KB avoidable of 903 KB, i.e. 47% — the report claimed ~46%. Minimum honest cold visit ~470 KB vs the report's "~492 KB". Nothing is exaggerated.

WHY I STILL DOWNGRADE S3 -> S4. One claim in the rationale is wrong. It says the redundant bytes are "competing with the page's own load". They are not: ui.js registers inside a `window.addEventListener('load', ...)` (ui.js line 3499), and aligning both contexts by performance.timeOrigin, the install's first fetch starts 188 ms AFTER loadEventEnd and 118 ms after the page's last subresource, finishing 659 ms after load. That ordering is structural, not a fast-network accident, so the duplicate bytes never touch first paint, interactivity, or any gameplay step. The cost is also one-time per phone per sw.js VERSION, not per load. The brief's rubric has no perf tier and bands S3 by things a user perceives (visual defect, misleading copy, janky flow, a11y, overflow); nothing here is perceptible to a family playing tonight. That puts a provably-real, precisely-quantified, invisible efficiency defect with a false justification comment in the S4 polish/inconsistency band. Real and worth the one-word fix — not S3.

**Reported by:** perf-network:Cold first visit transfers 879 KB for ~492 KB of content — the service worker re-downloads 17 files the page just fetched because install uses cache:'reload'

**Evidence:** `round-2-evidence/S4-sw-precache-doubles-cold-load--v1-cold-home.png`


## Refuted / discarded

| Finding | Outcome | Why |
|---|---|---|
| The reveal after a wrong placement omits the mini-timeline and the 'where it belonged' line that every correct reveal shows | BY_DESIGN | Reproduced the core behavior 3/3 in real Chrome 151 at 393x852 against the live Vercel target with ?debug=1&seed=777, UI-only (script + evidence in /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch |
| Expert mode's year-call stepper value is not in a live region, so its value is never announced when changed | REFUTED | I ran the exact repro in real Google Chrome (script: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/verify-expert-year-stepper-not-announced-1/verify.mjs, run twice from the repo root |

## Coverage (tester self-reports)

- **first-run** — Real Chrome 151 (channel:'chrome', canPlayType 'probably'), 12 throwaway Playwright scripts in /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/first-run/ (01-home … 12-confirm-pause), all run from the repo root against the live Vercel site, ~40 screenshots, every script watching pageerror/console-error/requestfailed. WHAT I TESTED - First run: localStorage cleared, home at 320/393/430/768/1280 - no horizontal overflow at any size, RPM badge clears the hero at 320 (round-1 fix holds), no resume card on a fresh visit, no storage warning, deck stat '1080 songs · 1955-2024' matches DECK. - Assets/PWA: index.html, /, listen.html, icon.svg, app.css, previews.json, manifest.json all 200; service worker registers at scope / and precaches 27 shell entries; second visit and reload are clean. - Offline: after one online visit, context offline + reload -> app boots, home renders, a full game starts and reaches the play screen with the silent demo timer and honest fallback copy. Only console noise is the expected ERR_INTERNET_DISCONNECTED. - Storage-blocked browser (localStorage throwing SecurityError via init script): the visible warning appears on both home and setup, and a game still starts. No errors thrown. - How to play: read end to end, every word, at 393 and 320 (no overflow, no clipped text, no typos found). Cross-checked each rule claim against live behaviour/engine: 2-8 players (Add player disables at 8), start with 1 card + 2 tokens, targets 5/10/15, challenge tie-break 'closest to the active player's left', co-op mistake limit 3 default, ties legal on both sides. The only mismatch found is the co-op token cap (reported). - Resume: mid-turn save (card drawn, gap selected) -> reload -> home shows 'Resume game / Turn 1 — Alice, Bo, Cara, Dev' -> resume restores phase 'placing', the drawn card, the selected gap, deck/discard counts, all four names, tokens (2 of 5), active player and timeline. Reveal-phase resume restores the whole reveal (artwork excepted, reported). Finished game survives reload: 'See final result' -> win screen text and $6 pot + 6,329-char payout QR byte-identical before and after. Buy-in handle persists to later games. Resume card at 320 with 8 max-length names truncates cleanly with no overflow. - Menu sheet (it exists only on the play screen; reveal/scoreboard/win/home have none): focus trap cycles inside the sheet in both directions, Escape closes and returns focus to the menu button; Scoreboard row and its Back work; How to play from the menu returns to the game (not home) with the turn intact; Sound off both silences and stops a running preview and gives honest copy; Reduce motion sets body[data-motion=reduce]; Skip pass-the-phone genuinely skips the pass screen and un-skipping restores it; 'Home — the game stays saved' keeps the save and resumes; End game arms ('Tap again to end the game'), disarms on sheet close and after ~4s, and only ends on a second tap; Shuffle & start arms over an unfinished save. The 'Play songs with' row is the one that does not do what it says (reported twice above). - Round-1 regression spot-checks that all passed: armed double-tap confirms, venmo hint line ('The winner screen will pay @reunion-pot-2026' from a pasted 44-char profile URL), storage notice, finished-game resume card, focus trap, cross-tab warning toast ('This game changed in another tab — reload to catch up.'), names persisting mid-setup, 6 co-op pills, bottom bars pinned. NOT COVERED (other missions / ran out of time): challenge sheet internals, advanced/expert naming and year-call flows, avatar photo capture and the rejection toast, the listen.html page itself, deep audio behaviour across many cards, scoreboard/recap maths, and a full play-to-target win (I reached the win screen via End game rather than by scoring the target). No unexplained pageerror or console error was seen in any session.
- **roster** — Real Google Chrome 151 via chromium.launch({channel:'chrome'}), iPhone-sized viewport 393x852, against the live site https://music-timeline-walksalots-projects.vercel.app/index.html?debug=1 (I verified the live index.html is byte-identical to the repo copy, sha1 cc80aa94...). Thirteen throwaway Playwright scripts under /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/roster/, ~60 screenshots, all driven through visible UI locators; the only page.evaluate calls read state/localStorage/computed styles to assert. WHAT I EXERCISED Bounds: add player 4 to 8 (button correctly disables at 8), remove down to 2 (both remove links correctly disable with title "At least two players"), tally copy tracks correctly at every count. Start-blocked path: honest live copy "N players still need a photo - or tap Skip photo for them" counting down 4/3/... as rows are skipped, button disabled, singular/plural handled. Skip-photo toggle both directions (status flips "Photo needed" <-> "Using their initial", aria-pressed tracks). Names: duplicates (two "Zoe" rows, both allowed, distinct seat colours, one dedup'd guest entry), accents, emoji (initial glyph is a correct single codepoint, renders fine), whitespace-only " " (correctly falls back to "Player 3" at start), leading/trailing spaces (trimmed at start), 40-char and 60-char input. Photos: real PNGs set via setInputFiles on 3 rows, corrupt file rejected with an honest toast ("That photo could not be read. Try another one, or tap Skip photo."), photo carried into state as a data URI and shown on pass/play/scoreboard avatars. Guest list: seat a person (name + saved face both restored), re-seat after removing, edit-mode toggle (hint changes to "Tap the cross to forget somebody", cross buttons appear/hide), forget an unseated person, forget a currently seated person. Roster carry-through: started games in classic mode, verified pass screen name, the 5-seat player rail, and the full scoreboard against __timeline.state. ROUND-1 REGRESSION CHECKS THAT PASSED: names + photo survive a mid-setup reload; Shuffle & start over an unfinished save arms a double-tap ("Tap again to replace the saved game") before replacing it; photo-rejection toast fires; no duplicate placeholder collisions (new rows take the lowest free "Player N"); bottom bar pins; no horizontal overflow at 393px in setup or play (scrollWidth == clientWidth everywhere I measured). CLEAN: zero pageerror and zero console-error output across all thirteen sessions. NOT COVERED (ran out of time): co-op/advanced/expert roster behaviour, 320px-width roster layout, the storage-blocked-browser warning path, cross-tab roster edits, and the avatar library at scale (many faces per name / storage quota). I also did not fully characterise the exact trigger for finding 2 — the empty "PREVIOUS X PHOTOS" heading — beyond the repro steps given, which reproduced 2/2.
- **setup-options** — Real Google Chrome 151, iPhone-sized viewport (393x852, plus a 320x720 pass), live production site, 9 throwaway Playwright scripts under /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/setup-options/ (a- through i-), 45 screenshots, all driven through visible-UI clicks/typing/paste only (state reads were assertion-only). AAC canPlayType returned "probably" throughout, and previews genuinely played (currentTime advanced, paused=false, readyState 4, real audio-ssl.itunes.apple.com src) on every card I sampled. Zero pageerrors and zero console errors across all six browser sessions. Covered in depth: target stepper (5/10/15, clamps both ends, hints 20/45/70 min); all four mode rows (radio + body[data-mode] + descriptions, mistake stepper appears only in co-op, clamps 1..9, co-op shows 6 token pills); streak toggle end-to-end (award fires on the 3rd correct in a row and reads "Streak bonus - three in a row, +1"); buy-in switch, $ stepper clamped at $0 and $100, pot line at 2..8 players adding and removing rows (exact at every count), pot in co-op; Venmo field with 11 input shapes plus real clipboard pastes at 39/119/151 chars (maxlength 120 clips without ever minting a wrong payee), char-by-char typing and mid-string insertion (no caret jump); winner screen with a valid handle (pot $6 = 2 x $3, QR/button correctly carry ONE buy-in, aria-label "Scan to send $3") and with garbage ("whoever is holding it", QR + button + caption all dropped); deck foldout chips, both All-chips, eligible-count arithmetic cross-checked against deck.js data (80s=177, 80s+pop/rock=97, pop/rock=496, 50s+jazz=5 — all exact) and against the deck actually dealt (177 cards, all 1980s); deck warning threshold, the "Not enough songs match these filters" block, and a deliberately starved game played to its deck-exhausted ending; playback source select (all four values, menu copy stays in sync, Spotify mode swaps preview for "Open Spotify to play this card" + a working Search Spotify link + QR); armed Shuffle & start over an unfinished save (arms, leaves the save byte-identical, disarms after ~4s and on leaving the screen); roster/buy-in persistence back into setup; keyboard tab order and focus styling on setup; horizontal overflow at 393px and 320px (none anywhere). Not covered (out of my slice or time): advanced/expert turn resolution beyond mode selection, the challenge sheet, buy-a-card and token economy, photo capture/avatar library, listen.html, the scoreboard, and storage-blocked/other-tab warnings. I also did not test the reverse direction of finding 1 (lowering or switching off the buy-in mid-game to shrink an agreed pot) — it is the same single code path but I only ran the phantom-pot direction.
- **classic-game** — Real Google Chrome 151 (channel:'chrome'), 393x852 iPhone-ish viewport unless noted, live Vercel site, ~22 minutes of driving. canPlayType('audio/mp4; codecs="mp4a.40.2"') = "probably", so REAL-CHROME audio rules applied. Scripts and screenshots: /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/classic-game/ (lib.mjs, game1.mjs, game1b.mjs, game2b.mjs, probe3-probe10.mjs, matching .log files, ~55 PNGs). GAME 1 (2 players Ann/Ben, target 5, seed 4242, every placement honest, correct gap computed from window.__timeline.state): 7 turns, all 7 judged correctly by the engine, win fired at exactly 5 cards (Ann 5 / Ben 4, result.reason="target"). Pass screen named the right player and "then <next>" every turn; standings and per-turn "N / target" counter tracked the active player correctly. Selected gap was always visibly marked (pink dashed outline + "+" highlight, aria-pressed=true); it widens 16px->~36px when the strip has slack and marks without widening once the strip is full — verified by screenshot, the affordance never disappeared. Reveal showed year, title, artist, verdict, mini-strip and position line on all 7. Win screen: winner name, "5 cards, 2 tokens left", full year strip, confetti canvas, Play again + Home. GAME 2 (4 players, target 10, seed 777, deliberate miss on every 3rd turn): ran the full 49 turns. Turn order rotated Ann>Ben>Cat>Dan without a single deviation across 49 turns. All 16 deliberate misses were judged wrong and discarded (discard pile 16, deck arithmetic exact: 1080-1027 = 4 dealt + 49 drawn); all 33 honest placements judged correct — zero engine disagreements with my independently computed gaps. Roster rail active ring / NEXT flag / crown-on-leader all moved correctly (verified in DOM: data-rank, data-leader, aria-label "Ann, 2 cards, leading"). Win fired at exactly 10, not one early or late. Mid-game menu from the play screen: sheet trapped focus through 15 Tab presses (cycled btn-menu-scoreboard -> ... -> btn-menu-close and back, never escaped); scoreboard showed correct "N to go", landed cards, deck remaining, "up now" on the right player, and returned cleanly to play. REGRESSION CHECKS on round-1 fixes inside my mission, all PASSING: distinct "Player 1..4" placeholders (no duplicates); End game shows "Tap again to end the game" and disarms when the sheet is closed, game survives; finished game survives reload and home shows "See final result / Game over — Ann, Ben", which reopens the real win screen; mid-turn reload shows "Resume game / Turn 2 — Ann, Ben" and resume restores the same turn, same active player, same drawn card, same counts and tokens; Play again returns to setup with roster, target and skip-photo state intact plus a populated "Played before" list; streak house rule awards say "Streak bonus — three in a row, +1 token"; skip tap-guard holds (paired taps at 60/120/250/400ms each produced exactly one skip); bottom bars pinned and reachable at 320x568 through a whole game. AUDIO: verified on 9+ distinct cards across sessions — every fresh draw reached paused=false, readyState=4, currentTime advancing (2.1-2.9s after ~2.5s), real audio-ssl.itunes.apple.com .m4a src, audio.error null. Vinyl tap pauses (ct frozen, paused=true) and resumes from position; Replay restarts from 0 and plays; after a skip the new card's src changes and plays. No silence, stuck ring, or false error seen once. OTHER PROBES, all clean: Place here correctly disabled until a gap is chosen (blind tap impossible); gap selection clears when the card is skipped (no stale gap carried onto the new card); double-tap on Place here / Next player / Start the turn each produced exactly one advance; long-timeline strip is a genuine overflow-x:auto scroller that auto-scrolls sensibly, responds to a human swipe, keeps scroll position across selection and scrolls the chosen gap into view at 7-9 cards; "I can name it" claim awards exactly +1 token only when both Title and Artist are confirmed, and correctly revokes it when a vote is un-tapped. No horizontal overflow on any screen at 393px or 320px. Zero pageerror, zero console.error, zero failed requests across every session. NOT COVERED (ran out of mission scope/time): advanced/expert/co-op modes, challenge and buy-a-card token flows beyond seeing them disabled/enabled, the Venmo buy-in and winner QR, the listen.html page, the QR rendering on the play screen, offline behaviour, and storage-blocked browsers — all outside the classic-gameplay mission or assigned elsewhere.
- **tokens-bets** — Roughly 20 minutes of live driving in real Google Chrome (channel=chrome, 393x852 and 320x720), all through visible UI taps; window.__timeline.state and DOM reads used only to assert. Nine throwaway scripts + screenshots in /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/tokens-bets/ (lib.mjs, run1-challenge, run2-nameit, run3-buy, run4-edges, run5-wins, run6-tiebreak, run7-modes, run8-capstack, run9-repro-takeback). CHALLENGE — verified: sheet lists exactly the non-active players with live token counts; a 0-token player is shown but disabled reading 'Needs 1 token'; the sheet renders the CHALLENGER's own timeline (not the active player's); lock-in spends exactly 1; the badge and 'X challenged' pills track the count; take-back swaps the row's data-action and refunds 1 (when the sheet is reachable — see finding); two challengers on one card both pay; a wrong placement sends the card to the correct challenger and burns the wrong challenger's token; with TWO correct challengers the nearest seat to the active player wins and the runner-up copy says 'Right spot, but someone claimed it first'; skip-card refunds every live challenge and clears badge + pills; a steal that reaches the target ends the game with the thief as winner and the reveal button flips to 'See the result'; 8 players at 320px produced no horizontal overflow and a 7-card challenger timeline scrolls so the far gap is still selectable; sheet focus stayed trapped over 12 Tabs and Escape closed it. BUY — verified: blocked at 2 tokens with 'Needs 3 tokens (you have 2)', blocked after the card is drawn with 'Only at the start of your turn', enabled at 3; buying costs exactly 3, inserts the top card at the correct index (timeline stays sorted), shows a '-3 Bought a card' award and no confirm panel, resets streakRun to 0, and buying the target-th card ends the game with the right winner. Co-op buy takes 3 from the shared pool and adds to the shared timeline. NAME-IT — verified across 8+ turns: claim registers before the reveal (aria-pressed), the confirm panel appears only after; Title alone pays nothing ('Did not name it', 0); both confirmed pays exactly +1; un-ticking after an award removes it and re-ticking restores the same count (no double-pay); at the cap the row reads 'Named it - tokens already full' with 0 and the pool does not move; identify +1 and a simultaneous streak bonus stack honestly as '+1' then 'Streak bonus - tokens already full 0'; streak pays 'Streak bonus - three in a row' on the third kept card; advanced mode pays the claim AND keeps the card only when both are ticked, and pays nothing when no claim was made; co-op credits 'Shared pool'. A reload mid-reveal resumed onto the reveal with both votes still pressed and the token intact. TOKEN SURFACES — play-screen pills, pass-screen standings pills and scoreboard rows all matched the seam's counts after challenges, refunds, steals, buys and awards; co-op rebuilt to 6 pills and tracked the shared pool; no horizontal overflow anywhere. Zero pageerrors and zero console errors across every session. NOT COVERED (ran out of time): expert-mode year guess interacting with challenges; buying with the deck nearly empty; a challenge when the challenger is at the token cap; token behaviour across the other-tab-changed warning; and the Venmo/win-screen payout surface (another agent's area).
- **adv-expert** — Roughly 45 minutes of live driving of https://music-timeline-walksalots-projects.vercel.app/index.html in real Google Chrome (canPlayType 'probably'), 393x852 and 320x568, all through visible UI taps; the debug seam was used only to assert outcomes. Scripts and 65 screenshots are in /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/adv-expert/. WHAT I VERIFIED AS CORRECT (no defect found): - Advanced gate, all four paths: right gap + Title + Artist -> kept ("Correct. The card is yours."); right gap + Title only -> discarded; right gap + no vote -> discarded (both "Right spot, but you had to name it too."); wrong gap + both confirmed -> discarded ("Not quite. The card is discarded."). Engine outcome (accepted / placementCorrect / requirementsMet) matched the verdict copy every time. - Expert: the year stepper appears only under body[data-mode="expert"], defaults to 1985, clamps at 1900 and 2026, and survives being set before the draw. Right gap + exact year + both confirmed -> kept; right gap + off-by-one year + both confirmed -> discarded with the correct specific copy "Right spot and you named it - but it was not 1958."; right gap + exact year + no vote -> discarded; wrong gap + exact year -> discarded. This matches the rules screen's "Exact match or nothing" exactly - I found NO mismatch between UI copy and engine outcome, and no year "bonus" is promised anywhere or paid anywhere (consistent). Untouched-stepper case (1985 treated as the call) is handled honestly. - Full short games (target 5, 2 players) played to a real win in BOTH modes: advanced seed 31337 (Bo, 5 cards, 1 token) and expert seed 5150 (Ada, 5 cards, 2 tokens) - correct win screen, timeline recap, confetti, Play again / Home. - Rules screen opened from the in-game menu: the "four modes" copy and the challenge small print match observed behaviour, including "in advanced and expert a card placed correctly but lost on the title, artist or year is discarded rather than won - challengers get nothing", which I confirmed live (challenger with a correct gap against a correct-but-unnamed placement got nothing: "The placement stood, token spent", -1 token). - Round-1 regression areas inside this mission all held: armed double-tap End game ("Tap again to end the game") and Shuffle & start ("Tap again to replace the saved game"); mid-turn reload in expert restored the drawn card AND the year call; mid-reveal reload in advanced restored a half-cast vote and the remaining vote still worked; finished game survived reload -> "See final result" -> win screen; challenge sheet trapped Tab focus (14 tabs, never escaped) and Escape closed it; streak bonus fired exactly at 3 kept cards, labelled "Streak bonus - three in a row +1"; "Play again - same players" preserved expert mode, target and skipped photos. - Robustness: 8 rapid confirmation toggles on one reveal and 6 on a stolen card produced zero token or timeline drift; a challenge steal applied exactly once. - Audio genuinely played on every card tested (10+ cards): currentTime advancing 1.2-2.3s, paused=false, readyState 4, real audio-ssl.itunes.apple.com src, no media errors. - Layout: zero horizontal overflow on play, reveal, scoreboard and setup at 320px and 393px; the long expert wrong-year verdict is not clipped at 320px; the year stepper and Place button are both reachable and the year stepper is in the keyboard tab order. - Zero pageerrors and zero console errors across every session. NOT COVERED (ran out of budget or out of mission): co-op and classic modes, buy-a-card (3 tokens) inside advanced/expert, the Venmo/buy-in surface and winner QR, listen.html, the storage-blocked warning, the avatar/photo library and its toast, offline behaviour, deck filters, and games with more than 3 players.
- **coop** — Roughly 16 minutes of live testing against https://music-timeline-walksalots-projects.vercel.app/index.html in real Google Chrome (channel:'chrome', canPlayType AAC = "probably") at 393x852, plus a 320x640 pass. Eight throwaway Playwright scripts under /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/coop/ (lib.mjs + 01-win, 02-mistakes, 03-tokencap, 04-endgame, 05-resume, 07-misc, 08-buyin-loss, 09-buy-armed-320, 10-limit1, 11-final, 12-copy, 13-resume-reveal, 14-audio). Every session listened on pageerror and console error: ZERO errors in every run. CONFIRMED WORKING (no finding): one shared timeline labelled 'SHARED TIMELINE'; pass screen shows the 'THE TEAM' box and hides #pass-standings; play/reveal rails show 'team N/T' + 'M/L missed' pills and hide per-player counts; shared token pool caps at 6 (6 pills, aria 'Tokens: 2 of 6') and a 5th name-it claim at cap reports 'Shared pool / Named it - tokens already full / 0' rather than a fake +1; every wrong placement increments the mistake counter and the loss screen arrives exactly at the limit (verified at limits 1 and 2, never early, never late); win at target gives 'CO-OP WIN / Everybody / 5 cards together with 0 of 3 mistakes used'; the win recap collapses decades to a single shared row; End game is an armed double-tap ('Tap again to end the game') and produces honest 'GAME OVER / Stopped early / 3 cards of 10, with 0 of 3 mistakes used' — not a fake defeat; Shuffle & start over an unfinished co-op save arms with 'Tap again to replace the saved game' and does not destroy state on the first tap; resume mid-turn after reload restores the drawn card, the selected gap, cards/tokens/mistakes and the active player; resume mid-REVEAL after reload does not double-count the mistake; a finished co-op game survives reload and home offers 'See final result', which restores the correct co-op win screen; buy-a-card in co-op debits the shared pool by 3, adds to the shared timeline and records no mistake; the challenge button is deliberately hidden in co-op (nobody to steal from); the menu sheet genuinely traps focus (22 Tab presses, never left the sheet) and Escape closes it; skip-card's tap guard behaves as a 650ms cooldown, not a lost card; audio genuinely plays in co-op — three different cards plus Replay all advanced ~3.0s in 3s wall time, paused=false, readyState=4, real audio-ssl.itunes.apple.com sources; no horizontal overflow at 393px or at 320px with 8 players (the seat rail scrolls, nothing is clipped). NOT COVERED / ran out of time: deck-exhausted co-op loss (would need ~1,078 skips or placements — the 'The deck ran dry' branch is untested on the live site); co-op with the 'Skip pass-the-phone' option on; co-op streak-bonus award (with 3+ players rotating, no single player ever reaches three placements in a row in a 5-card game, so the streak path never fired — I enabled the house rule and confirmed streakBonus=true in state but never triggered an award); storage-blocked-browser warning inside a co-op game; 2-player co-op; the Venmo deeplink's actual amount/note payload on a co-op WIN (I verified the pot total $6 = 3 x $2 and that the link is one buy-in by code path, but did not open the URL).
- **persistence** — Real Google Chrome (channel:'chrome'), 393x852 viewport, live Vercel site, ~10 browser sessions, all against ?debug=1 with seeds 7/11/42. Every session recorded pageerror + console.error: ZERO of either in any run, including all 14 sabotage cases. RELOAD AT EVERY PHASE (script 02/04, all PASS): mid-setup, turn-start/pass screen, listening (mid-preview), placing (gap selected, uncommitted), revealed, between turns, and game-over. In every in-game case the home screen offered 'Resume game — Turn N — Ann, Bob' (and 'See final result — Game over' after the win), and resuming restored phase, turn, activeIndex, drawn card, selected gap, both timelines, tokens, streak counts, deck/discard sizes and the reveal copy byte-for-byte. Audio genuinely played before the reload (currentTime 2.24s, paused=false, readyState 4, real audio-ssl.itunes.apple.com src) and correctly returned to 'Tap play when everyone is listening' after it (autoplay rules — not reported). SETTINGS (script 10, PASS): sound off, skip-pass on, reduced motion on, playback source preview→spotify all survived a reload+resume, and skip-pass actually suppressed the pass screen afterwards. Buy-in survived from setup through a full 8-turn game to the winner screen with correct math ($3/head x 2 = 'THE POT $6', 'Send it to @ann-kibak'), and survived a reload ON the winner screen. Streak bonus and 5-card target likewise survived. Challenge in flight (script 11, PASS): Bob's locked-in challenge (token spent, 'Bob challenged' badge) survived a reload and resolved correctly at the reveal. SABOTAGE (script 05, 14 cases, all PASS — no blank page, no crash loop, no error, 'New game' always reachable): truncated game JSON, version bumped to 99, 300 KB of garbage, non-JSON text, valid-JSON nonsense, d:null, empty players array, deleted players key, deleted game key, corrupt settings key, hostile buy-in (amount '1e9', handle an object / a <script> string), activeIndex 99, negative tokens + negative target, emptied deck. Corrupt saves fall back to a clean home; the survivable ones resume sanely and the impossible ones end at 'See the result'. The hostile buy-in was correctly rejected — the winner screen dropped the pot block entirely rather than printing garbage money (script 08 PART2). Blocked storage (script 07): visible warning, fully playable in memory, sane fresh state after reload. End game armed double-tap (script 08 PART3): first tap arms ('Tap again to end the game'), second ends to an honest 'LEVEL WHEN IT ENDED' screen that survives reload. NOT COVERED (ran out of time): photo upload through the file picker and avatar-library persistence; co-op/advanced/expert-mode saves; deck decade/genre filter persistence; 'Play again — same players' followed by a reload; three or more concurrent tabs; and the realism check on finding 3 (whether the app's own preview cache plus stored photos can actually exhaust the quota in a real night — my repro filled it with a foreign key the app cannot evict, which is why I rated that one S3 with medium confidence).
- **qr-listen** — Real Google Chrome 151 (channel: 'chrome'), viewports 393x852 / 390x844 / 375x667 / 414x896 / 320x568, all against the live Vercel site. Codec check returned "probably", so I held audio to the REAL-CHROME bar throughout. Scripts and every screenshot are in /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/qr-listen/. QR block (play screen) — PASSED. Wrote a real QR decoder (decode.mjs: parses the SVG path into a module matrix, reads format info, unmasks, de-interleaves, decodes byte mode) rather than trusting the app's own encoder. The rendered code is a genuine version-8/9 ECC-M QR and decodes to the exact spoiler-free URL (payload {"v":1,"t":...,"a":...,"n":...} — no year, ever). Verified: block visible before the draw with the frame hidden and no empty-white-square (caption only); frame + SVG appear on draw; svg forced to 100% width, zero horizontal overflow at every width tested; #qr-file-note correctly stays hidden on https (only fires on loopback); QR payload follows the card through two 'skip this card' taps, survives gap-select, 'I can name it', and the challenge sheet open/close without going stale; changes correctly on turn 2 (n:1 -> n:2); repaints correctly after a mid-game reload + 'Resume game'. QR is below the fold at 393x852 and completely off-screen at 320x568, but scrolls fully into view at every size (100% visible, hit-tested clean at all four corners) — not a finding. There is no separate alt/QR toggle in #qr-block (zero interactive elements); the only toggle is Show/Hide streaming links, covered below. listen.html — PASSED. Real audio: currentTime advanced 0 -> 2.81 -> 5.89s, paused=false, readyState=4, real audio-ssl.itunes.apple.com src. Pause, resume, Replay-from-start, and the full 30s run to the 'done' state ("That's the clip. Replay it as often as you like.", ring at 0:30/0:00) then replay-after-done all behave. No spoiler anywhere: no year/title/artist in visible text OR raw HTML until the disclosure is deliberately opened; generic <title>, noindex, no-referrer. Disclosure links are correct, target=_blank, rel="noopener noreferrer". hashchange (re-scan in the same tab) fully resets: old audio stops, card number updates, links clear, new card plays. Payload mangling — 22 hand-built cases, all honest, no crash, no page error: no hash, hash of spaces, non-base64 garbage, truncation by 1/5/half, valid base64 that isn't JSON, JSON array, JSON null, v:2, v:"1", empty title, unknown song, n=0 / 99999 / -3, a 400-char title, accented text, percent-encoded hash, and ?card= query with no hash. Three distinct notices fire correctly ("Nothing to play yet" / "That link looks scrambled" / "That card is from another version"), player hidden, controls disabled. An <img onerror>/<script> title did not execute (no innerHTML path). Unresolvable cards give the non-retryable "Couldn't stream this one. The links below will find it." with the disclosure surfaced; blocking audio-ssl mid-play gives the retryable "…Tap play to try again, or use the links below.", and tapping play after the network returns genuinely recovers (t=2.03s, readyState 4). Five apostrophe/parenthesis/non-ASCII deck cards ("(Sittin' On) The Dock of the Bay", "Ain't No Sunshine", "Screamin' Jay Hawkins", "Rapper's Delight", "Un x100to") all resolve and play — the cardId slug rule holds. Streaming-links row (play screen) — PASSED. Forced it open by aborting audio-ssl/itunes requests: honest status ("That preview would not play here. Use the links below, or skip this card."), warning line present, three links with correct search URLs, target=_blank, rel="noopener noreferrer", 343x42 tap targets, no year or title in visible text, and the button correctly relabels Show <-> Hide with aria-pressed tracking (round-1 fix intact). Console/pageerror: clean in every session. The only console errors were the ERR_FAILED entries I caused myself by blocking audio-ssl.itunes.apple.com. Not covered (ran out of budget): the winner-screen payout QR (Venmo area, another mission), co-op/expert-mode variants of the QR block, service-worker/offline behaviour of listen.html, and a rigorous WCAG contrast measurement — my in-page contrast probe returned an obviously wrong constant ratio for every selector, so I discarded it rather than report on bad numbers.
- **a11y** — Real Google Chrome 151 via chromium.launch({channel:'chrome'}), iPhone-sized 393x852 viewport, ~14 live sessions against https://music-timeline-walksalots-projects.vercel.app/index.html?debug=1. Scripts and every screenshot are in /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/a11y/ (lib.mjs plus 01-home, 02-setup, 03-deck-tab, 04-play, 05-sheets, 06-turn, 07-new-surfaces, 08-toast-zoom, 09-avatars-zoom, 10-modes-win, 11-win-classic, 12-toggles, 13-coop-loss, 14-confirm). TESTED AND CLEAN (worth knowing, since these were the mission's suspicions): - Zero pageerror and zero console-error events across every session, including the win, co-op-loss, end-early, expert and 200%-zoom runs. - Focus on screen change: every transition moves focus to the new screen's tabindex=-1 h1 (home->setup, setup->pass, pass->play, play->reveal, reveal->pass, menu->scoreboard, scoreboard->play, ->win, ->rules, ->home). Scroll is reset too. - Tab order is DOM-sane on home, setup, pass, play, reveal, scoreboard and win; nothing traps or dead-ends; disabled controls (Shuffle & start before photos are resolved, Place before a gap, Lock in before a challenger) correctly drop out of the sequence and come back enabled. - Both sheets genuinely trap focus: 20 forward Tabs and 8 Shift+Tabs from inside the menu sheet never left it, likewise 14 Tabs in the challenge sheet. Escape closes both and returns focus to the exact opener (#btn-menu, #btn-challenge). When closed, the sheets are visibility:hidden / pointer-events:none, so they are out of the a11y tree and out of the tab order — no phantom dialog. - aria-pressed reflects state everywhere I could toggle: skip-photo, decade/genre chips (true->false->true via 'All decades'), gaps, #btn-play-song, #btn-claim-identify, challenge-option player picker, and the advanced/expert Title/Artist confirm buttons. Menu switches are real checkboxes and operate with Space. - Live regions: #live-status (polite) announces turn start, verdicts, year-guess result, winner and the armed End-game warning; #live-alert (role=alert) carries the photo-rejection toast text, so the visually-styled #toast having no role of its own is harmless. The venmo field is properly wired: aria-describedby to a role=status hint, and aria-invalid flips to true on a bad handle. - Keyboard operability of the new armed double-tap confirm: focus End game, Enter, Enter ends the game; the armed state is announced; it silently disarms after ~5s (fails safe, so I am not reporting it). - 200% zoom (viewport halved to 196x426): no horizontal overflow on any screen, and a full turn — start, play song, pick gap, place, reveal — completes with every control visible and clickable. - Reduced motion: honoured both by the OS media query and the in-menu toggle (body[data-motion=reduce]); the confetti canvas is aria-hidden and JS-gated on motionIsReduced(). The win-screen QR is an svg with role=img aria-label="QR code". - Audio worked on every card I played (real audio-ssl.itunes.apple.com src, currentTime advancing, paused=false). NOT COVERED (ran out of time): a real screen-reader smoke test with VoiceOver (all announcement claims are DOM/accessible-name inspection, not audio); the avatar photo-library sheet's keyboard behaviour; the storage-blocked warning's a11y (needs a storage-denied context); Windows High Contrast / forced-colors; the listen.html page; and touch-target-size measurement."
- **responsive** — Scripts (throwaway, nothing in the app touched, nothing committed) live in /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/responsive/ and all ran from the repo root against the live Vercel site in real Google Chrome (canPlayType 'audio/mp4; codecs=\"mp4a.40.2\"' == \"probably\"). WHAT I COVERED - Full flow at all six required sizes (320x568, 375x667, 393x852, 428x926, 820x1180, 1024x1366): home, rules, setup with 8 players, setup with buy-in + streak bonus + open Deck&playback foldout, pass, play (1 card), menu sheet, scoreboard, reveal, play after 9 turns, landscape rotate. Screenshots in vp-<size>/ (sweep.mjs). - Horizontal overflow measured on every screen at every size, plus an offender scan: documentElement.scrollWidth never exceeded clientWidth anywhere, on any screen, including listen.html. Zero overflow findings. - Occlusion testing by elementFromPoint hit-test on every visible button/input/gap, at both top and max scroll, at all six sizes (states/, deep.mjs). Setup, pass, reveal, win, rules all clean; the only real occlusion is the landscape play screen (finding 1). - Fixed bottom bars: setup's 'Shuffle & start' bar does temporarily cover the 'Cards to win' stepper at 320x568 top-of-scroll, but scrolling clears it and nothing is covered at max scroll - normal sticky-bar behaviour, not reported. Menu sheet End game / Home are reachable and hit-testable at all seven sizes tested including 568x320 and 852x393 landscape (sheets.mjs). Challenge sheet at 320x568 fits with 'Lock in' and 'back' both tappable (challenge.mjs). - Timeline strip with 1 card and with 10 cards at all six sizes (states2/play-10cards): the strip is a horizontal scroller and the hint copy correctly switches to 'Swipe, then tap a gap'. Mini-card titles truncate with an ellipsis inside a 60px box - by design, not reported. - 8-player roster rail at 320: scrollWidth 350 vs clientWidth 318, overflow-x auto, scrolls by wheel. Fine. - Long names: the name input is maxlength=16, so 25+ char names are not reachable through the UI; I used 16-char names (the app's own maximum) everywhere a name renders - setup rows, pass hero, play header, 'next' line, roster chips, scoreboard, reveal 'played this card', win hero, win 'X's decade' stat. Only the win hero clips (finding 2). - Long song title: narrowed the deck to 1960s pop and drew 'Itsy Bitsy Teenie Weenie Yellow Polka Dot Bikini' (48 chars); the reveal wraps it cleanly at all six sizes, no clipping, no overflow. - Win screen with a maxed pot ($100/head x 8 = $800, and $100 x 2 = $200 with the QR + 'Send it to @handle' line): renders correctly, money strings correct. - listen.html at all six sizes: clean. - Landscape verified natively (fresh contexts at 568x320 and 852x393) as well as by mid-game rotation, and cross-checked on the pass and reveal screens, which are both fine. - Console/pageerror monitored in every single session (13 script runs): ZERO pageerrors and ZERO console errors throughout. INCIDENTAL ROUND-1 REGRESSION OBSERVATIONS (all held) - Venmo field accepted a pasted 43-char account.venmo.com/u/... URL with the live hint 'The winner screen will pay @bartholomew-fitz', and honestly refused a 32-char handle with 'That's not a Venmo handle or profile link - it won't be on the winner screen'; the winner screen then showed the QR and the payee line. - 'End game' armed correctly to 'Tap again to end the game' with no overflow at 320x568. - Bottom bars pin; no RPM-badge overlap at 320. WHAT I DID NOT GET TO - Co-op mode's 6 token pills and shared-timeline layout at small sizes. - Advanced/expert mode confirm panels and the year-guess field responsively. - Focus-trap keyboard behaviour in the sheets (a11y lane, not my mission). - Storage-blocked warning and the finished-game resume card at small sizes. - Reveal/win screens with a photo avatar rather than an initial.
- **perf-network** — Roughly 20 minutes of live testing against https://music-timeline-walksalots-projects.vercel.app in real Google Chrome (canPlayType('audio/mp4; codecs="mp4a.40.2"') = "probably"), driving only visible UI, all scripts and screenshots under /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/perf-network/ (01-09 .mjs + .json + .png). No app file edited; git status clean. WHAT I MEASURED (real numbers): - Cold visit (01, 02): 19 page requests, 401,157 B, 1.06s load, no 4xx/5xx, no duplicate page requests. SW install adds 27 requests / 499,905 B — total ~879 KB. Largest assets: previews.json 128,829 B (435 KB raw), ui.js 41,079, deck.js 37,747, sora-variable woff2 25,441, index.html 24,444. 27 cache entries under "music-timeline-v8-qa1". - Warm second visit (01): reload 19 requests, 0 bytes over the network, every response fromServiceWorker=true, 180ms load. Brand-new tab in the same profile: 19 requests, 0 bytes, 133ms. Shell is genuinely worker-served. - Offline (01, 08): reload after one online visit fully loads from the worker (0 bytes, 59ms, home renders, no horizontal overflow at 393px); listen.html also loads offline (5 reqs, 0 bytes); a brand-new tab loads offline; a mid-game reload offline shows the resume card and resumes to the exact turn; the offline reveal computed the right result. No 404s at the bare origin "/" either. - Audio (03, 07): first play = single GET, HTTP 206, 1,067,878 B from audio-ssl.itunes.apple.com; a second card = 206, 1,069,887 B; Replay = 0 requests / 0 bytes (buffer reuse). Real playback confirmed (currentTime advancing, paused=false, readyState=4). 14 consecutive turns: 14/14 previews audible, 14 unique preview URLs, 0 repeats, 0 bad responses; album art from is1-ssl.mzstatic.com ~74 KB per reveal. Whole 14-turn game = 48 requests / 16.2 MB (~1.2 MB per turn). - Adverse network: preview host blocked (net::ERR_ADDRESS_UNREACHABLE, the Pi-hole/captive-portal case) is handled honestly and the turn still completes; emulated 400 kbps/400 ms 3G still streams the preview through without a stall. Neither is a finding. - CPU throttle 4x (04): fully usable, nothing broke. FCP 532ms; New game tap 1.3s, skip-photo row taps 2.1s for 4 rows, Shuffle & start 1.5s, pass continue 1.3s, audio audible 1.0s after the tap, gap tap 0.9s, Place 3.0s, next player 1.7s. Slower, not unusable. (The one "failure" in that log was my own wrong menu selector; the real control is #btn-menu.) - Stability: heap 3.3-5.5 MB, nodes 3.0k-4.1k, listeners 30-43 across 14 turns — no leak trend. Zero pageerrors in any session; the only console errors were network failures I deliberately induced (blocked host / offline). NOT COVERED (ran out of time / out of lane): Lighthouse-style LCP/CLS metrics and cold first-paint under emulated slow networks; a full game to a 15-card target with challenges, co-op mode and the win/Venmo screen under CDP; listen.html driven end-to-end from a scanned card; storage-blocked-browser and multi-tab warning paths (round-1 fix areas owned by another lane); SW update-on-new-deploy behaviour (cannot deploy a new VERSION from here); iOS Safari behaviour of any kind.
- **chaos** — ~16 minutes of live testing against https://music-timeline-walksalots-projects.vercel.app/index.html in real Google Chrome 151 (canPlayType returned "probably"), iPhone-sized viewport, 13 throwaway Playwright scripts + 48 screenshots under /Users/krisstudio/Developer/Worktrees/fabians-red-card/qa-round2/scratch/qa/round-2/chaos/. All interaction was through the visible UI; multi-taps were real mouse clicks at fixed screen coordinates (no force:true, no hidden-element clicks) so they reproduce what a fast finger actually hits. WHAT I EXERCISED AND FOUND CLEAN: triple-tap on pass-continue, vinyl, place, next-player (no double placement, no skipped turn, no double token award — timelines/turn counters always advanced exactly once); rapid gap-selection spam (4 passes over every gap, last-tap-wins, nothing committed); coordinate-collision probe across every screen transition (home->setup, setup->pass, pass->play, place->reveal, reveal->pass, win->setup) — only two collisions matter and both are reported; browser back (lands on about:blank) then forward (clean reload to home, no error, save intact); 4x refresh spam during the reveal — state survived exactly (turn 1, phase "revealed", timelines [2,1,1], same card) and the home resume card read "Resume game / Turn 1 — Player 1, Player 2, Player 3"; menu -> Home mid-game then resume (card and phase preserved); armed double-tap confirms on both End game ("Tap again to end the game") and Shuffle & start over an unfinished save ("Tap again to replace the saved game") — the first tap alone never destroyed the save, verified by backing out and finding Resume still offered; menu focus trap (14 Tabs cycled strictly inside #menu-sheet, never escaped); Venmo field abuse — <script>, "><img src=x onerror=...>, credentials URL, 500 chars, 116-char URL, emoji, padded spaces: all rejected with honest copy, no raw HTML injected into the hint, hard cap at 120 chars, window.__pwned never set, pot math correct ($5 x 4 players = "Pot: $20 with 4 players"); audio under abuse — 10 rapid play/pause toggles left it genuinely playing (currentTime advanced 6.38 -> 8.86s over 2.5s, readyState 4, real audio-ssl.itunes.apple.com src, honest "Playing the preview." status) and Replay restarted it correctly; challenge sheet normal flow (token spent 2->1, challenge {p2, gap 0} recorded) and 4x rapid-tap/confirm-spam (no token drained, no phantom challenge); empty-deck endgame — filtered to 10 eligible songs, played every placement wrong until deck hit 0, and the game ended honestly on the win screen with reason "deck-exhausted" and "JOINT WINNERS", no hang. ZERO pageerrors and zero console errors across all 13 sessions. NOT COVERED / RAN OUT OF TIME: advanced/expert title-artist-year confirm inputs under spam; the listen.html companion page; the win-screen QR and Venmo deeplink rendering with a valid handle after a real win; co-op mistake-limit exhaustion; storage-blocked (private-window) warning; other-tab change warning; 320px layout. TWO OBSERVATIONS I DELIBERATELY DID NOT FILE AS FINDINGS (too weak to defend): (1) the same coordinate-collision family — a second tap on the pass screen's continue button lands on the vinyl and auto-starts the preview, and a third pauses it again; harmless and one tap to recover. (2) There is no menu button on the pass or reveal screens, so "End game" is only reachable from the play screen; plausibly by design and recoverable in one tap.
