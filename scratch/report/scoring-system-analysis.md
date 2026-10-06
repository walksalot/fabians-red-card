# Fabian's Red Card — Scoring System Analysis & Recommendation

*Prepared 2026-06-11 (matchday 1 complete). Analysis only — no code or settings were changed.*

**How this was produced:** six parallel audit agents read every scoring-related line of the live app; a Monte Carlo simulator was built on top of the app's **real scoring engine** (imported directly, fidelity-checked), **real DraftKings odds** for 19 actual WC2026 group matches (pulled from the same ESPN feed the app uses), and the **real 48 squads** (1,246 players). ~10,000 full-tournament simulations of a realistic 13-player field were run across 9 rule designs, then three independent verification agents attacked the code and re-derived the headline numbers.

---

## Part 1 — The verdict on "betting-favorites strategy is an unfair edge"

**Your friends are directionally right, but it's not where the real problem is.**

Following the odds (pick the bookmaker-modal scoreline, the favorite's striker off the cheat sheet, favorite to score first, boost the biggest favorite) earns **~4.1 expected points per match** vs **~3.7** for an engaged casual who picks favorites 2-1 with a star scorer, and **~2.2** for low-effort picks (the 0.45/match gap was independently re-derived closed-form to ±0.002). Add ~13-15 points of tournament value from disciplined booster placement and the all-in edge over an engaged casual is **~60 points over the ~100 remaining matches** — in simulation, a disciplined odds-follower makes the podium in **~52-70%** of tournaments (a fair share would be 23%). Notably, the sharp's edge concentrates in *competitive* matches (it's twice as large at a -120 favorite as at a -3000 blowout, where everyone picks the same thing).

Three honest framings for the group chat:

1. **It's not cheating — it's the game.** The odds are public, and the app shows them to everyone at pick time (that's what the cheat sheet is for). "Do research, win more" is what a prediction pool rewards. The pot still isn't a lock: even perfect odds-following only wins the whole thing ~20% of the time per sharp player — one hot casual week regularly flips it.
2. **Chalk players cannibalize each other.** Odds-followers converge on near-identical picks. In simulation, two players independently following DraftKings tie *constantly* — and then the tiebreaker (see Part 3) decides real money. Copying the odds is strong but self-defeating at scale.
3. **The actual unfair edges are elsewhere** — three real exploits below, all fixable.

---

## Part 2 — Exploit #1: the surname trick (the big one)

**What it is.** The scorer pick is free text, and the matcher awards the 8 points if your text matches the *end* of the actual scorer's name. The rules page even teaches this ("last names count — 'Jimenez' = 'Raúl Jiménez'"). What it doesn't say: typing just **"martinez"** in an Argentina match counts for **Emiliano, Lisandro, AND Lautaro Martínez**. One string, three lottery tickets. Meanwhile the app's own dropdown inserts the full name — honest tap-flow players get exactly one ticket.

**Measured on the real squads:** a 2+ player covering pick exists in **60 of 72** known fixtures (max 3 players: 'martinez'/ARG, 'sarr' & 'ndiaye'/SEN, 'suzuki'/JPN, 'pierre'/HAI). Four fixtures even have one string covering **both teams**. Brazil's two Edersons collapse into one pick.

**Worth (post-verification numbers):** **+0.04 points per match on the real fixtures** — about **4-6 points over the rest of the tournament** (an earlier +11 estimate was inflated by a simulation artifact and a roster data bug; the adversarial verification pass caught both). Sounds small — but because the exploiter is otherwise making the same sharp picks as their rivals, the edge is nearly *deterministic relative to equally-skilled players*: in corrected tournament simulations the trick-user **won the pool ~33%** of the time vs ~17% for equally-sharp honest players (**+15pp of win probability as an upper bound**; with fully realistic fixture pairings, likely high single digits to low teens). Equity on the $600 pot: roughly **$175-185 vs the $46 fair share** — most of that from being sharp, with the trick deciding the sharp-vs-sharp race.

**The key insight from simulating 9 rule variants:** no point-value change fixes this. Cutting scorer 8→5, boosting outcome to 3, adding multipliers — the exploiter's edge stays 16-21pp in every variant, because the hole is in the *name matching*, not the point value. **The fix is product-level: only accept scorer picks that match a player on one of the two squads (the dropdown the app already has), applied to future picks only.** Once closed, simulated sharps finish within ~3pp of each other — fair among equals.

Also worth knowing: the trick becomes public the first time someone's bare "martinez" hits the board after kickoff — so the current state isn't even a stable secret, it's a race to who notices first.

**Bonus bug found while verifying this (live, hurts honest players today):** three mononym players were scraped into the squad data with a literal "null" surname — the dropdown inserts **"Casemiro null"**, **"Endrick null"**, **"Zizo null"** — and a pick saved that way scores **zero** when that player actually scores first (the matcher treats the extra word as a mismatch). Anyone who tapped Casemiro from the dropdown is currently holding a dead pick. Fixing the three roster rows (and re-checking saved picks) should happen regardless of any scoring decision.

---

## Part 3 — Exploit #2: the tiebreaker punishes playing the game

The rules page says ties are broken by "**earliest pick submission** — decisiveness pays." The code actually uses the **newest edit timestamp across ALL your picks, oldest wins** — and *every* save refreshes it, including re-saving without changing anything. Three player-facing texts promise "edit as often as you like until kickoff" with zero warning that an edit (or a pointless re-save) torpedoes your tiebreak.

Consequences, verified to the line:

- A leader who tweaks one pick after lineup news loses a tie created weeks earlier. Booster moves cost nothing; pick edits cost everything — backwards.
- The leaderboard API broadcasts everyone's tiebreak timestamp every 30 seconds, so a savvy player can *watch* rivals' timestamps and manage their own.
- There's an undisclosed 5th tiebreaker: earliest signup wins. A literal coin-flip favoring whoever tapped the invite link first.
- How often does this matter? With near-identical odds-followers in the pool, simulated money-boundary ties through all announced tiebreakers ranged from **~2.5%** (humans who mostly agree) to **~78%** (pure clones). It's a real, recurring event — and it decides up to $180 (1st vs 2nd).

**Fix (no points change, forward-fair):** tiebreak = most exact scores → most scorer hits → most correct outcomes → **split the money**. Friends pool: splitting an unbreakable tie is the only rule nobody can game. Fix the copy, stop refreshing the timestamp on no-op saves, stop publishing it.

---

## Part 4 — Exploit #3 + design wrinkles

**Booster timing (medium).** Boosting your highest-expected-value pick (in practice: usually the biggest favorite of the day) is a near-no-decision dominant strategy worth **+13–15 points over the tournament** vs random placement — fine, that's skill-ish. Two real wrinkles: (1) waiting until the last second before kickoff is strictly optimal (the booster becomes an attention tax favoring app-babysitters — disclose it or lock placement at the day's first kickoff; I lean disclose-and-keep, it's announced behavior and the edge is mild); (2) **bug-grade hole:** picks lock the instant a result exists, but the booster doesn't check result status — if a result is ever entered before kickoff time, a player can park ×2 on *known* points. One-line guard, should be fixed regardless.

**Underdog bonus (currently a fib).** Every scoring table advertises "+5 underdog bonus," but the auto-flag is OFF and no match has ever been flagged — players pricing it into upset picks are earning a bonus that doesn't exist. Decision needed: remove the copy, or arm it honestly. **Warning if arming it:** the built-in threshold ("≤25% to win") would have flagged **16 of 19** real group matches — that's not "special upsets," that's almost everything — and at +5 it genuinely flips the *optimal* pick to the underdog side for matches in the 22-25% band (verified analytically). At a **≤15%** threshold, +5 never distorts optimal play (a flip would need +10) — it becomes a pure fun lottery on true minnows. That threshold is one constant in the code.

**Admin powers (governance, not accusation).** Fabian referees a pool he plays in (second account), and the app gives the whistle some unguarded levers, with **no audit trail for any of them**: flag/unflag an underdog *after* full-time (mints ±5×booster×round with all picks visible — verified, no time guard); enter a result before kickoff (force-locks everyone's picks early — the picks themselves stay hidden until kickoff, but the result and points go public immediately); silently edit results; change any scoring rule with **automatic retroactive rescoring of all finished matches** while the rules page silently rewrites itself; hard-delete a member and every trace of their picks. Nobody thinks Fabian's rigging $600 — but with money on the line the *appearance* of integrity matters, and right now a dispute would be unresolvable because nothing is logged. Cheap fixes later (audit log, freeze underdog at kickoff, results only after kickoff); free fix now (group-chat governance: every settings change announced 24h before it's saved; results come from ESPN only).

**Sock puppets (low-likelihood, worth a sentence).** Registration is open and the invite link is shared — a second account = a second entry = double the lottery tickets in a winner-take-most pool. With 13 friends it's socially detectable; announce "roster is locked, new faces need group approval" and it's handled.

**Pot display.** The league's buy-in field was never set, so the app shows a $0 pot. Setting buy-in to $25 makes the real ~$600 show up — pure cosmetics, zero scoring impact, instant credibility.

---

## Part 5 — Recommended design ("REC-MIN")

**Philosophy: change nothing that rescores the past; fix the exploits; buy comebacks for the knockouts.** All banked points stay exactly as they are — the app's retroactive-recompute behavior never fires on this package.

| # | Change | Why | Retroactive? |
|---|--------|-----|--------------|
| 1 | **Scorer picks must be a real player from the match's squads** (server enforces the dropdown) | Kills the surname trick — the one edge that survives every scoring tweak | No — future picks only |
| 2 | **Tiebreak: exacts → scorer hits → correct outcomes → split the cash**; fix copy; stop no-op timestamp refresh; stop publishing timestamps | Current tiebreak is mis-documented, gameable, and surveillance-prone | No — points untouched |
| 3 | **Knockout multipliers, announced now, live June 28:** R32 ×1.5, R16 ×1.5, QF ×2, SF ×2.5, 3rd-place ×1.5, Final ×3 | Comebacks: P(group-stage leader just cruises to the title) drops 55%→39%; money-deciding ties collapse (3.8%/0.7%); July stays dramatic | **No by construction** — group stays ×1, and no knockout match has been played |
| 4 | **Underdog bonus: arm it honestly at ≤15% + 5 pts** (or delete the copy) | Keeps the advertised rule real without distorting optimal play; pure minnow-lottery fun | Forward; optionally retro-honor any matchday 1-2 upset that would have qualified — transparent goodwill |
| 5 | **Booster: keep ×2 move-until-kickoff; add "no boosting finished matches" guard; one line of rules copy that late moves are legal** | Closes the known-result hole; ends the secret-dominant-strategy asymmetry | No |
| 6 | **Governance:** buy-in $25 displayed; settings changes announced 24h ahead; results from ESPN only; roster locked; (later: audit log + kickoff guards on admin levers) | $600 deserves receipts | No |
| 7 | **Base points stay 10 / 2 / 8 / 2. Cheat sheet stays.** | The values are fine once the holes are closed — keeping scorer at 8 actually *helps* casuals (more variance = more upsets); the cheat sheet democratizes the "sharp" strategy | — |

**Simulated outcome of this package** (1,500 tournaments, fully corrected simulator): three equally-sharp players finish within **1.5pp** of each other (vs a +15pp edge for an exploiter today); casuals keep a **9–14%** podium hope; the group-stage leader wins only **37%** of the time (down from 56%) so the knockouts genuinely matter; unbreakable money ties: **0.7%** (and those split the cash).

**Worth discussing (genuine taste calls, not math calls):**
- Scorer 8 vs 5: with the hole closed, 8 is the casual-friendly, drama-friendly choice (recommended keep); 5 makes grinding skill matter slightly more.
- Booster lock-at-first-kickoff vs movable: movable is more fun and already announced; lock only if the group hates attention-tax dynamics.
- Final ×3 vs ×4: ×4 adds one more coin-flip on the last day; ×3 keeps the season meaningful (recommended).

## Part 6 — Mid-tournament fairness & the announcement

**Principles:** (1) banked points never change — and this package guarantees it mechanically, not just by promise; (2) every change is announced *before* it takes effect, with the reason; (3) exploit closures get framed as "we found loopholes and closed them before they mattered" — no shaming, the tournament is 2 matchdays old; (4) anything ambiguous resolves in players' favor (e.g., retro-honoring qualifying underdog upsets).

**Why now is the perfect window:** only ~4–6 of 104 matches are scored. Every day of delay raises the stakes of any change and the value of the loopholes. The knockout-multiplier announcement *must* land before June 28 to be free.

**Draft announcement (Fabian's voice, group-chat ready):**

> ⚖️ **VAR REVIEW COMPLETE.** We ran a full audit of the scoring engine (with actual simulations, because we are deeply unserious people with serious tooling). Three rulings, effective immediately:
>
> 1️⃣ **Scorer picks now have to be an actual player from the match** (pick from the list). Turns out typing just "martinez" vs Argentina counted for THREE different Martínezes. Whoever was about to figure that out — too slow. 🟥
>
> 2️⃣ **Tiebreaker fix.** The fine print said "earliest pick wins ties" but the app was actually punishing anyone who *edited* a pick. New tiebreakers: most exact scores → most scorer hits → most correct results → we split the cash like gentlemen.
>
> 3️⃣ **Knockouts get spicy (from June 28):** R32/R16 ×1.5, QF ×2, SF ×2.5, Final ×3. Group stage points are banked and untouchable — but nobody's cruising to the title in June. 🏆
>
> Bonus ruling: the +5 underdog bonus is now REAL (true minnows only — ≤15% to win, auto-flagged from the odds before kickoff). And the pot now actually says $600 instead of $0, you're welcome.
>
> Nothing already scored changes. Every point you've banked is yours. Objections to the ref? File them in writing. The ref does not read. ⚽

## Part 7 — Verification (what the skeptics found)

Three independent verification agents attacked the simulation code and re-derived every headline number with their own methods. All numbers in this report are post-correction. Specifically:

- **Confirmed exactly:** model calibration vs the de-vigged market; the 0.45 pts/match sharp-vs-casual gap (re-derived closed-form, agreed to ±0.002); the underdog math (16/19 matches flagged at ≤25%; the +5 flips optimal picks in the 0.22–0.25 band; England-Croatia flips at exactly bonus 7); the knockout-multiplier comeback effect; the tie-rate findings.
- **Found & fixed — simulator bug:** the first-scoring-team sampler was inconsistent with the scoreline it had just produced (favorite-first ~4.7pp too often). Corrected; favorite-leaning strategies dropped ~0.13 pts/match, underdog picks gained ~0.13; no ordering or conclusion changed.
- **Found & corrected — overstated headline:** the surname-exploit value of +0.11 pts/match was partly an artifact of random squad-to-fixture pairing and a roster data bug; the honest name-matched number is **+0.04 pts/match** (~4–6 pts/tournament), with the tournament win-probability edge revised from "+16–21pp" to "**+15pp upper bound, likely high single digits to low teens**." Direction and persistence across all rule variants were confirmed — only the size shrank.
- **Found — real app bug:** the "Casemiro null" roster rows (Part 2), which make honest dropdown picks of three real players unscoreable. This came out of chasing why "null" was a top colliding token.
- **Known residual limits:** scorer probabilities use position-based weights without a "talisman" boost (flattens star players; this *overstates* the surname exploit somewhat, reinforcing that the corrected number is the right one to use); knockout simulations pair random squads because real brackets aren't known yet; 90-minute scorelines only (no extra-time modeling).

**Model provenance.** During the analysis the AI model briefly fell back from Fable 5 to Opus 4.8 (a ~10-minute upstream availability blip, confirmed in session transcripts). The fallback window touched the first drafts of two simulation files and partial output of two of the six audit agents. All of it was subsequently re-verified on Fable 5: the simulation files were line-audited, re-run, and corrected by the (fully Fable 5) verification pass, and the twelve load-bearing claims from the two affected audit lenses were independently re-verified by Fable-5-pinned agents (9 confirmed exactly, 3 confirmed with the minor corrections reflected above). Every number and claim in this report carries Fable 5 provenance — authored by it, or verified and corrected by it.

## Appendix — artifacts

- Audit reports: `scratch/audit/*.md` (config, access, scorer, announced rules, tiebreak, data inventory)
- Simulator: `scratch/sim/*.mts` (imports `src/lib/scoring.ts` + `src/lib/odds.ts` directly; fidelity-checked in `engine-check.mts`; `expFinal.mts` = corrected headline runs)
- Real odds sample: `scratch/sim/real-odds.json` (19 WC2026 group matches, DraftKings via ESPN, fetched 2026-06-11)
- Surname-exploit census: `scratch/scorer-audit/results.json`
- Verification artifacts: `scratch/verify-code/`, `scratch/verify-rederive/`, `scratch/verify-rates/`
- Model calibration: `node scratch/sim/validate-model.mts` (reproduces the de-vigged market to ±0.07pp; P(0-0)≈8%, draws≈22%, modal score 8–18% — in line with World Cup base rates)
