#!/usr/bin/env node
/*
 * check-design.mjs - makes the "record-sleeve pop" redesign checkable instead of
 * arguable.
 *
 * The Claude Design handoff (design_handoff_timeline_redesign) ships a README of
 * prose tokens and a playable prototype ("Timeline Prototype.dc.html"). The
 * prototype is the source of truth: the README rounds numbers, omits several
 * colours the prototype actually paints, and contradicts it outright in a handful
 * of places (all recorded in SPEC.disagreements below). SPEC is the extraction of
 * every objectively checkable fact from the prototype; this script checks the four
 * of them that are cheap to get wrong and expensive to notice by eye:
 *
 *   1 palette coverage - which spec colours the implementation actually paints
 *   2 blurred shadows  - the theme is hard offset shadows, ALWAYS. A stray blur
 *                        radius reads as "slightly soft" and nobody files a bug.
 *   3 the three fonts  - Paytone One / Sora / IBM Plex Mono all referenced
 *   4 colour drift     - any colour in app.css that is not in the spec palette
 *
 * Deliberately zero-dependency and deliberately tolerant: public/music/app.css and
 * index.html are edited by other agents while this runs, so a missing, empty or
 * truncated file is reported as "not ready", never thrown.
 *
 * Usage:  node scripts/check-design.mjs [--json] [--root <dir>]
 * Exit:   0 = clean            1 = design violations
 *         2 = not ready (a file could not be read - this is not a design verdict)
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/* ========================================================================== */
/* THE SPEC                                                                   */
/* Extracted from "Timeline Prototype.dc.html". Every value here appears       */
/* literally in the prototype unless marked otherwise.                         */
/* ========================================================================== */

