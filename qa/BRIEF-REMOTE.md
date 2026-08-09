# QA BRIEF — Music Timeline (read this fully before testing)

You are QA-testing a **live party game** the way a real person at a family
reunion would use it: on a phone, by tapping. You have a real Chromium browser.
Your job is to find real defects a family would hit tonight.

## The app in one paragraph

A Hitster-style music game served as static files. One phone is passed around.
Each turn a mystery song plays; the active player places it into their
year-ordered timeline by tapping a gap. Reveal shows the year; right = keep the
card, wrong = discard. First to the target (5/10/15) wins. Tokens buy
challenges (steal a misplaced card), "I can name it" claims (+1 token), or a
card outright (3 tokens). Modes: classic, advanced (must name title+artist),
expert (also call the exact year), co-op (one shared timeline, mistake limit).
Optional: streak bonus house rule, $2/head Venmo buy-in with a payout QR on the
winner screen.

## Target

- URL: `https://music-timeline-walksalots-projects.vercel.app/index.html`
  (listen page: `/listen.html` on the same origin)
- This IS the live production site on the real internet. Test it exactly as a
  family's phones would hit it.
- Append `?debug=1` to expose `window.__timeline.state` (read-only inspection
  seam). Append `&seed=<int>` for a reproducible deal.
- The app is 100% client-side. State lives in localStorage under
  `music-timeline:v1:*`. Clearing localStorage = brand-new visitor.

## Hard rules

1. **Drive the app only through the visible UI** — Playwright locator clicks,
   `fill`, real keyboard. NEVER `page.evaluate(() => el.click())` to reach
   something a user couldn't tap (hidden/covered elements are FINDINGS if a
   user needs them, not things to bypass). The one exception: reading
   `window.__timeline.state` or localStorage to *assert* what happened.
2. **No unit tests.** Browser only.
3. **Do not edit any app file.** You only read the app and write your report.
4. Work under `scratch/qa/round-<N>/<your-area>/` (create it). Save screenshots
   there for every finding. Run scripts FROM THE REPO ROOT
   (`/home/user/fabians-red-card`) or `@playwright/test` won't resolve.
5. Time-box yourself: breadth first, then depth on what looks suspicious.

## Launch config that works here (copy this)

```js
import { chromium } from '@playwright/test';
// Prefer real Google Chrome: it has the proprietary AAC decoder, so song
// previews actually PLAY, which the bundled open-source Chromium cannot do.
// Fall back to the bundled Chromium when Chrome is not installed.
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome' });
} catch {
  browser = await chromium.launch(); // add '--no-sandbox' only if launch demands it
}
const page = await browser.newPage({ viewport: { width: 393, height: 852 } }); // iPhone-ish
page.on('pageerror', (e) => {/* always record these */});
page.on('console', (m) => { if (m.type() === 'error') {/* record */} });
```

Useful checks users feel but don't name:
- Horizontal overflow: `document.documentElement.scrollWidth > clientWidth` = broken layout.
- After each navigation/action, screenshot; look at what you shot.
- Toggle switches are labels over hidden checkboxes — click the label like a
  human would: `page.locator('label:has(> #opt-buyin)')`.

## Absolute security rule

Never set `ignoreHTTPSErrors`, never pass `--ignore-certificate-errors`, and
never disable or weaken TLS certificate verification in any form, in any
script, even "temporarily to test something". If a TLS error blocks you,
report it as an environment note instead of bypassing it.

## Fast paths (so you don't burn time on setup)

- New game: home → **New game** → tap **Skip photo** on every row → **Shuffle & start**.
- The pass screen's continue button is `#btn-pass-continue`.
- On the play screen the big vinyl is `#btn-play-song` (drawing the card), gaps
  are `#timeline-strip [data-gap-index]`, place is `#btn-place`.
- Reveal → `#btn-next-player`. Win screen appears at the target.
- A correct gap for year Y: every gap where left neighbour ≤ Y ≤ right
  neighbour (read `__timeline.state` to compute; ties are always legal).
- Audio, and how to judge it honestly. Check once per session which browser
  you got: `canPlayType('audio/mp4; codecs="mp4a.40.2"')` on an audio element.
  - Real Chrome (returns "probably"/"maybe"): previews MUST actually play -
    after tapping play, `currentTime` advances and `paused` is false within a
    few seconds. Silence, a stuck ring, or a wrong failure message IS a
    finding. This is the single most user-visible feature of the whole game;
    test it on several different cards and both playback of a fresh card and
    the Replay button.
  - Bundled Chromium (returns ""): audible decode is impossible in that build;
    verify instead that (1) the audio element's src is a real
    audio-ssl.itunes.apple.com URL for the drawn card, (2) a 2xx/206 network
    response arrives for it, (3) the failure fallback copy is honest and
    skip/links still work. "Never became audible" alone is NOT a finding there.

## By design — do NOT report these

- Audio requires a tap first (browser autoplay rules).
- Offline = no previews (copy says so); a "demo timer" appears instead.
- Node "module type" console *warnings* (not errors).
- Photos never leave the device; there is no server, no accounts.
- The QR on the play screen opens `/listen.html` on another phone — on this
  test box that URL is a LAN address; the QR *rendering* and the listen page
  itself are testable, phone-scanning is not.
- The buy-in never charges money; it builds a Venmo deeplink only.

## Severity rubric (propose one per finding)

- **S1 Critical (13 pts)** — crash/blank screen; game unwinnable or stuck; data
  loss (saved game/roster/stake vanishes); money math wrong anywhere; a wrong
  game-rule outcome (right placement judged wrong etc.).
- **S2 Major (8 pts)** — a feature is broken but the game survives (challenge
  flow dead-ends, resume misses, recap wrong, QR broken, a mode misbehaves);
  serious a11y failure (trap, unreachable control); broken layout that hides
  controls at a common size.
- **S3 Minor (3 pts)** — visual defect, misleading copy, janky-but-recoverable
  flow, minor a11y (missing label, weak contrast), overflow that doesn't hide
  controls.
- **S4 Nit (1 pt)** — polish: spacing, wording, inconsistency, subtle
  animation issues.

## What a GOOD finding looks like

- Exact, minimal repro steps from a fresh page (include seed if relevant).
- Expected vs actual, one line each.
- Evidence: screenshot path, console/pageerror text.
- Honest confidence. If you saw it once and can't re-trigger it, say so.
- The user impact in one sentence — why a family playing tonight cares.

Report zero findings if you genuinely found none — do NOT pad. Padded or
non-reproducible findings get refuted in adversarial review and score nothing.
