# Music Timeline — project handoff map

Written for other sessions/machines consolidating this work (requested by the
"game-song-1" session on kris-mbp-m5). Canonical home of everything below is
THIS repo on GitHub — no machine's local disk holds anything unique.

## What it is

"Timeline" — a phone-based, Hitster-style party game. Build a timeline of 10
correctly year-ordered song cards. Each player starts with one face-up card and
2 tokens. A mystery song plays (30s iTunes preview); the active player places
it into a gap in their timeline; the reveal shows the year; right = keep,
wrong = discard. Tokens (cap 5): **Challenge** (spend 1 before the reveal,
nominate a gap on your own timeline, steal the card if you're right),
**"I can name it"** (title + artist confirmed by the group = +1 token),
**Buy a card** (3 tokens, no guess). Modes: classic; advanced (must name
title+artist to keep); expert (also the exact year); co-op (one shared
timeline, shared 6-token pool, mistake limit). Opt-in house rule: streak bonus
(three kept in a row = +1 token). Informal $2/head Venmo buy-in: the pot is
shown at setup, the winner screen shows pot + payee + a scan-to-pay QR for ONE
share; the app never touches money. One phone passes around the table; a QR on
the play screen opens a spoiler-free listen page on other phones.

## Where everything lives (this repo)

- `public/music/` — the whole app: dependency-free static ES modules, no
  framework, no build step. `index.html` (DOM contract in the header comment),
  `app.css` ("record-sleeve pop" design), `ui.js` (controller), `engine.js`
  (+`.d.ts`; pure seeded reducer holding all rules), `deck.js` (1,080 cards,
  1955–2024), `audio.js` + `previews.json` (build-time iTunes preview
  resolution; load-bearing for offline), `qr.js` (from-scratch QR encoder),
  `storage.js` (versioned quota-safe localStorage), `buyin.js` (integer-cents
  pot math + Venmo link), `sfx.js`, `confetti.js`, `sw.js` (offline precache),
  `listen.html/.js/.css` (the scanned phone's page), `fonts/`, `manifest.json`,
  `icon.svg`, `apple-touch-icon.png`.
- `scripts/` — `music-server.mjs` (`npm run music`, zero-dep LAN server; the
  only supported local launch — file:// cannot work with ES modules),
  `resolve-previews.mjs` (rebuild previews.json), `audit-deck.mjs`,
  `check-design.mjs` (design conformance vs the Claude Design prototype).
- `tests/unit/music-*.test.ts` — 688 passing unit tests.
- `qa/` — the adversarial browser-QA harness (13 user-simulating browser
  agents → adjudicator → adversarial verifiers, severity-scored); results
  under `qa/results/`.

## Live deployment

https://music-timeline-walksalots-projects.vercel.app/index.html
(Vercel project `music-timeline`, team walksalots-projects; deploys are
byte-verified against this repo after each push.)

## State at time of writing

Live and playable. An adversarial QA loop is running: round 1 scored 93
(25 confirmed defects — all fixed), round 2 scored 40 unique confirmed across
two independent fleets (Mac Studio on real Chrome 151 with genuine AAC audio
playback + a container fleet) — all fixed and deployed. Round 3 in flight.
Convergence: zero Critical/Major and weighted ≤ 5, max 20 rounds.

Known open items: no recently-played-card avoidance between games; two-tab
play is guarded (stale tabs refuse to overwrite) but not synced; the deck
thins pre-1960. No Spotify playlists or external artifacts exist; previews
come from Apple's public iTunes API at build time.