export const SPEC = Object.freeze({
  name: 'record-sleeve pop',
  source: 'design_handoff_timeline_redesign/Timeline Prototype.dc.html',
  canvas: {
    designWidth: 393, // dc $preview width; the README quotes this too
    shellMaxWidth: 520, // prototype root container max-width
    shellEdges: '1.5px solid rgba(36,28,21,.16)', // left/right border of the column
    grain: 'fractalNoise SVG overlay, baseFrequency 0.9, 2 octaves, alpha 0.06, opacity .5',
  },

  /* --- colours -------------------------------------------------------------
   * `alpha: 'any'` means the prototype paints this base RGB at several alphas;
   * the drift check gates on the base RGB, and `alphas` records the exact set
   * the prototype uses so a reviewer can spot an invented one. */
  colors: [
    { token: 'paper', value: '#fff8e7', alpha: 'any', alphas: [1, 0], role: 'app background; overlay and sheet background; also at alpha 0 as rgba(255,248,231,0), the transparent end of the pass/reveal top gradients' },
    { token: 'backdrop', value: '#ece3cd', role: 'page behind the phone column (document body) - NOT the paper colour; the README says it is' },
    { token: 'card', value: '#fffdf6', role: 'card face, row face, sheet row face, chip/button unselected face, QR frame' },
    { token: 'ink', value: '#241c15', alpha: 'any', alphas: [1, 0.85, 0.8, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.25, 0.2, 0.18, 0.16, 0.15, 0.14, 0.12, 0.1, 0.05], role: 'text, every border, hard shadows, sheet scrim (.35), toast/vote-done fill, co-op token dots' },
    { token: 'on-dark', value: '#ffffff', alpha: 'any', alphas: [1, 0.1, 0.07], role: 'text on ink/accent/player colour; toggle knob; disc sheen conic gradient (.1/.07)' },
    { token: 'groove', value: '#37302a', role: 'vinyl disc groove highlight, in repeating-radial-gradient with ink' },
    { token: 'accent', value: '#d6336c', alpha: 'any', alphas: [1, 0.32, 0.3, 0.12], role: 'raspberry: primary buttons, selected chips/cards, progress ring, disc label, selected-gap border, reveal tint (.12), bought-card strip shadow (.3)' },
    { token: 'accent-text', value: '#c2255c', role: 'raspberry text on light: links, "Open", "up now", gap label, selected mode/playback label, eyebrows on cards' },
    { token: 'accent-link-hover', value: '#a61e4d', role: 'a:hover only' },
    { token: 'accent-tint', value: '#ffdeeb', role: 'selected mode/playback card fill, selected gap fill, name-it on, bought verdict pill, ::selection' },
    { token: 'correct', value: '#2f9e44', alpha: 'any', alphas: [1, 0.3, 0.15], role: 'RESERVED for right: verdict border/dot, toggle track on, resume dot, step ticks, reveal tint (.15), strip shadow (.3)' },
    { token: 'correct-tint', value: '#d3f9d8', role: 'right verdict pill fill, vote chip on, highlighted strip card' },
    { token: 'correct-text', value: '#2b8a3e', role: 'right verdict text, "+1" token badge, "N songs match" when healthy' },
    { token: 'wrong', value: '#e03131', alpha: 'any', alphas: [1, 0.14], role: 'RESERVED for wrong: verdict border/dot, challenge-lost dot, step cross, co-op loss avatar, reveal tint (.14)' },
    { token: 'wrong-tint', value: '#ffe3e3', role: 'wrong verdict pill fill' },
    { token: 'wrong-text', value: '#c92a2a', role: 'wrong verdict text, "-1"/"-3" token badges, End game, block reason, low match count, last-mistake warning' },
    { token: 'highlight', value: '#fff3bf', role: 'streak-bonus note card, LEADS badge' },
  ],

  /* Player crayon palette - assigned by join order, cycles. Order is load-bearing:
   * player 1 is always teal. Also used at alpha .45 for non-strongest decade bars
   * and .18 for the pass-the-phone top gradient tint. */
  playerColors: ['#0c8599', '#f08c00', '#7048e8', '#1c7ed6', '#e8590c', '#74b816', '#a87b4f', '#15aabf'],

  /* Winner-screen confetti, 16 pieces, this exact 6-colour cycle. */
  confettiColors: ['#d6336c', '#f08c00', '#0c8599', '#7048e8', '#1c7ed6', '#2f9e44'],

  fonts: [
    {
      family: 'Paytone One',
      weights: [400],
      role: 'display: years, screen titles, wordmark',
      sizesPx: [12, 13, 14, 16, 20, 24, 26, 40, 42, 46, 84],
      usage: {
        84: 'reveal year (letter-spacing -.02em, line-height 1)',
        46: 'home wordmark (letter-spacing -.01em)',
        42: 'winner name (line-height 1.1) - README says 44px',
        40: 'pass-the-phone name (line-height 1.1)',
        26: 'expert year readout; mistakes stepper value',
        24: 'screen titles: New game / Standings / How to play (letter-spacing -.01em)',
        20: 'sheet titles: QR title, "Challenge - 1 token"',
        16: 'cards-to-win number',
        14: 'timeline song-card year; home motif RPM sticker',
        13: 'home motif year stickers (1958 / ? / 1999)',
        12: 'reveal context-strip year; challenge-sheet card year',
      },
    },
    {
      family: 'Sora',
      weights: [400, 600, 700],
      role: 'everything you read (body default, inherited from body)',
      sizesPx: [8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 16, 17, 18, 22, 26, 30],
      usage: {
        '15/700': 'primary button label (all 54px buttons)',
        '17/700': 'turn-screen active player name',
        '22/700': 'reveal song title (letter-spacing -.01em)',
        '15/600-700': 'row titles, player name field, scoreboard name',
        '14.5/600-700': 'menu row labels; mode name',
        '13-14/400': 'body copy, helper lines',
        '12-12.5/400-600': 'captions, footnotes, verdict text (13.5/600)',
        '11.5-12/400': 'fine print',
        '30/700': 'winner avatar initial; 26 pass avatar initial; 12 turn avatar initial',
      },
    },
    {
      family: 'IBM Plex Mono',
      weights: [500, 600],
      role: 'meta and counts',
      sizesPx: [7.5, 10, 10.5, 11, 11.5, 12, 13, 14],
      usage: {
        '10.5/600': 'section eyebrows, uppercase, letter-spacing .12em (the most common mono style)',
        '11/600': 'hero eyebrows, uppercase, letter-spacing .16em (winner kicker uses .18em)',
        '11/500': 'status bars (turn/card counters, "offline ok")',
        '12/500-600': 'counters, deck-left, match line, pass-screen card counts',
        '14/600': 'scoreboard score X/Y',
        '10/600': 'how-to-play numbered step dots',
        '7.5/600': 'RPM sticker sublabel, letter-spacing .1em',
      },
    },
  ],

  radiiPx: {
    primaryButton: 16,
    challengeLockButton: 15,
    qrFrame: 16,
    card: 14, // cards, rows, sheet rows, toast, name-it/challenge buttons, toggle track
    smallCard: 13, // recap rows, how-to token cards, vote-done button
    chip: 20, // decade/genre chips (pill)
    menuChip: 18, // playback chips inside the menu sheet
    timelineCard: 10, // also the home motif year stickers
    stepper: 12, // mistakes +/- buttons, co-op pills, locked-challenge pills, vote chips
    gap: 9, // timeline gap slot; reveal strip card; LEADS badge
    gapSmall: 8, // challenge-sheet gap slot
    sheetTop: 20, // "20px 20px 0 0"
    qrImage: 6,
    scoreBar: 3,
    decadeBar: 1,
    sheetGrabber: 2,
    circle: '50%', // avatars, dots, disc
  },

  borders: {
    card: '1.5px solid #241c15',
    primaryButton: '2px solid #241c15',
    selectedModeOrPlayback: '2px solid #d6336c', // README calls this "2px" under an "ink" heading; it is raspberry
    unselectedModeOrPlayback: '1.5px solid rgba(36,28,21,.35)', // NOT solid ink - README says every card is ink
    unselectedChip: '1.5px solid rgba(36,28,21,.4)',
    dashedSlot: '1.5px dashed rgba(36,28,21,.4)', // add player, challenge button, name-it off
    dashedGap: '1.5px dashed rgba(36,28,21,.35)', // timeline gap, unselected
    selectedGap: '2px dashed #d6336c',
    sheetTop: '2px solid #241c15',
    avatarLarge: '2px solid #241c15', // 68px and 76px avatars
    tokenDot: '1px solid #241c15',
    scoreBarTrack: '1px solid rgba(36,28,21,.2)',
    hairline: '1.5px solid rgba(36,28,21,.14)', // section rules, sticky footer top
    coopPill: '1.5px solid rgba(36,28,21,.35)',
  },

  /* HARD SHADOWS ONLY. Every shadow in the theme has blur radius 0 and spread
   * omitted. A non-zero blur is a violation, not a taste call. */
  shadows: {
    hardRule: 'every box-shadow blur radius is 0',
    primaryButton: '0 4px 0 #241c15',
    primaryButtonPressed: '0 1px 0 #241c15', // :active, paired with translateY(3px)
    selectedTargetCard: '0 3px 0 #241c15', // cards-to-win selected chip; README omits this one
    cardRow: '2.5px 2.5px 0 rgba(36,28,21,.12)',
    stickerCard: '2.5px 2.5px 0 rgba(36,28,21,.15)', // home motif stickers
    menuRow: '2px 2px 0 rgba(36,28,21,.12)', // menu rows, recap rows, how-to cards, stepper, challenge pickers
    timelineCard: '2px 2px 0 rgba(36,28,21,.14)',
    avatarLarge: '3px 3px 0 rgba(36,28,21,.18)', // 68px / 76px avatars
    qrFrame: '3px 3px 0 rgba(36,28,21,.15)',
    revealStripCorrect: '2px 2px 0 rgba(47,158,68,.3)',
    revealStripBought: '2px 2px 0 rgba(214,51,108,.3)',
    designCanvasFrame: '10px 10px 0 rgba(214,51,108,.32)', // NOT an app token - it is the frame of the design-canvas card
  },

  spacingPx: {
    screenGutter: 24,
    heroGutter: 32, // home hero, pass screen
    homeButtonGutter: 28, // and the winner button column
    revealGutter: 28,
    sectionGap: 24, // setup and how-to column gap
    cardGap: [8, 9, 10, 12],
    chipGap: 8,
    chipPadding: '9px 15px',
    menuChipPadding: '7px 13px',
    cardPadding: ['10px 14px', '11px 14px', '12px 14px', '12px 16px', '14px 16px'],
    sheetPadding: '18px 24px 26px',
    statusRowPadding: '16px 24px 0',
  },

  controlHeightsPx: {
    primaryButton: 54,
    challengeLockButton: 50,
    voteDoneButton: 44,
    targetCard: 52,
    addPlayerRow: 46,
    stepperButton: 44,
    toggleTrack: [44, 26],
    toggleKnob: 18, // travel translateX(18px)
    avatar: { setup: 38, turn: 30, scoreboard: 30, challengePicker: 22, pass: 68, winner: 76 },
    timelineGap: { height: 76, widthIdle: 16, widthSelected: 36 }, // README says 14 -> 34
    challengeGap: { height: 64, widthIdle: 13, widthSelected: 30 },
    timelineCardWidth: 62,
    challengeCardWidth: 54,
    revealStripCardWidth: 50,
    disc: 'min(206px, 26dvh)',
    progressRing: { strokeWidth: 4, dasharray: 647, track: 'rgba(36,28,21,.15)' },
    scoreBar: 6,
    decadeBar: { width: 14, minHeight: 4, maxHeight: 18 },
    qrImage: 196,
    tokenDot: 8,
    passDot: 9,
    sheetGrabber: [40, 4],
  },

  motion: {
    rise: '300ms ease (fade + 10px up); home staggers 60ms',
    slideUp: '280ms cubic-bezier(.2,.9,.3,1.25) from translateY(46px)',
    popIn: '280ms ease from scale(.82)',
    discSheen: 'spinDisc 3.2s linear infinite',
    bob: 'bobY 2.8s ease-in-out infinite, rotate(-4deg), 6px travel',
    fillIn: '500ms ease scaleX',
    dotPop: '300ms ease scale',
    confFall: '2.4-4.4s linear infinite, 16 pieces',
    countUp: '1150ms cubic ease-out, 1950 -> answer, ticks ~85ms apart',
    press: 'buttons translateY(3px) + shadow 0 4px 0 -> 0 1px 0; cards scale(.96-.99); chips scale(.93)',
    verdictRotation: { good: '-1.5deg', bought: '-1.5deg', bad: '1.5deg' },
    disabledOpacity: 0.45,
    reduceMotion: 'body[data-rm] * { animation:none!important; transition:none!important }',
  },

  /* Where the README and the prototype disagree. The prototype wins; these are
   * listed because they are exactly the places an implementer guesses wrong. */
  disagreements: [
    { topic: 'page background', readme: 'the playfield background outside the column is the paper colour (#fff8e7)', prototype: 'body background is #ece3cd, a distinctly darker butter; #fff8e7 is only the column itself' },
    { topic: 'winner name size', readme: 'name 44px', prototype: '42px' },
    { topic: 'timeline gap widths', readme: '14px dashed gaps; selected widens to 34px', prototype: '16px idle, 36px selected (challenge sheet: 13px / 30px)' },
    { topic: 'session length hint', readme: '"~ 20/45/75 min"', prototype: '"20 min" / "45 min" / "70 min"' },
    { topic: 'verdict rotation', readme: 'rotate -1.5deg (good) / 1.5deg (bad)', prototype: 'bought (pink) also rotates -1.5deg, so -1.5deg is "not a miss", not "correct"' },
    { topic: 'borders on every card', readme: 'ink 1.5px solid #241c15 on every card/control', prototype: 'unselected mode and playback rows use 1.5px solid rgba(36,28,21,.35); chips use rgba(36,28,21,.4)' },
    { topic: '2px borders', readme: 'listed under "Borders: ink ..." so 2px reads as ink', prototype: 'selected mode/playback cards are 2px solid #d6336c (raspberry); only buttons and large avatars are 2px ink' },
    { topic: 'shadow inventory', readme: 'lists 5 shadows', prototype: 'also uses 2px 2px 0 rgba(36,28,21,.12) (the most common one, 15 uses), 2.5px 2.5px 0 rgba(36,28,21,.15), 3px 3px 0 rgba(36,28,21,.15) and 0 3px 0 #241c15' },
    { topic: 'canvas frame shadow', readme: 'lists 10px 10px 0 rgba(214,51,108,.32) as a theme token', prototype: 'that value exists only in Timeline Redesign.dc.html as the frame of the design-canvas card; it never appears in the app' },
    { topic: 'palette completeness', readme: 'omits #ece3cd, #37302a (vinyl groove), #a61e4d (link hover), #ffffff (on-accent text) and rgba(255,255,255,.1/.07) (disc sheen)', prototype: 'all present' },
    { topic: 'soft-ink alphas', readme: '.45 meta / .5 labels / .55-.65 body / .85 reading text', prototype: 'also .05 .1 .12 .14 .15 .16 .18 .2 .25 .35 .4 .7 .8' },
    { topic: 'radii inventory', readme: 'buttons 16 / cards 14 / chips 20 / song cards 10 / gaps 8-9 / sheet tops 20', prototype: 'also 13 (recap, how-to cards, vote-done), 12 (stepper, pills, vote chips), 18 (menu playback chips), 15 (challenge lock button), 6 (QR image)' },
    { topic: 'scoreboard header', readme: '"N cards left - M skipped"', prototype: 'only "N cards left"; there is no skipped count on the scoreboard' },
    { topic: 'menu contents', readme: 'Scoreboard, How to play, Skip pass-the-phone, Reduce motion, Sound effects, Playback chips, End game', prototype: 'also a "Home - the game stays saved" row, and Sound comes before Reduce motion' },
    { topic: 'design width', readme: 'single mobile column, design width 393px', prototype: 'the shell is max-width 520px with 1.5px rgba(36,28,21,.16) side borders; 393px is only the dc preview viewport' },
  ],
});

