# Music Timeline

A phone-based, Hitster-style party game: build a timeline of 10 correctly
year-ordered song cards. A mystery song plays (30-second iTunes preview); the
active player places it into a gap in their timeline; the reveal shows the
year — right means keep it, wrong means discard. Tokens buy challenges,
"I can name it" bonuses, and outright card purchases. Modes: classic,
advanced (name title + artist to keep), expert (also the exact year), and
co-op (one shared timeline). Optional $2/head Venmo buy-in — the app shows
the pot and a scan-to-pay QR but never touches money. One phone passes around
the table; a QR on the play screen opens a spoiler-free listen page on other
phones. Everything runs client-side: no framework, no build step, no server
state — "nothing leaves this phone."

**Live:** https://music-timeline-walksalots-projects.vercel.app/index.html

## Run it

```bash
npm install        # dev tooling only (vitest); the game itself has zero deps
npm run music      # zero-dep LAN server, prints a scannable QR of the address
npm test           # the unit suite (engine, deck, QR, storage, buy-in, SW, UI)
npm run check-design   # design conformance vs the Claude Design prototype spec
```

`file://` does not work — browsers refuse ES-module imports off disk. Use
`npm run music`.

## Layout

- `public/music/` — the whole app: dependency-free static ES modules.
  `index.html` (DOM contract in its header comment), `app.css` (the
  "record-sleeve pop" design), `ui.js` (controller), `engine.js` + `.d.ts`
  (pure seeded reducer holding all rules), `deck.js` (1,080 cards,
  1955–2024), `audio.js` + `previews.json` (build-time iTunes preview
  resolution; load-bearing for offline), `qr.js` (from-scratch QR encoder),
  `storage.js` (versioned quota-safe localStorage), `buyin.js`
  (integer-cents pot math + Venmo link), `sfx.js`, `confetti.js`, `sw.js`
  (offline precache), `listen.html/.js/.css` (the scanned phone's page).
- `scripts/` — `music-server.mjs`, `resolve-previews.mjs` (rebuild
  previews.json), `audit-deck.mjs`, `check-design.mjs`.
- `tests/unit/` — the unit suite (Vitest, node environment).
- `qa/` — the adversarial browser-QA harness (13 user-simulating browser
  agents → adjudicator → adversarial verifiers, severity-scored) and its
  round results.
- `docs/MUSIC-TIMELINE-HANDOFF.md` — the cross-machine handoff map this
  repo was consolidated from.

## Provenance and upstream

This is the game's **official project home** (Kris, 2026-08-08). The game was
born inside [walksalot/fabians-red-card](https://github.com/walksalot/fabians-red-card)
(a World Cup prediction-pool site) and grew there through
[PR #18](https://github.com/walksalot/fabians-red-card/pull/18) →
[#22](https://github.com/walksalot/fabians-red-card/pull/22) plus
post-merge adversarial-QA fix rounds. Its full 18-commit history was
extracted path-preserving with `git-filter-repo` on 2026-08-08 from the
campaign branch `claude/phone-music-timeline-game-c96gtw` (tip `13a48fb`).

An adversarial QA campaign was still in flight upstream at extraction time
(round 3 of a converge-to-zero-Critical/Major loop, run by the cloud session
"Game - song era dates"). Until that campaign concludes and lands its final
state here, re-sync by re-running the same extraction against the newer
upstream tip and merging — the procedure is deterministic:

```bash
git clone https://github.com/walksalot/fabians-red-card.git /tmp/extract-src
cd /tmp/extract-src && git checkout claude/phone-music-timeline-game-c96gtw
git filter-repo --force --path public/music --path qa \
  --path docs/MUSIC-TIMELINE-HANDOFF.md --path scripts/music-server.mjs \
  --path scripts/resolve-previews.mjs --path scripts/audit-deck.mjs \
  --path scripts/check-design.mjs --path-glob 'tests/unit/music-*'
cd <this repo> && git fetch /tmp/extract-src claude/phone-music-timeline-game-c96gtw
git merge FETCH_HEAD   # identical extracted commits merge cleanly
```
