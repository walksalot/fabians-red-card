# Fabian's Red Card — UI/UX Design Proposal
*2026-06-12 · produced by a 9-agent adversarial review (all Fable 5, provenance verified: 637/637 messages) · recommendations only, nothing implemented*

**How this was made:** a capture agent booted the demo app and produced 34 full-page screenshots covering every page in every state (including states production hasn't hit yet: live matches, leaderboard ties, all five admin screens). Six independent reviewers — each with a fresh context window, a single lens, your verbatim feedback, and your actual production screenshot — produced 85 findings. An adversarial judge then cross-examined every significant finding against the real code (it verified the reviewers' file:line citations one by one), killed the weak ones, resolved conflicts between reviewers, and flagged hidden costs. A synthesizer produced the unified proposal. Screenshot library: `scratch/ui-review/shots/` + `INDEX.md`.

---

## The North Star

> Every match card should answer its own question in one glance: **color belongs to state, never decoration** — red means live, emerald means you scored, amber means act now, gray means settled. The board reads top-to-bottom in the order a player actually thinks when they open the app: *what's happening right now → what needs me next → what already paid off.* A finished game must announce its verdict — final score, over, hit or missed — in one bright line, not in small fonts you dig through.

Your screenshot is the perfect diagnostic: the finished Canada card and the upcoming USA card have nearly identical visual weight, six different pill styles compete on one screen, the only "it's over" signals are the page's *most muted* chip, and the dead match owns the prime screen real estate while your actual question ("when does USA–Paraguay start, are my picks in?") sits below the fold.

---

## Part 1 — The two anchor issues (core redesign)

### 1a. Finished-game clarity: the Verdict Banner

Every finished card gets a full-width verdict strip directly under the score — the first thing after the fixture, no digging:

```
┌─────────────────────────────────────────────┐
│  🇨🇦 Canada      1 – 1      Bosnia & H. 🇧🇦   │   ← FULL TIME chip: solid light,
│  CAN          ╔════════╗            BIH      │     bold, highest-contrast element
│               ║FULL TIME║                    │     on the card (today it's the
│               ╚════════╝                     │     most muted chip on the page)
│ ┌─────────────────────────────────────────┐ │
│ │ ✗ No points — you said 2–1,             │ │   ← VERDICT BANNER (zinc, calm)
│ │   it ended 1–1                          │ │     or, on a hit:
│ └─────────────────────────────────────────┘ │     ✓ You scored +12 pts (emerald)
│   ✗ Score: 2–1 → was 1–1                    │
│   ✗ Scorer: Jonathan David → was Jovo Lukic │   ← itemized ✓/✗ per component,
│   ✗ First team: Canada → was Bosnia         │     so "how you hit or missed"
│                                             │     is explicit, with the actual
│   (team names + venue dimmed — the eye      │     answer shown on every miss
│    lands on score + verdict, not chrome)    │
└─────────────────────────────────────────────┘
```

Key rules baked in after adversarial review:
- **Misses are zinc/gray, never red** — red is reserved app-wide for LIVE (and the brand red card). A red miss would read as "something is happening."
- Hits use the emerald the app already taught you (breakdown chips), with the points total stated once, big.
- The banner + itemized list is built **once** and shared by Today and History, so the morning-after review reads identically to the full-time moment.
- Boosted finished cards keep their amber glow until FT only (today a finished boosted card stays the loudest thing on the board after the mechanic is spent — fixed).

### 1b. Board ordering: next game first

The board currently renders in raw kickoff order, so a finished morning game sits on top of tonight's unpicked game all day. New ordering, applied server-side:

```
LIVE NOW                          ← red label; live + locked-in-play games
  [🔴 live card, unchanged]
UP NEXT · kicks off 9:00 PM ET    ← this label + the first card's ✓/"Needs pick"
  [USA – Paraguay, picks ✓]          chip answers your exact load-time question
  [later games...]                   inside the first viewport
FINISHED                          ← dimmed label; settled games, verdict banners
  [Canada 1–1 Bosnia, ✗ no points]
```