/* ========================================================================== */
/* colour plumbing                                                            */
/* ========================================================================== */

/* Keywords that are colour-position values but carry no palette information. */
const IGNORED_KEYWORDS = new Set([
  'transparent', 'currentcolor', 'inherit', 'initial', 'unset', 'revert',
  'revert-layer', 'none', 'auto',
]);

/* Named CSS colours worth recognising in hand-written CSS. Not the full 148 -
 * an unlisted name is under-reported drift, never a false alarm. */
const NAMED_COLORS = {
  black: '#000000', white: '#ffffff', red: '#ff0000', lime: '#00ff00',
  blue: '#0000ff', yellow: '#ffff00', cyan: '#00ffff', aqua: '#00ffff',
  magenta: '#ff00ff', fuchsia: '#ff00ff', silver: '#c0c0c0', gray: '#808080',
  grey: '#808080', maroon: '#800000', olive: '#808000', green: '#008000',
  purple: '#800080', teal: '#008080', navy: '#000080', orange: '#ffa500',
  gold: '#ffd700', pink: '#ffc0cb', brown: '#a52a2a', beige: '#f5f5dc',
  ivory: '#fffff0', khaki: '#f0e68c', linen: '#faf0e6', salmon: '#fa8072',
  tan: '#d2b48c', plum: '#dda0dd', orchid: '#da70d6', violet: '#ee82ee',
  indigo: '#4b0082', coral: '#ff7f50', crimson: '#dc143c', tomato: '#ff6347',
  snow: '#fffafa', wheat: '#f5deb3', azure: '#f0ffff', lavender: '#e6e6fa',
  turquoise: '#40e0d0', chocolate: '#d2691e', firebrick: '#b22222',
  goldenrod: '#daa520', seagreen: '#2e8b57', skyblue: '#87ceeb',
  slategray: '#708090', slategrey: '#708090', steelblue: '#4682b4',
  whitesmoke: '#f5f5f5', gainsboro: '#dcdcdc', dimgray: '#696969',
  dimgrey: '#696969', lightgray: '#d3d3d3', lightgrey: '#d3d3d3',
  darkgray: '#a9a9a9', darkgrey: '#a9a9a9', midnightblue: '#191970',
  rebeccapurple: '#663399',
};

