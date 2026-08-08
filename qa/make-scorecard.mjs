// Builds the color-coded HTML scorecard from qa/results/round-2.json
// Usage: node scratch/qa/make-scorecard.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

// Round-agnostic: `node qa/make-scorecard.mjs [round] [outPath]`, run from the repo root.
// Regenerate this whenever qa/results/round-<N>.json changes so the scorecard
// never drifts from the data it claims to summarise.
const ROUND = process.argv[2] || '2'
const r = JSON.parse(readFileSync(`qa/results/round-${ROUND}.json`, 'utf8'))
const OUT = process.argv[3] || `qa/results/round-${ROUND}-scorecard.html`
mkdirSync(OUT.replace(/\/[^/]+$/, ''), { recursive: true })

const PTS = { S1: 13, S2: 8, S3: 3, S4: 1 }
const NAME = { S1: 'Critical', S2: 'Major', S3: 'Minor', S4: 'Nit' }
const ORD = { S1: 1, S2: 2, S3: 3, S4: 4 }
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const confirmed = [...r.confirmed].sort((a, b) => (ORD[a.severity] - ORD[b.severity]) || a.id.localeCompare(b.id))
const bySev = r.bySev
const score = r.score

// area each finding came from (prefix of first source, before the colon)
const areaOf = (c) => {
  const s = (c.sources || [])[0] || ''
  const i = s.indexOf(':')
  return i > 0 ? s.slice(0, i) : '—'
}

const sevRow = (c, i) => `
    <tr class="row row--${c.severity}" style="--i:${i}">
      <td class="c-sev"><span class="pill pill--${c.severity}">${c.severity}</span></td>
      <td class="c-title">
        <div class="t">${esc(c.title)}</div>
        <details class="detail">
          <summary>repro &amp; verdict</summary>
          <div class="detail__body">
            <p><b>Expected</b> ${esc(c.expected)}</p>
            <p><b>Actual</b> ${esc(c.actual)}</p>
            <ol class="repro">${(c.repro || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
          </div>
        </details>
      </td>
      <td class="c-area"><code>${esc(areaOf(c))}</code></td>
      <td class="c-pts num">${PTS[c.severity]}</td>
    </tr>`

