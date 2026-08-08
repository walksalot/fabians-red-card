export const meta = {
  name: 'qa-round',
  description: 'One adversarial QA round: 12 user-simulating browser testers, adjudication, skeptic verification, scoring',
  whenToUse: 'Invoked once per QA iteration with args {round}',
  phases: [
    { title: 'Test', detail: '12 browser testers, each a distinct user mission' },
    { title: 'Adjudicate', detail: 'dedupe and cluster all raw findings, propose severity' },
    { title: 'Verify', detail: 'skeptics reproduce every cluster; S1/S2 get a second skeptic' },
  ],
}

const ROUND = args.round
const ROOT = args.repoRoot || '/home/user/fabians-red-card'
const BRIEF = args.brief || `${ROOT}/qa/BRIEF-REMOTE.md`
const PRIOR = args.priorNote || 'This is the first round; there are no earlier rounds.'

const MISSIONS = [
  { key: 'first-run', title: 'First run & home screen', brief: `You are a brand-new visitor who just got the link. Clear localStorage first. Home screen at several sizes, the How-to-play rules read end to end (every word - typos, wrong rule statements vs the brief's rules, layout), resume behaviour (no saved game = no resume card; save a game mid-turn, reload, resume from home and check EVERYTHING came back), manifest.json + icon load, service worker registers, second visit works. Also the menu sheet from every screen: every row does what it says.` },
  { key: 'roster', title: 'Setup: players & roster', brief: `Everything about people. Add/remove players (bounds 2-8 enforced honestly?), rename, placeholder names, the Skip photo toggle, starting with photos outstanding (blocked with honest copy?). The guest list ("Played before" chips): seat a person, forget a person, edit mode toggle. Saved avatars per name: pick a photo (generate a tiny PNG file and set it on the file input via setInputFiles - that is how a real user picks a photo), rename the row, check the avatar library offers it back under the name. Duplicate names, emoji names, 40-character names, whitespace names. Start a game and confirm the roster carried through to play/scoreboard.` },
  { key: 'setup-options', title: 'Setup: modes, deck, house rules, buy-in', brief: `The rest of setup. Mode rows select and describe correctly; co-op reveals the mistake stepper. Target stepper (5/10/15 + session hints), streak toggle, buy-in: switch, $ stepper (clamps at 0 and at the top), pot line arithmetic at 2..8 players (add/remove players while buy-in is visible - does the pot line follow?), Venmo handle field (paste a full venmo.com URL, an @handle, garbage - what does setup accept and what does the winner screen later do with it? Play a fast 5-card 2-player game to see). Deck & playback foldout: decade/genre chips, All-chips, eligible-count arithmetic, deck warning when filters starve the deck, the summary line when folded. Playback source select.` },
  { key: 'classic-game', title: 'Classic gameplay, end to end, twice', brief: `Play TWO full classic games through the UI like a family would: pass screens, draw, gap selection (the selected gap visibly widens/marks?), place, reveal (year/title/artist/verdict/strip/belongs line), next player, win screen (winner, timeline, confetti, play again). Game 1: 2 players to 5 cards, place honestly (compute correct gaps from the debug seam). Game 2: 4 players to 10, make deliberate mistakes and watch discards, turn order, progress counters (N/target), the roster rail (active/next/leader flags move correctly), scoreboard mid-game from the menu. Verify win triggers exactly at the target, not one early or late. Play-again returns to setup with the roster intact.` },
  { key: 'tokens-bets', title: 'Tokens: challenge, buy, name-it', brief: `The token economy through the UI. Challenge: open sheet, pick a challenger (only players with tokens offered?), pick a gap on the challenger's OWN timeline, confirm, then reveal - card moves to a right challenger, token spent on a wrong one, remove-challenge refunds before reveal. Multiple challengers same turn. Buy a card (needs 3 tokens - earn them first via name-it claims, or play until someone has 3): buys without a guess, streak resets. "I can name it": claim before reveal, the confirm panel appears after, Title/Artist votes award +1 only when both confirmed, at the token cap the award reads honestly (+0). Token pills everywhere match the seam's token counts after every one of these.` },
  { key: 'adv-expert', title: 'Advanced & Expert modes', brief: `Advanced: right gap alone is NOT enough - the title/artist confirmation gates keeping the card; wrong gap discards regardless; verify both paths and that the verdict copy matches. Expert: the year stepper appears, exact year = bonus per rules, wrong year with right gap still keeps the card (check the actual rule in the reveal copy and the engine outcome via the seam - any mismatch between what the UI says and what happened is a finding). Full short game in each mode. Check the rules screen describes these modes the same way the game behaves.` },
  { key: 'coop', title: 'Co-op mode', brief: `Full co-op games: one shared timeline (rail shows a team box, not ranked seats?), shared token pool (cap 6 - fill it via name-it and check the +0-at-cap copy), mistake limit counts every miss and the loss screen arrives exactly at the limit, win at the target, End-game-early copy is honest ("stopped early", not a fake defeat). The recap on the win screen collapses decades to one shared row. Pass screens in co-op (standings vs team box). Resume a co-op game mid-turn after reload.` },
  { key: 'persistence', title: 'Persistence, resume & sabotage', brief: `Reload the page at EVERY phase (turn-start, listening, placing, after placing, revealed, between turns, game over) and resume: state, screen, roster photos, tokens, challenges-in-flight all survive? Settings persist (sound, skip-pass, reduced motion, playback source). Buy-in and streak survive. Then sabotage localStorage like a hostile/unlucky browser: truncate the saved game JSON, wrong version number, giant garbage strings, delete single keys - the app must come back as a sane fresh state, NEVER a blank page or a crash loop. Private-mode simulation: block storage (context with storageState issues) if you can. Two tabs open at once on the same game - document what happens (data races are findings).` },
  { key: 'qr-listen', title: 'QR & the listen page', brief: `The play screen's QR block: renders an actual QR (SVG), the alt/QR toggle works, the file:// warning only shows when relevant. Decode the QR: read the payload from the DOM/seam, extract the /listen.html URL, open it in a second page - the listen page must show a play button and NOTHING that spoils year/title/artist. Its player UI, its copy, its errors when the payload is garbage or truncated (hand-mangle the URL params). Streaming-links row on the play screen: correct links, open in new tab, no year leak in visible text. listen.html directly with no params = honest empty state, not a crash.` },
  { key: 'a11y', title: 'Accessibility & keyboard', brief: `Keyboard-only: reach and operate every control on every screen (Tab order sane after screen changes? focus moves to the new screen's heading?). Sheets: Escape closes, focus goes into the sheet when opened and BACK to the opener on close; aria-modal claimed - is focus actually trapped inside while open (Tab from last element)? aria-pressed on every toggle reflects state. aria-live regions announce turn changes/verdicts (inspect the DOM). Buttons all have accessible names (icon-only buttons especially). prefers-reduced-motion honored when the setting is on (flip/confetti/disc spin). Contrast spot-checks with getComputedStyle where the design looks risky (hint text on paper, verdict pills). Zoom 200% - still usable?` },
  { key: 'responsive', title: 'Responsive & visual sweep', brief: `Every screen at 320x568, 375x667, 393x852, 428x926, iPad 820x1180 and 1024x1366 landscape. Horizontal overflow anywhere = finding. Screenshot each screen at each size and LOOK at them: clipped text, overlapping elements, buttons off-viewport, the timeline strip with 1 card and with 10+ cards, 8-player roster rail, long names (25+ chars) in every place a name renders, the win screen with a huge pot number, the reveal with a very long song title. Rotate mid-game (landscape) - anything vanish? The fixed bottom bars never cover interactive content?` },
  { key: 'perf-network', title: 'Performance & network truth (CDP)', brief: `Use Chrome DevTools Protocol via Playwright (page.context().newCDPSession(page), Network/Performance domains) against the target. First visit cold: total transferred bytes, request count, anything fetched twice, anything 4xx/5xx, largest assets. Second visit warm: the service worker must serve the shell (near-zero network for app files - verify via Network events which requests hit the network). Reload offline (context.setOffline(true)) after one online visit: the app must fully load from the worker. Audio preview fetch: watch the actual response codes/bytes when tapping play. CPU-throttle 4x (Emulation.setCPUThrottlingRate) and click through setup->play: anything that becomes unusable (not merely slower) is a finding. Report real numbers.` },
  { key: 'chaos', title: 'Chaos user: race conditions & abuse', brief: `Be the drunk uncle. Double/triple-tap every primary button fast (place twice = double placement? next-player twice = skipped turn?). Tap during animations (flip mid-transition, confetti). Spam gap selection rapidly. Open both sheets at once via fast taps. Browser back/forward mid-game. Refresh spam during reveal. Start a new game from the menu mid-game (saved state trashed?). Type into steppers-adjacent inputs while stepping. Venmo handle field: 500 chars, URLs with credentials, script tags (any sign of injection anywhere text renders = S1). End game from the menu at every phase. Empty-deck endgame: filter the deck to near-minimum in setup, play until the deck runs dry - the game must end honestly, not hang.` },
]

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings', 'coverage'],
  properties: {
    coverage: { type: 'string', description: 'What you actually tested, honestly, including what you ran out of time for' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'severity', 'repro', 'expected', 'actual', 'impact', 'confidence'],
        properties: {
          title: { type: 'string', description: 'One line, specific: "X does Y when Z"' },
          severity: { enum: ['S1', 'S2', 'S3', 'S4'] },
          repro: { type: 'array', items: { type: 'string' }, description: 'Exact minimal steps from a fresh page' },
          expected: { type: 'string' },
          actual: { type: 'string' },
          impact: { type: 'string', description: 'Why a family playing tonight cares, one sentence' },
          evidence: { type: 'string', description: 'Screenshot path and/or console text; empty string if none' },
          confidence: { enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
}

const CLUSTERS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['clusters'],
  properties: {
    clusters: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'severity', 'repro', 'expected', 'actual', 'sources', 'rationale'],
        properties: {
          id: { type: 'string', description: 'kebab-case slug, stable and descriptive' },
          title: { type: 'string' },
          severity: { enum: ['S1', 'S2', 'S3', 'S4'], description: 'YOUR proposed severity per the rubric, not the reporters average' },
          repro: { type: 'array', items: { type: 'string' }, description: 'The best minimal repro among the merged reports' },
          expected: { type: 'string' },
          actual: { type: 'string' },
          sources: { type: 'array', items: { type: 'string' }, description: 'area:title of each merged raw finding' },
          rationale: { type: 'string', description: 'Why this severity; why these reports are the same defect' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reproduced', 'verdict', 'severity', 'reason'],
  properties: {
    reproduced: { type: 'boolean', description: 'You personally made it happen in your own browser session' },
    verdict: { enum: ['CONFIRMED', 'REFUTED', 'BY_DESIGN', 'NOT_REPRODUCIBLE'] },
    severity: { enum: ['S1', 'S2', 'S3', 'S4'], description: 'Your final severity if confirmed; repeat the proposal otherwise' },
    reason: { type: 'string', description: 'What you did, what you saw, why the verdict follows' },
  },
}

const testerPrompt = (m) => `You are a QA tester simulating a real user on a live party-game site, round ${ROUND}.

FIRST: Read ${BRIEF} in full. It has the launch config, the target URL, the rules of engagement, the severity rubric, and the list of by-design behaviours you must not report.

${PRIOR}

YOUR MISSION - ${m.title}:
${m.brief}

Method: write one or more throwaway Playwright scripts under scratch/qa/round-${ROUND}/${m.key}/ (create the dir), run them FROM THE REPO ROOT (${ROOT}), iterate as you learn. Interact ONLY through the visible UI like a human. Screenshot evidence for every finding into that dir. Read your screenshots. Spend roughly 12-18 minutes of real testing; breadth first.

Also: keep a running eye on pageerror/console-error output in every session - an unexplained page error is always at least an S3 finding even if the UI looks fine.

Return (as structured output) your findings per the schema. Zero findings is an acceptable answer if that is the truth; padded findings will be refuted by adversarial review and waste everyone's time. Do NOT edit any app file. Do NOT commit.`

const adjPrompt = (all) => `You are the QA adjudicator for round ${ROUND} of a party-game site. Read ${BRIEF} for the severity rubric and by-design list.

Below are ALL raw findings from 12 independent testers, as JSON. Your job:
1. DEDUPE: merge reports that describe the same root defect (the same bug seen from two screens is ONE cluster; two different bugs on the same screen are TWO).
2. DISCARD anything that is by-design per the brief, or is not a defect claim at all (praise, questions, coverage notes) - simply leave it out.
3. For each surviving cluster, propose the severity the rubric actually supports - reporters routinely inflate. Money math, crashes, data loss, wrong game outcomes are the only S1s.
4. Pick the best minimal repro among the merged reports.

Be skeptical but do not verify in a browser - verification is the next phase's job. Return every plausible cluster; dropping a real defect here is worse than passing a dud to verification.

RAW FINDINGS:
${JSON.stringify(all, null, 1)}`

const skepticPrompt = (c, nth) => `You are adversarial QA verifier #${nth} for round ${ROUND}. Your default stance: the finding below is WRONG - exaggerated, by-design, or not reproducible. Try to refute it.

FIRST read ${BRIEF} (launch config, rubric, by-design list). Then attempt the repro EXACTLY as written in your own fresh browser session (script under scratch/qa/round-${ROUND}/verify-${c.id}-${nth}/, run from the repo root ${ROOT}, UI-only interaction). If the exact steps fail, try the obvious nearby variations once or twice - a finding that only reproduces with steps materially different from those reported should be REFUTED with the working variation noted in your reason.

Verdicts:
- CONFIRMED: you reproduced it and the rubric supports a severity (state which).
- REFUTED: the claim is factually wrong or materially exaggerated.
- BY_DESIGN: it reproduces but the brief's by-design list or the game rules cover it.
- NOT_REPRODUCIBLE: honest attempts (3+) failed.

Severity: apply the rubric coldly. Downgrades are expected; upgrades need hard evidence.

THE FINDING:
${JSON.stringify(c, null, 1)}`

phase('Test')
const reports = await parallel(MISSIONS.map((m) => () =>
  agent(testerPrompt(m), { label: `test:${m.key}`, phase: 'Test', schema: FINDINGS_SCHEMA })
))
const paired = reports.map((r, i) => ({ r, m: MISSIONS[i] })).filter((x) => x.r)
const all = paired.flatMap(({ r, m }) => r.findings.map((f) => ({ ...f, area: m.key })))
const coverage = paired.map(({ r, m }) => ({ area: m.key, coverage: r.coverage }))
log(`${all.length} raw findings from ${paired.length}/12 testers`)
if (all.length === 0) return { round: ROUND, raw: 0, clusters: [], confirmed: [], coverage }

phase('Adjudicate')
const adj = await agent(adjPrompt(all), { label: 'adjudicate', phase: 'Adjudicate', schema: CLUSTERS_SCHEMA })
const clusters = (adj && adj.clusters) || []
log(`${all.length} raw -> ${clusters.length} clusters after dedupe/discard`)

phase('Verify')
const verified = await parallel(clusters.map((c) => () =>
  agent(skepticPrompt(c, 1), { label: `verify:${c.id}`, phase: 'Verify', schema: VERDICT_SCHEMA })
    .then((v) => ({ ...c, v1: v }))
))
const first = verified.filter(Boolean)

// Second, independent skeptic for anything still standing at S1/S2 - a
// Critical/Major needs two people to have reproduced it before we spend a fix on it.
const high = first.filter((c) => c.v1 && c.v1.verdict === 'CONFIRMED' && (c.v1.severity === 'S1' || c.v1.severity === 'S2'))
log(`${high.length} S1/S2 candidates go to a second skeptic`)
const second = await parallel(high.map((c) => () =>
  agent(skepticPrompt({ ...c, severity: c.v1.severity }, 2), { label: `verify2:${c.id}`, phase: 'Verify', schema: VERDICT_SCHEMA })
    .then((v) => ({ id: c.id, v2: v }))
))
const secondById = new Map(second.filter(Boolean).map((x) => [x.id, x.v2]))

const SEVERITY_ORDER = { S1: 1, S2: 2, S3: 3, S4: 4 }
const finalise = (c) => {
  const v1 = c.v1
  if (!v1 || v1.verdict !== 'CONFIRMED') return { ...c, final: v1 ? v1.verdict : 'NO_VERDICT', severity: c.severity }
  const v2 = secondById.get(c.id)
  if (!v2) return { ...c, final: 'CONFIRMED', severity: v1.severity, reason: v1.reason }
  if (v2.verdict !== 'CONFIRMED') {
    // Split decision on an S1/S2: keep it, but at S3 - two people disagreeing
    // about a Critical means it is at least a real ambiguity worth fixing.
    return { ...c, final: 'CONFIRMED', severity: 'S3', reason: `SPLIT: v1 ${v1.severity} CONFIRMED (${v1.reason}) / v2 ${v2.verdict} (${v2.reason})` }
  }
  const sev = SEVERITY_ORDER[v1.severity] >= SEVERITY_ORDER[v2.severity] ? v1.severity : v2.severity
  return { ...c, final: 'CONFIRMED', severity: sev, reason: `v1: ${v1.reason} | v2: ${v2.reason}` }
}
const finals = first.map(finalise)
const confirmed = finals.filter((c) => c.final === 'CONFIRMED')
const rejected = finals.filter((c) => c.final !== 'CONFIRMED').map((c) => ({ id: c.id, title: c.title, outcome: c.final, reason: c.v1 ? c.v1.reason : 'verifier died' }))

const POINTS = { S1: 13, S2: 8, S3: 3, S4: 1 }
const score = confirmed.reduce((s, c) => s + POINTS[c.severity], 0)
const bySev = { S1: 0, S2: 0, S3: 0, S4: 0 }
for (const c of confirmed) bySev[c.severity]++
log(`ROUND ${ROUND}: ${confirmed.length} confirmed (S1:${bySev.S1} S2:${bySev.S2} S3:${bySev.S3} S4:${bySev.S4}) = ${score} points`)

return { round: ROUND, raw: all.length, clusterCount: clusters.length, confirmed, rejected, score, bySev, coverage }