const clamp255 = (n) => Math.max(0, Math.min(255, Math.round(n)));

/* Parse a single colour literal into {r,g,b,a}, or null if it is not one. */
function parseColor(raw) {
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;

  if (s[0] === '#') {
    const h = s.slice(1);
    if (!/^[0-9a-f]+$/.test(h)) return null;
    if (h.length === 3 || h.length === 4) {
      const [r, g, b, a] = h.split('').map((c) => parseInt(c + c, 16));
      return { r, g, b, a: h.length === 4 ? a / 255 : 1 };
    }
    if (h.length === 6 || h.length === 8) {
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
      return { r, g, b, a };
    }
    return null;
  }

  const fn = s.match(/^(rgba?|hsla?)\(([^)]*)\)$/);
  if (fn) {
    const parts = fn[2].replace(/\//g, ' ').split(/[\s,]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const num = (t, scale) => {
      const m = String(t).match(/^([+-]?\d*\.?\d+)(%)?$/);
      if (!m) return null;
      const v = parseFloat(m[1]);
      return m[2] ? (v / 100) * scale : v;
    };
    const alpha = parts.length > 3 ? num(parts[3], 1) : 1;
    if (fn[1].startsWith('rgb')) {
      const r = num(parts[0], 255);
      const g = num(parts[1], 255);
      const b = num(parts[2], 255);
      if (r === null || g === null || b === null) return null;
      return { r: clamp255(r), g: clamp255(g), b: clamp255(b), a: alpha === null ? 1 : alpha };
    }
    const h = num(parts[0], 360);
    const sat = num(parts[1], 100);
    const li = num(parts[2], 100);
    if (h === null || sat === null || li === null) return null;
    return { ...hslToRgb(h, sat, li), a: alpha === null ? 1 : alpha };
  }

  if (Object.prototype.hasOwnProperty.call(NAMED_COLORS, s)) return parseColor(NAMED_COLORS[s]);
  return null;
}