- Labels only render when 2+ groups exist — a future-day browse or single-state day shows zero extra chrome.
- Edge cases adjudicated: yesterday's carryover in-progress match leads (it's live); when a match goes FT it re-sorts to FINISHED on the next 30-second poll, and the live ticker up top announces the result so the move never feels like losing information; the booster jump-scroll targets cards by ID, so reordering can't break it.

**One design tension, surfaced for your call** (the two analysis paths disagreed): an alternative treatment *collapses* finished cards to a one-line verdict row (score + points badge) that taps open. It maximizes compactness but hides the itemized breakdown behind a tap — and the breakdown is what the group screenshots for trash talk. **My recommendation: the always-visible banner** (sink + dim achieves the de-emphasis; nothing gets buried). If you'd rather have ultra-compact finished cards, the collapse variant is fully specced and cheap.

---

## Part 2 — Quick wins (small, high-impact, this week)

1. **Finished-pick verdict tinting** — the live board already colors your pick by quality (emerald exact / amber right-result / gray miss) but deliberately turns it OFF at full time. Extend the same tinting to finished cards (~15 lines; the precursor to the banner).
2. **"FULL TIME" chip goes loud** — solid light chip, bold, uppercase; currently it's visually identical to neutral chrome.
3. **Sink finished games below open ones** — the minimal version of 1b (one stable sort, no labels) can ship immediately.
4. **Contrast sweep** — measured (not eyeballed) failures: several 10–12px gray-on-dark text rows sit at 2.3–4.1:1 contrast vs the 4.5:1 floor — exactly your "small fonts, slow digging" complaint. Pure class swaps to one tier brighter, plus a "never zinc-500 below 12px" rule.
5. **iOS input zoom fix** — the pick form's inputs are 14px, which makes iOS Safari auto-zoom on every single pick and stay zoomed. One token (16px) kills it on the app's most repeated interaction.
6. **De-green the calm countdown** — "Locks in 1d 2h" currently wears the same emerald as "pick saved ✓" on the same card; success-color is for earned states only.
7. **Day-nav booster emoji → the real bolt icon** (one visual identity for the booster everywhere) and the unlabeled amber dot on the day nav becomes a labeled "Needs pick" micro-chip (it's currently explained only by a desktop hover tooltip — on a phone-only app).

## Part 3 — Endorsed broader improvements

**Social / trash-talk surfaces** (the app's actual soul):
- **Last place gets the inverse-podium treatment**: brand-red row tint + a visible red-card glyph + "holding the red card" caption. Today the marquee easter egg is a 12×10px hover-only icon — invisible on phones, in an app named after it.
- **"Day won: Marcus +24"** line in History day headers (gold chip when it's you). Cheap, weekly bragging fuel.
- **Ghost "you: 2–1" comparison** appended to rivals' expanded pick rows in the Table — uses only data the client already has; makes head-to-head comparison one-glance.
- **"Everyone's picks" sheet** on tapping a locked/finished match (current matchday first — that data already ships to the client; the full History version is deceptively expensive, so it's phased).
- **Prize-pool hero compresses to one line** once results exist, so standings start in the first viewport (the pot is news on day one, wallpaper by week two).
- **Profile badges**: render all five badges with locked/progress states (Sniper 2/3…) instead of only earned ones.

**Admin safety** (found visually, but these protect the $700 pot):
- **Admin scorer entry is free text** — and the matcher forgives *player* shorthand but not *admin* shorthand: an admin typing "Isak" against picks of "Alexander Isak" silently zeroes every correct 8-point pick. Fix: same squad-restricted combobox players get, plus a live "will match N picks" line. **This is the single most likely $700-affecting admin mistake.**
- **Settings rescore confirm-gate**: changing scoring values currently rescores all finished matches silently behind an unconditional "Settings saved" toast. Add an amber confirm step only when scoring fields changed.
- **Underdog radios stay live after kickoff** — contradicting the published "flags freeze at kickoff" rule. UI freeze + server guard with an explicit, labeled override (kept for genuine corrections).
- **In-play results hint**: "Auto-sync fills this at full time — saving now ends the match for everyone and banks points." (Currently nothing warns the admin.)
- **Knockout team entry**: per-stage accordions instead of today's 15,000px wall of 31 fixture selects (the smart-filtering half of that proposal was correctly killed as secretly huge).

**Platform & accessibility:**
- **PWA install support** (manifest + apple-touch-icon): your screenshot loses ~180pt to Safari chrome; home-screen mode recovers a full match card of viewport for a five-week daily ritual.
- ✓/✗ glyphs accompany all green/red signaling (color-blind safety), touch-target and type-size fixes per the contrast sweep.
- **Surface the hidden calendar feed** — a fully-built "add fixtures to your calendar" .ics endpoint exists with zero UI pointing at it. One Profile row.

**Onboarding:** one-time dismissible welcome banner after invite-link join ("picks lock at kickoff — tap your first match"), auto-dismissed on first saved pick. New members currently land cold on the densest screen in the app.

## Part 4 — One product decision needed (money rule, not UI)

The review caught a **genuine rules gap**: the Rules page says tied players "share the spot and split its prize money," but the payout display never tie-adjusts, and the copy doesn't define *which* money a 2-way tie for 1st splits. Standard pool practice: **tied players split the combined payouts of the places they cover** (two tied at 1st split 1st+2nd = $270 → $135 each; 3rd stays $30… scaled to your real $700 pot). The alternative reading (each gets half of 1st's money, 2nd's share vanishes) is clearly wrong but is what a literal reading allows. This needs: a one-sentence group ratification, then the rule codified in one tested helper that both the Rules page and the Table's payout chips render from. Until then the Table deliberately keeps vague-but-safe "split the prize" copy.

## Part 5 — Big bets (worth discussing, not pre-built)

- **Matchday Wrapped** — when a day's last match settles, a recap card: your day total, rank move ("4th → 2nd"), best hit, and the league's biggest blank ("Fabian: 0 pts 🟥"). The all-finished board is currently the app's deadest moment; this makes it the most screenshotted. Costs a rank-snapshot mechanism; best as the first post-redesign feature.
- **Per-match page** — tap a locked match → all 14 picks head-to-head with live ✓/✗. The watch-party screen. Real cost (new route + a second privacy-enforced endpoint); only worth it if you actually watch matches together.

## Part 6 — Considered and rejected (so you can see the road not taken)

- *Red borders/tints for misses* — red = live, everywhere; a red miss reads as "happening now."
- *Pinned duplicate "Up Next" hero above the list* — renders the same fixture twice per viewport; ordering + the group label does it with zero redundancy.
- *Moving finished games off Today entirely* — the just-finished verdict is Today's payoff moment; an emptying board at full time feels broken.
- *Light/white finished cards* — would outshout the live red ring and invert the urgency hierarchy.
- *Confetti on exact hits* — novelty decays over 39 days; competes with the board's single-heartbeat animation rule.
- *Removing the Rules tab* — it's the authority document for a $700 pot whose rules just changed; burying it during dispute season is exactly wrong.
- *Wholesale 4-family chip redesign* — taxonomy churn for 14 mid-tournament users; the one actionable kernel (the "How scoring works" trigger should look tappable) ships alone.

---

## Suggested sequencing

| Phase | Contents | Feel |
|---|---|---|
| 1 (days) | Quick wins 1–7 | "It got clearer overnight" |
| 2 (this week) | Verdict banner + ordering + shared History language | The screenshot complaint, fully dead |
| 3 (next week) | Admin safety + social surfaces + PWA + onboarding | Pot protected, trash talk fed |
| Decide separately | Tie-money rule (group vote) · collapse-vs-banner taste call · big bets | — |

*Methods footnote: one orchestration bug (a template placeholder) meant the six reviews reached the adversarial judge via journal recovery but not the synthesizer, which independently re-derived its proposal from the screenshots and code. The two paths converged on the same core design — independent convergence is the strongest signal in this document — and this report merges both, with conflicts resolved explicitly above.*