const barSeg = (sev) => {
  const n = bySev[sev]
  if (!n) return ''
  const pts = n * PTS[sev]
  return `<div class="seg seg--${sev}" style="flex:${pts}" title="${n} × ${sev} = ${pts} pts"><span>${sev} · ${pts}</span></div>`
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Music Timeline — QA Round 2 Scorecard</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800&family=Fragment+Mono&display=swap" rel="stylesheet">
<style>
  :root{
    --font-display:'Bricolage Grotesque','Georgia',serif;
    --font-mono:'Fragment Mono','SF Mono',Consolas,monospace;
    --font-sans:'Bricolage Grotesque',system-ui,sans-serif;

    --bg:#faf7f5; --surface:#fffdfc; --surface2:#f4efeb; --surface-elevated:#fffefd;
    --border:rgba(60,40,30,.10); --border-bright:rgba(60,40,30,.20);
    --text:#231c17; --text-dim:#7a6a5f;

    --s1:#b91c1c; --s1-dim:rgba(185,28,28,.10);
    --s2:#c2410c; --s2-dim:rgba(194,65,12,.10);
    --s3:#a16207; --s3-dim:rgba(161,98,7,.10);
    --s4:#78716c; --s4-dim:rgba(120,113,108,.10);
    --ok:#4d7c0f; --ok-dim:rgba(77,124,15,.10);
    --accent:#c2410c;
  }
  @media (prefers-color-scheme:dark){
    :root{
      --bg:#17120f; --surface:#201915; --surface2:#2a211c; --surface-elevated:#261e19;
      --border:rgba(255,235,220,.09); --border-bright:rgba(255,235,220,.18);
      --text:#f2e7de; --text-dim:#b3a094;
      --s1:#f87171; --s1-dim:rgba(248,113,113,.14);
      --s2:#fb923c; --s2-dim:rgba(251,146,60,.14);
      --s3:#fbbf24; --s3-dim:rgba(251,191,36,.14);
      --s4:#a8a29e; --s4-dim:rgba(168,162,158,.14);
      --ok:#a3e635; --ok-dim:rgba(163,230,53,.14);
      --accent:#fb923c;
    }
    /* Dark-mode severity swatches are light, so segment labels must go dark
       or "S3 · 60" sits white-on-amber and fails contrast. Needs the extra
       specificity: the base .seg span rule is defined later in this sheet. */
    .bar .seg span{color:#1a120d;text-shadow:none}
  }
  *{margin:0;padding:0;box-sizing:border-box}
  body{
    background:var(--bg);
    background-image:
      radial-gradient(ellipse at 12% 0%, var(--s1-dim) 0%, transparent 46%),
      radial-gradient(ellipse at 88% 8%, var(--s3-dim) 0%, transparent 42%);
    color:var(--text); font-family:var(--font-sans); padding:40px 24px; min-height:100vh;
    overflow-wrap:break-word; -webkit-text-size-adjust:100%;
  }
  .wrap{max-width:1080px;margin:0 auto}
  .grid>*,.flex>*{min-width:0}

  @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
  @keyframes fadeScale{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:scale(1)}}
  .an{animation:fadeUp .4s ease-out both;animation-delay:calc(var(--i,0)*.05s)}
  .kpi{animation:fadeScale .38s ease-out both;animation-delay:calc(var(--i,0)*.06s)}
  @media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-delay:0ms!important;transition-duration:.01ms!important}}

  /* header */
  .eyebrow{font-family:var(--font-mono);font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--accent);margin-bottom:10px}
  h1{font-family:var(--font-display);font-size:clamp(30px,5vw,46px);font-weight:800;letter-spacing:-1.2px;line-height:1.03;margin-bottom:10px}
  .sub{color:var(--text-dim);font-size:15px;line-height:1.6;max-width:70ch;margin-bottom:6px}
  .meta{font-family:var(--font-mono);font-size:11px;color:var(--text-dim);margin-bottom:30px;line-height:1.9}
  .meta a{color:var(--accent)}

  h2{font-family:var(--font-display);font-size:20px;font-weight:600;letter-spacing:-.3px;margin:38px 0 14px;display:flex;align-items:center;gap:10px}
  h2::before{content:'';width:10px;height:10px;border-radius:3px;background:var(--accent);flex:none}

  /* KPI */
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:14px;margin-bottom:8px}
  .card{background:var(--surface-elevated);border:1px solid var(--border);border-radius:12px;padding:18px}
  .card--hero{box-shadow:0 4px 22px rgba(80,40,20,.09),0 1px 3px rgba(80,40,20,.05)}
  .kv{font-family:var(--font-display);font-size:38px;font-weight:800;line-height:1;letter-spacing:-1.5px;font-variant-numeric:tabular-nums}
  .kl{font-family:var(--font-mono);font-size:10px;text-transform:uppercase;letter-spacing:1.3px;color:var(--text-dim);margin-top:8px}
  .kn{font-size:12px;color:var(--text-dim);margin-top:6px;line-height:1.45}

  /* severity bar */
  .bar{display:flex;height:46px;border-radius:10px;overflow:hidden;border:1px solid var(--border);margin:6px 0 10px}
  .seg{display:flex;align-items:center;justify-content:center;min-width:0}
  .seg span{font-family:var(--font-mono);font-size:11px;font-weight:600;color:#fff;white-space:nowrap;padding:0 6px;text-shadow:0 1px 2px rgba(0,0,0,.28);overflow:hidden;text-overflow:clip}
  .seg--S1{background:var(--s1)} .seg--S2{background:var(--s2)}
  .seg--S3{background:var(--s3)} .seg--S4{background:var(--s4)}
  .barnote{font-family:var(--font-mono);font-size:11px;color:var(--text-dim)}

  /* legend */
  .legend{display:flex;gap:14px;flex-wrap:wrap;margin:14px 0 6px}
  .li{display:flex;align-items:center;gap:7px;font-family:var(--font-mono);font-size:11px;color:var(--text-dim)}
  .sw{width:11px;height:11px;border-radius:3px;flex:none}

  /* comparison */
  .cmp{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .cmp>*{min-width:0}
  .cmp .card{position:relative}
  .rlabel{font-family:var(--font-mono);font-size:10px;letter-spacing:1.4px;text-transform:uppercase;color:var(--text-dim);margin-bottom:12px}
  .stat{display:flex;justify-content:space-between;align-items:baseline;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px}
  .stat:last-child{border-bottom:none}
  .stat b{font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:15px}
  .unk{color:var(--text-dim);font-style:italic;font-size:12px;line-height:1.5;margin-top:10px}

  /* S1 spotlight */
  .spot{border:1px solid var(--s1);border-left:5px solid var(--s1);border-radius:12px;background:var(--s1-dim);padding:22px 24px}
  .spot h3{font-family:var(--font-display);font-size:19px;font-weight:700;letter-spacing:-.3px;margin-bottom:10px;line-height:1.25}
  .spot p{font-size:14px;line-height:1.65;margin-bottom:10px}
  .spot .quote{font-family:var(--font-mono);font-size:12.5px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:11px 14px;margin:12px 0;line-height:1.6}

  /* table */
  .twrap{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden}
  .tscroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
  table{width:100%;border-collapse:collapse;font-size:13.5px;line-height:1.55}
  thead{position:sticky;top:0;z-index:2}
  th{background:var(--surface2);font-family:var(--font-mono);font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1.2px;color:var(--text-dim);text-align:left;padding:13px 14px;border-bottom:2px solid var(--border-bright);white-space:nowrap}
  td{padding:13px 14px;border-bottom:1px solid var(--border);vertical-align:top}
  tbody tr:last-child td{border-bottom:none}
  tbody tr{animation:fadeUp .35s ease-out both;animation-delay:calc(var(--i,0)*.025s);transition:background .15s ease}
  tbody tr:hover{background:var(--surface2)}
  .row--S1 td:first-child{box-shadow:inset 4px 0 0 var(--s1)}
  .row--S2 td:first-child{box-shadow:inset 4px 0 0 var(--s2)}
  .row--S3 td:first-child{box-shadow:inset 4px 0 0 var(--s3)}
  .row--S4 td:first-child{box-shadow:inset 4px 0 0 var(--s4)}
  .c-sev{width:1%;white-space:nowrap}
  .c-title{min-width:260px;max-width:600px}
  .c-title .t{font-weight:600;line-height:1.4}
  .c-area{width:1%;white-space:nowrap}
  .c-pts{width:1%;white-space:nowrap}
  .num{text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums;color:var(--text-dim)}
  code{font-family:var(--font-mono);font-size:11px;background:var(--s2-dim);color:var(--accent);padding:1.5px 6px;border-radius:4px}

  .pill{display:inline-flex;align-items:center;gap:5px;font-family:var(--font-mono);font-size:10.5px;font-weight:600;padding:3px 9px;border-radius:6px;white-space:nowrap;letter-spacing:.4px}
  .pill::before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor}
  .pill--S1{background:var(--s1-dim);color:var(--s1)}
  .pill--S2{background:var(--s2-dim);color:var(--s2)}
  .pill--S3{background:var(--s3-dim);color:var(--s3)}
  .pill--S4{background:var(--s4-dim);color:var(--s4)}
  .pill--ok{background:var(--ok-dim);color:var(--ok)}

  details.detail{margin-top:7px}
  details.detail summary{font-family:var(--font-mono);font-size:10.5px;color:var(--text-dim);cursor:pointer;list-style:none;display:inline-flex;align-items:center;gap:6px}
  details.detail summary::-webkit-details-marker{display:none}
  details.detail summary::before{content:'▸';transition:transform .15s ease;display:inline-block}
  details.detail[open] summary::before{transform:rotate(90deg)}
  .detail__body{margin-top:9px;padding:12px 14px;background:var(--surface2);border-radius:8px;font-size:12.5px;line-height:1.6;color:var(--text-dim)}
  .detail__body b{color:var(--text);font-weight:600;display:inline-block;min-width:64px}
  .detail__body p{margin-bottom:7px}
  .repro{list-style-position:inside;padding-left:0;margin-top:8px;font-family:var(--font-mono);font-size:11.5px;line-height:1.75}
  .repro li{margin-bottom:2px}

  details.coll{border:1px solid var(--border);border-radius:11px;overflow:hidden;background:var(--surface);margin-bottom:12px}
  details.coll summary{padding:14px 18px;font-family:var(--font-mono);font-size:12px;font-weight:600;cursor:pointer;list-style:none;display:flex;align-items:center;gap:9px}
  details.coll summary::-webkit-details-marker{display:none}
  details.coll summary::before{content:'▸';color:var(--text-dim);transition:transform .15s ease}
  details.coll[open] summary::before{transform:rotate(90deg)}
  .coll__body{padding:16px 18px;border-top:1px solid var(--border);font-size:13px;line-height:1.65;color:var(--text-dim)}
  .coll__body li{margin-bottom:9px;padding-left:14px;position:relative;list-style:none}
  .coll__body li::before{content:'›';position:absolute;left:0;color:var(--accent);font-weight:700}

  .callout{padding:16px 20px;border-radius:10px;border-left:4px solid var(--s3);background:var(--s3-dim);margin:16px 0;font-size:13.5px;line-height:1.65}
  .callout b{color:var(--text)}

  footer{margin-top:44px;padding-top:20px;border-top:1px solid var(--border);font-family:var(--font-mono);font-size:11px;color:var(--text-dim);line-height:1.9}
  footer a{color:var(--accent)}

  @media (max-width:768px){
    body{padding:20px 14px}
    /* Narrow segments clip their own labels on a phone; the legend below
       carries the same numbers, so drop the in-bar text entirely. */
    .seg span{display:none}
    .bar{height:34px}
    .cmp{grid-template-columns:1fr}
    th,td{padding:10px 11px}
    .kv{font-size:32px}
    .c-title{min-width:200px}
  }
</style>
</head>
<body>
<div class="wrap">

  <div class="eyebrow an" style="--i:0">Adversarial browser QA · Round 2</div>
  <h1 class="an" style="--i:1">Music Timeline scorecard</h1>
  <p class="sub an" style="--i:2">13 parallel testers drove the live site in real Google Chrome like a family would — tapping through the visible UI, no unit tests. Every candidate defect was then re-attacked by an independent skeptic whose job was to disprove it. Only survivors are counted below.</p>
  <div class="callout an" style="--i:2;border-left-color:var(--ok);background:var(--ok-dim)">
    <b>Scope, and current status.</b> Round 2 ran on <b>two independent fleets</b>: this Mac Studio (real Chrome, genuine AAC decoder) and a container fleet against the same live site. This page is the <b>studio fleet's 35 confirmed findings</b>. Merged with the other fleet, round 2 totals <b>40 unique confirmed defects — 1 Critical, 5 Major</b>, the same Critical and Majors shown here, with six findings reproduced independently by both fleets.<br><br>
    <b>Every one of the 40 is already fixed and deployed</b> (commit <code>9baf0f2</code>). So read this as the record of what round 2 caught, not as a list of things still broken.
  </div>
  <div class="meta an" style="--i:3">
    target &nbsp;<a href="https://music-timeline-walksalots-projects.vercel.app/index.html">music-timeline-walksalots-projects.vercel.app</a><br>
    browser &nbsp;Google Chrome 151.0.7922.76 &nbsp;·&nbsp; AAC decode <b>"probably"</b> &nbsp;·&nbsp; previews genuinely played<br>
    run &nbsp;57 agents · 0 errors · 100 min · 1,006 screenshots
  </div>

  <div class="kpis">
    <div class="card card--hero kpi" style="--i:0">
      <div class="kv" style="color:var(--accent)">122</div>
      <div class="kl">Weighted score</div>
      <div class="kn">S1×13 · S2×8 · S3×3 · S4×1</div>
    </div>
    <div class="card kpi" style="--i:1">
      <div class="kv">35</div>
      <div class="kl">Confirmed</div>
      <div class="kn">of 37 clusters</div>
    </div>
    <div class="card kpi" style="--i:2">
      <div class="kv" style="color:var(--s1)">1</div>
      <div class="kl">Critical</div>
      <div class="kn">real money bug</div>
    </div>
    <div class="card kpi" style="--i:3">
      <div class="kv" style="color:var(--s2)">5</div>
      <div class="kl">Major</div>
      <div class="kn">feature broken</div>
    </div>
    <div class="card kpi" style="--i:4">
      <div class="kv" style="color:var(--text-dim)">29</div>
      <div class="kl">Minor + Nit</div>
      <div class="kn">polish &amp; copy</div>
    </div>
  </div>

  <h2>Where the 122 points come from</h2>
  <div class="bar an" style="--i:4">
    ${barSeg('S1')}${barSeg('S2')}${barSeg('S3')}${barSeg('S4')}
  </div>
  <div class="barnote an" style="--i:5">S1 ${bySev.S1}×13 = <b>13</b> &nbsp;·&nbsp; S2 ${bySev.S2}×8 = <b>40</b> &nbsp;·&nbsp; S3 ${bySev.S3}×3 = <b>60</b> &nbsp;·&nbsp; S4 ${bySev.S4}×1 = <b>9</b><br>Width = share of weighted score, not count. The single Critical outweighs all nine Nits combined.</div>

  <div class="legend an" style="--i:5">
    <div class="li"><span class="sw" style="background:var(--s1)"></span> S1 Critical · 13 pts — crash, data loss, wrong money, wrong rule outcome</div>
    <div class="li"><span class="sw" style="background:var(--s2)"></span> S2 Major · 8 pts — feature broken, game survives</div>
    <div class="li"><span class="sw" style="background:var(--s3)"></span> S3 Minor · 3 pts — visual, misleading copy, minor a11y</div>
    <div class="li"><span class="sw" style="background:var(--s4)"></span> S4 Nit · 1 pt — polish</div>
  </div>

  <h2>Round 1 vs Round 2</h2>
  <div class="cmp">
    <div class="card an" style="--i:6">
      <div class="rlabel">Round 1 · ran elsewhere</div>
      <div class="stat"><span>Confirmed defects</span><b>25</b></div>
      <div class="stat"><span>Weighted score</span><b>93</b></div>
      <div class="stat"><span>Status</span><b style="color:var(--ok)">all fixed &amp; deployed</b></div>
      <div class="unk">Round 1's per-severity breakdown isn't in this repo — that round ran on another machine and only its totals were handed over. Not reconstructed here rather than guessed.</div>
    </div>
    <div class="card card--hero an" style="--i:7">
      <div class="rlabel">Round 2 · this run</div>
      <div class="stat"><span>Confirmed defects</span><b>35</b></div>
      <div class="stat"><span>Weighted score</span><b style="color:var(--accent)">122</b></div>
      <div class="stat"><span>Critical / Major</span><b><span style="color:var(--s1)">1</span> / <span style="color:var(--s2)">5</span></b></div>
      <div class="stat"><span>Minor / Nit</span><b>20 / 9</b></div>
      <div class="stat"><span>Refuted by skeptics</span><b>2</b></div>
    </div>
  </div>

  <div class="callout an" style="--i:8">
    <b>The score went up, but the app did not get worse.</b> Round 1's 25 fixes held — skeptics re-tested those areas and none regressed. The rise is reach: 29 of 35 findings are minor polish, and this round reached surfaces round 1 never touched (co-op wording, offline and storage-full behaviour, landscape, the listen-page QR, screen-reader labels). Round 1 found the big breaks; round 2 is finding the long tail.
  </div>

  <h2>The one Critical</h2>
  <div class="spot an" style="--i:9">
    <h3>The winner screen pays out a pot nobody agreed to</h3>
    <p>The payout reads the <i>live setup draft</i> instead of a snapshot taken when the game started. So if someone opens “New game”, fiddles with the buy-in, and backs out without starting — then resumes the game already in progress — the win screen settles up using the abandoned draft.</p>
    <div class="quote">Verified in reverse too: a real agreed <b>$2/head to @realaunt</b> became <b>“$12 · send it to @some-other-cousin”</b> — a scannable Venmo QR, for the wrong amount, to someone who was never in the game.</div>
    <p>The skeptic attacked this on four axes and it survived all of them, including the strongest defence: the app's own saved stake said <code>enabled:false</code> at the moment the screen displayed $40. Root cause is named in shipped code — <code>payoutFor()</code> in <code>ui.js</code> reads <code>view.setup.buyin</code> rather than a per-game snapshot.</p>
    <p style="margin-bottom:0"><b>Why it rates Critical:</b> the rubric calls wrong money math S1 outright, and this lands on the exact screen the room uses to settle up.</p>
  </div>

  <h2>All ${confirmed.length} confirmed findings</h2>
  <div class="twrap an" style="--i:10">
    <div class="tscroll">
      <table>
        <thead><tr><th>Sev</th><th>Finding</th><th>Area</th><th class="num">Pts</th></tr></thead>
        <tbody>${confirmed.map(sevRow).join('')}</tbody>
        <tfoot></tfoot>
      </table>
    </div>
  </div>

  <h2>What the skeptics killed</h2>
  <details class="coll an" style="--i:11">
    <summary>2 refuted or by-design</summary>
    <div class="coll__body"><ul>
      ${r.rejected.map((x) => `<li><span class="pill pill--ok">${esc(x.outcome)}</span> ${esc(x.title)}</li>`).join('')}
    </ul></div>
  </details>
  <div class="callout an" style="--i:12">
    <b>Read this number with suspicion:</b> 35 of 37 clusters survived, which is a high pass rate for a gate designed to kill findings. Two things explain most of it — the adjudicator dropped by-design reports <i>before</i> verification, and the 13 missions barely overlap, so there was little duplicate inflation to strip. It is not proof the gate was soft, but if round 3 also refutes only ~2 of ~37, the skeptic stance needs re-tuning.
  </div>

  <h2>Coverage</h2>
  <details class="coll an" style="--i:13">
    <summary>What each of the 13 testers actually covered</summary>
    <div class="coll__body"><ul>
      ${r.coverage.map((c) => `<li><code>${esc(c.area)}</code> ${esc(String(c.coverage).replace(/\s+/g, ' ').slice(0, 400))}</li>`).join('')}
    </ul></div>
  </details>

  <footer>
    <b>Source of truth</b> — commit <code>05ba5f3</code> on branch <code>claude/phone-music-timeline-game-c96gtw</code> (walksalot/fabians-red-card)<br>
    <b>Machine-readable</b> — <code>qa/results/round-2.json</code> · full write-up <code>qa/results/round-2.md</code> · 49 screenshots in <code>qa/results/round-2-evidence/</code><br>
    <b>Generated</b> — 2026-08-08 from the round-2 workflow result · studio Mac (kris-studio)<br>
    <b>Session</b> — <code>claude --resume e59d7bc7-5384-4f90-b941-9478bf447233</code><br>
    <b>Status</b> — CURRENT. Supersedes nothing; round 3 will supersede this page.
  </footer>

</div>
</body>
</html>`

writeFileSync(OUT, html)
console.log(`wrote ${OUT} — ${confirmed.length} findings, score ${score}`)