function hslToRgb(h, s, l) {
  const sn = s / 100;
  const ln = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n) => ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: clamp255(f(0) * 255), g: clamp255(f(8) * 255), b: clamp255(f(4) * 255) };
}

const rgbKey = (c) => `${c.r},${c.g},${c.b}`;

/* Every colour literal in a declaration value, with the text as written. */
function findColorLiterals(value) {
  const found = [];
  const re = /#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?)\([^)]*\)|\b[a-zA-Z]{3,20}\b/g;
  let m;
  while ((m = re.exec(value)) !== null) {
    const text = m[0];
    if (IGNORED_KEYWORDS.has(text.toLowerCase())) continue;
    const parsed = parseColor(text);
    if (parsed) found.push({ text, ...parsed });
  }
  return found;
}

/* ========================================================================== */
/* CSS reading (offset-preserving, so every finding gets a line number)        */
/* ========================================================================== */

/* Blank out a region while keeping length and newlines, so indices stay true. */
function blank(src, re) {
  return src.replace(re, (m) => m.replace(/[^\n]/g, ' '));
}

function sanitizeCss(src) {
  let out = blank(src, /\/\*[\s\S]*?\*\//g);
  out = blank(out, /\/\*[\s\S]*$/); // comment left unterminated by a mid-write save
  out = blank(out, /url\((?:[^()]|\([^()]*\))*\)/g);
  out = blank(out, /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g);
  return out;
}

function lineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
}

/* Declarations inside innermost { } blocks, each with its source offset. */
function readDeclarations(sanitized) {
  const decls = [];
  const block = /\{([^{}]*)\}/g;
  let b;
  while ((b = block.exec(sanitized)) !== null) {
    const body = b[1];
    const base = b.index + 1;
    let cursor = 0;
    for (const chunk of body.split(';')) {
      const start = base + cursor;
      cursor += chunk.length + 1;
      const colon = chunk.indexOf(':');
      if (colon === -1) continue;
      const prop = chunk.slice(0, colon).trim().toLowerCase();
      const value = chunk.slice(colon + 1).trim();
      if (!prop || !value) continue;
      decls.push({ prop, value, offset: start + chunk.indexOf(chunk.trimStart()[0] ?? '') });
    }
  }
  return decls;
}

/* Split on commas that are not inside parentheses. */
function splitTopLevel(value, sep = ',') {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

/* Resolve var(--x, fallback) against the file's own custom properties. */
function resolveVars(value, vars, depth = 0) {
  if (depth > 6 || !value.includes('var(')) return { value, unresolved: [] };
  const unresolved = [];
  const out = value.replace(/var\(\s*(--[\w-]+)\s*(?:,([^()]*(?:\([^()]*\)[^()]*)*))?\)/g, (m, name, fallback) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name];
    if (fallback != null && fallback.trim()) return fallback.trim();
    unresolved.push(name);
    return m;
  });
  if (out === value) return { value: out, unresolved };
  const next = resolveVars(out, vars, depth + 1);
  return { value: next.value, unresolved: unresolved.concat(next.unresolved) };
}

const LENGTH = /^[+-]?(?:\d*\.?\d+)(?:px|rem|em|%|vh|vw|vmin|vmax|pt|pc|in|cm|mm|ex|ch|q)?$/i;
const isZero = (t) => /^[+-]?0*(?:\.0+)?(?:px|rem|em|%|vh|vw|vmin|vmax|pt|pc|in|cm|mm|ex|ch|q)?$/i.test(t);

/* Blur radius of one box-shadow layer: the third length in the layer, or null. */
function shadowBlur(layer) {
  const tokens = splitTopLevel(layer, ' ').flatMap((t) => t.split(/\s+/)).filter(Boolean);
  const lengths = tokens.filter((t) => LENGTH.test(t));
  if (lengths.length < 3) return null;
  return { token: lengths[2], zero: isZero(lengths[2]) };
}

/* ========================================================================== */
/* file loading - never throws                                                */
/* ========================================================================== */

/* `shape` is a cheap structural sanity check, not a parse: it only has to tell a
 * half-written file apart from a real one so the run says "not ready". */
function loadFile(file, shape) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return { ok: false, why: 'not a regular file' };
    const text = fs.readFileSync(file, 'utf8');
    if (text.trim().length === 0) return { ok: false, why: 'file is empty' };
    if (text.length < 40) return { ok: false, why: `only ${text.length} bytes - looks mid-write` };
    const why = shape(text);
    if (why) return { ok: false, why };
    return { ok: true, text };
  } catch (err) {
    const code = err && err.code ? err.code : 'unknown error';
    return { ok: false, why: code === 'ENOENT' ? 'file does not exist' : `could not be read (${code})` };
  }
}

const cssShape = (raw) => {
  const t = sanitizeCss(raw); // braces inside comments and data URIs do not count
  const opens = (t.match(/\{/g) || []).length;
  const closes = (t.match(/\}/g) || []).length;
  if (opens === 0 || closes === 0) return 'no complete CSS rule found - looks mid-write';
  if (opens !== closes) return `unbalanced braces (${opens} open, ${closes} close) - looks mid-write`;
  return null;
};

const htmlShape = (t) => (/<\/?[a-zA-Z!]/.test(t) ? null : 'no HTML tags found - looks mid-write');

/* ========================================================================== */
/* the checks                                                                 */
/* ========================================================================== */

function specPalette() {
  const entries = [];
  for (const c of SPEC.colors) entries.push({ label: c.token, value: c.value, role: c.role });
  SPEC.playerColors.forEach((v, i) => {
    entries.push({ label: `player-${i + 1}`, value: v, role: `crayon palette position ${i + 1} (join order)` });
  });
  return entries;
}

function analyse(css, html) {
  const sanitized = sanitizeCss(css);
  const lineOf = lineIndex(css);
  const decls = readDeclarations(sanitized);

  const vars = {};
  for (const d of decls) if (d.prop.startsWith('--')) vars[d.prop] = d.value;

  /* --- colours in app.css --- */
  const used = new Map(); // rgbKey -> {key, samples:Map(text -> {line, count})}
  for (const d of decls) {
    // var() references are blanked, never expanded: a colour is reported once,
    // at the line that spells it out, not at every line that reaches it.
    for (const lit of findColorLiterals(stripVarRefs(d.value))) {
      const key = rgbKey(lit);
      if (!used.has(key)) used.set(key, { key, samples: new Map() });
      const bucket = used.get(key).samples;
      const seen = bucket.get(lit.text.toLowerCase());
      if (seen) seen.count += 1;
      else bucket.set(lit.text.toLowerCase(), { line: lineOf(d.offset), prop: d.prop, count: 1 });
    }
  }

  /* --- colours anywhere in index.html (presence only) --- */
  const htmlColors = new Set();
  if (html != null) {
    for (const lit of findColorLiterals(blank(html, /url\((?:[^()]|\([^()]*\))*\)/g))) {
      htmlColors.add(rgbKey(lit));
    }
  }

  /* 1 palette coverage */
  const palette = specPalette();
  const present = [];
  const missing = [];
  for (const entry of palette) {
    const c = parseColor(entry.value);
    const key = c ? rgbKey(c) : null;
    const where = [];
    if (key && used.has(key)) where.push('app.css');
    if (key && htmlColors.has(key)) where.push('index.html');
    if (where.length) present.push({ ...entry, where });
    else missing.push(entry);
  }

  /* 2 blurred shadows. Grouped by the offending layer: a blurred --sh-* token
   * reached through var() is one thing to fix, not one per reference. */
  const blurGroups = new Map();
  const unresolvableShadows = [];
  for (const d of decls) {
    const looksLikeShadow = d.prop === 'box-shadow'
      || (d.prop.startsWith('--') && isShadowLike(d.value));
    if (!looksLikeShadow) continue;
    const { value, unresolved } = resolveVars(d.value, vars);
    if (unresolved.length) {
      unresolvableShadows.push({ line: lineOf(d.offset), prop: d.prop, vars: [...new Set(unresolved)] });
      continue;
    }
    for (const layer of splitTopLevel(value)) {
      if (/^none$/i.test(layer)) continue;
      const blur = shadowBlur(layer);
      if (!blur || blur.zero) continue;
      const norm = layer.replace(/\s+/g, ' ');
      if (!blurGroups.has(norm)) blurGroups.set(norm, { layer: norm, blur: blur.token, sites: [] });
      blurGroups.get(norm).sites.push({ line: lineOf(d.offset), prop: d.prop });
    }
  }
  const blurred = [...blurGroups.values()].sort((a, b) => a.sites[0].line - b.sites[0].line);

  /* 3 fonts */
  const fonts = SPEC.fonts.map((f) => {
    const needle = f.family.toLowerCase();
    return {
      family: f.family,
      inCss: css.toLowerCase().includes(needle),
      inHtml: html != null && html.toLowerCase().includes(needle),
    };
  });

  /* 4 drift */
  const allowed = new Set();
  for (const entry of palette) {
    const c = parseColor(entry.value);
    if (c) allowed.add(rgbKey(c));
  }
  const drift = [];
  for (const [key, rec] of used) {
    if (allowed.has(key)) continue;
    const samples = [...rec.samples.entries()]
      .map(([text, meta]) => ({ text, ...meta }))
      .sort((a, b) => b.count - a.count);
    const total = samples.reduce((n, s) => n + s.count, 0);
    drift.push({ rgb: key, total, samples });
  }
  drift.sort((a, b) => b.total - a.total || a.rgb.localeCompare(b.rgb));

  return { present, missing, blurred, unresolvableShadows, fonts, drift, declCount: decls.length };
}

/* Does a custom property hold something shaped like a shadow list? */
function isShadowLike(value) {
  if (/^none$/i.test(value.trim())) return false;
  return splitTopLevel(value).some((layer) => {
    const tokens = layer.split(/\s+/).filter(Boolean);
    const lengths = tokens.filter((t) => LENGTH.test(t));
    return lengths.length >= 2 && findColorLiterals(layer).length > 0;
  });
}

/* Blank out var() references. Their colours belong to the line that defines the
 * custom property, and a bare "--violet" must not read as the named colour. */
function stripVarRefs(value) {
  if (!value.includes('var(')) return value;
  let out = value;
  for (let i = 0; i < 6 && out.includes('var('); i++) {
    const next = out.replace(/var\([^()]*\)/g, ' ');
    if (next === out) break;
    out = next;
  }
  return out;
}

/* ========================================================================== */
/* reporting                                                                  */
/* ========================================================================== */

function main() {
  const argv = process.argv.slice(2);
  const wantJson = argv.includes('--json');
  const rootAt = argv.indexOf('--root');
  const root = rootAt !== -1 && argv[rootAt + 1] ? argv[rootAt + 1] : process.cwd();

  const cssPath = path.resolve(root, 'public/music/app.css');
  const htmlPath = path.resolve(root, 'public/music/index.html');

  const cssFile = loadFile(cssPath, cssShape);
  const htmlFile = loadFile(htmlPath, htmlShape);

  if (!cssFile.ok || !htmlFile.ok) {
    const lines = ['NOT READY - the design check did not run.'];
    if (!cssFile.ok) lines.push(`  ${cssPath}: ${cssFile.why}`);
    if (!htmlFile.ok) lines.push(`  ${htmlPath}: ${htmlFile.why}`);
    lines.push('');
    lines.push('These files are edited live during the redesign. This is a read problem,');
    lines.push('not a design verdict - re-run once the file settles.');
    if (wantJson) console.log(JSON.stringify({ status: 'not-ready', css: cssFile.why ?? null, html: htmlFile.why ?? null }, null, 2));
    else console.log(lines.join('\n'));
    process.exit(2);
  }

  const res = analyse(cssFile.text, htmlFile.text);

  if (wantJson) {
    const violations = res.missing.length + res.blurred.length + res.drift.length
      + res.fonts.filter((f) => !f.inCss && !f.inHtml).length;
    console.log(JSON.stringify({ status: violations ? 'fail' : 'pass', ...res }, null, 2));
    process.exit(violations ? 1 : 0);
  }

  const out = [];
  const say = (s = '') => out.push(s);

  say('Design fidelity check - theme "record-sleeve pop"');
  say(`  spec source : ${SPEC.source}`);
  say(`  app.css     : ${path.relative(root, cssPath)} (${cssFile.text.length} bytes, ${res.declCount} declarations)`);
  say(`  index.html  : ${path.relative(root, htmlPath)} (${htmlFile.text.length} bytes)`);
  say();

  /* 1 palette coverage */
  say(`1. SPEC COLOURS PRESENT (${res.present.length} of ${res.present.length + res.missing.length})`);
  if (res.present.length === 0) say('   (none)');
  for (const p of res.present) say(`   ok      ${pad(p.value, 22)} ${pad(p.label, 20)} in ${p.where.join(' + ')}`);
  say();
  say(`   MISSING ENTIRELY (${res.missing.length})`);
  if (res.missing.length === 0) say('   (none)');
  for (const m of res.missing) {
    say(`   MISSING ${pad(m.value, 22)} ${pad(m.label, 20)} ${m.role}`);
  }
  say();

  /* 2 blurred shadows */
  const blurSites = res.blurred.reduce((n, b) => n + b.sites.length, 0);
  say(`2. BLURRED SHADOWS IN app.css (${res.blurred.length} distinct, ${blurSites} site${blurSites === 1 ? '' : 's'})`);
  say('   The theme rule is hard offset shadows: every box-shadow blur radius is 0.');
  if (res.blurred.length === 0) say('   ok      no blurred box-shadow found');
  for (const b of res.blurred) {
    const first = b.sites[0];
    say(`   BLUR    app.css:${pad(String(first.line), 6)} blur ${pad(b.blur, 6)} ${first.prop}: ${b.layer}`);
    if (b.sites.length > 1) {
      const rest = b.sites.slice(1).map((s) => s.line).join(', ');
      say(`                            also at line${b.sites.length > 2 ? 's' : ''} ${rest}`);
    }
  }
  for (const u of res.unresolvableShadows) {
    say(`   UNKNOWN app.css:${pad(String(u.line), 6)} ${u.prop} uses ${u.vars.join(', ')} - defined elsewhere, blur not verifiable`);
  }
  say();

  /* 3 fonts */
  say('3. FONT FAMILIES');
  for (const f of res.fonts) {
    const where = [f.inCss && 'app.css', f.inHtml && 'index.html'].filter(Boolean);
    if (where.length) say(`   ok      ${pad(f.family, 16)} referenced in ${where.join(' + ')}`);
    else say(`   MISSING ${pad(f.family, 16)} not referenced in app.css or index.html`);
  }
  say();

  /* 4 drift */
  const driftTotal = res.drift.reduce((n, d) => n + d.total, 0);
  say(`4. COLOUR DRIFT IN app.css - not in the spec palette (${res.drift.length} colours, ${driftTotal} uses)`);
  say('   transparent / inherit / currentColor are ignored.');
  if (res.drift.length === 0) say('   ok      every colour in app.css is a spec colour');
  for (const d of res.drift) {
    const head = d.samples[0];
    const extra = d.samples.length > 1 ? ` (+${d.samples.length - 1} more spellings)` : '';
    say(`   DRIFT   rgb(${pad(d.rgb, 13)}) ${pad(String(d.total) + 'x', 5)} first app.css:${pad(String(head.line), 6)} ${head.text} (in ${head.prop})${extra}`);
  }
  say();

  /* verdict */
  const missingFonts = res.fonts.filter((f) => !f.inCss && !f.inHtml).length;
  const total = res.missing.length + res.blurred.length + res.drift.length + missingFonts;
  say('SUMMARY');
  say(`   spec colours missing : ${res.missing.length}`);
  say(`   blurred shadows      : ${res.blurred.length}`);
  say(`   fonts not referenced : ${missingFonts}`);
  say(`   off-palette colours  : ${res.drift.length}`);
  if (res.unresolvableShadows.length) {
    say(`   shadows unverifiable : ${res.unresolvableShadows.length} (var() defined outside app.css)`);
  }
  say();
  say(total === 0
    ? 'PASS - app.css and index.html match the spec on every checkable axis.'
    : `FAIL - ${total} violation${total === 1 ? '' : 's'}. Each line above names the file and line to fix.`);

  console.log(out.join('\n'));
  process.exit(total === 0 ? 0 : 1);
}

function pad(s, n) {
  const str = String(s);
  return str.length >= n ? str : str + ' '.repeat(n - str.length);
}

/* Only check when run as a command. SPEC is exported so a test or another script
 * can import the spec without this module calling process.exit on them. */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
