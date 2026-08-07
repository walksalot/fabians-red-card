/*
  listen.js - drives listen.html, the "scan the card, hear the song" page.

  The whole design constraint here is secrecy. The scanning phone is handed the
  song in the URL hash (base64url JSON, deliberately without the year), and this
  module keeps it out of the DOM: the title and artist are only ever used as
  arguments to the resolver and as href text inside the disclosure the player
  opens on purpose. Everything else - status copy, aria labels, the document
  title - stays generic.

  Audio always starts from a tap (iOS refuses otherwise), so the track is
  resolved eagerly on load and the shared <audio> element is created inside the
  click handler, synchronously, to keep the user gesture intact.
*/

import { resolveTrack, getPlayer } from "./audio.js";
// Namespace import as well, purely so a build of audio.js without
// `streamingLinks` degrades to the local search URLs below instead of failing
// to link and leaving the scanning phone staring at a blank page.
import * as audio from "./audio.js";

/** Previews are 30s; the ring and the hard stop are both anchored to that. */
const CLIP_SECONDS = 30;

const dom = {
  cardNo: document.getElementById("card-no"),
  player: document.getElementById("player"),
  ring: document.getElementById("ring-progress"),
  play: document.getElementById("play"),
  replay: document.getElementById("replay"),
  elapsed: document.getElementById("elapsed"),
  remaining: document.getElementById("remaining"),
  status: document.getElementById("status"),
  notice: document.getElementById("notice"),
  noticeTitle: document.getElementById("notice-title"),
  noticeBody: document.getElementById("notice-body"),
  reveal: document.getElementById("reveal"),
  links: document.getElementById("links"),
};

/* ---------------------------------------------------------------- payload -- */

/**
 * Decode base64url to bytes. `atob` only speaks standard base64, and the
 * classic `unescape(encodeURIComponent(...))` trick mangles anything outside
 * Latin-1 - song titles are full of accents, so go through TextDecoder.
 * @param {string} value
 * @returns {Uint8Array}
 */
function base64UrlToBytes(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new Error("not base64url");
  }
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * @param {string} hash raw `location.hash`
 * @returns {{ok: true, card: {id: string, title: string, artist: string}, turn: number|null}
 *          | {ok: false, reason: "missing"|"malformed"|"version"}}
 */
function readCardFromHash(hash) {
  const raw = String(hash || "").replace(/^#/, "").trim();
  if (!raw) return { ok: false, reason: "missing" };

  let payload;
  try {
    // Some scanners percent-encode the hash on the way in; base64url itself
    // never contains a '%', so unescaping first is safe.
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      base64UrlToBytes(raw.includes("%") ? decodeURIComponent(raw) : raw),
    );
    payload = JSON.parse(text);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, reason: "malformed" };
  }
  if (payload.v !== 1) return { ok: false, reason: "version" };

  const title = typeof payload.t === "string" ? payload.t.trim() : "";
  const artist = typeof payload.a === "string" ? payload.a.trim() : "";
  if (!title) return { ok: false, reason: "malformed" };

  const n = Number(payload.n);
  const turn = Number.isInteger(n) && n > 0 && n < 10000 ? n : null;

  return { ok: true, card: { id: cardId(title, artist), title, artist }, turn };
}

/** Same kebab slug the deck uses, so resolver caching lines up across screens. */
function cardId(title, artist) {
  const slug = (s) =>
    s
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  return `${slug(artist)}-${slug(title)}`.replace(/^-+/, "");
}

/* ------------------------------------------------------------ streaming --- */

const SERVICES = [
  { key: "spotify", label: "Spotify", color: "#1ed760" },
  { key: "apple", label: "Apple Music", color: "#fa586a" },
  { key: "youtube", label: "YouTube", color: "#ff4e45" },
];

function serviceFor(text) {
  const hay = String(text || "").toLowerCase();
  return SERVICES.find((s) => hay.includes(s.key)) || null;
}

/** Local search URLs, used when audio.js does not hand us any. */
function fallbackLinks(card) {
  const q = encodeURIComponent(`${card.title} ${card.artist}`.trim());
  return [
    { label: "Spotify", href: `https://open.spotify.com/search/${q}`, color: "#1ed760" },
    { label: "Apple Music", href: `https://music.apple.com/search?term=${q}`, color: "#fa586a" },
    { label: "YouTube", href: `https://www.youtube.com/results?search_query=${q}`, color: "#ff4e45" },
  ];
}

/** Accepts either an array of link objects or a {spotify, apple, youtube} map. */
function normalizeLinks(raw) {
  const entries = Array.isArray(raw)
    ? raw.map((item) => [item && (item.service || item.name || item.label), item])
    : raw && typeof raw === "object"
      ? Object.entries(raw)
      : [];

  const out = [];
  for (const [key, value] of entries) {
    const href =
      typeof value === "string" ? value : value && (value.href || value.url || value.link);
    if (typeof href !== "string" || !/^https?:\/\//i.test(href)) continue;
    const service = serviceFor(key) || serviceFor(href);
    out.push({
      label: service ? service.label : String(key || "Open"),
      href,
      color: service ? service.color : "#a78bfa",
    });
  }
  return out;
}

function linksFor(card) {
  let raw = null;
  const streamingLinks = audio.streamingLinks;
  if (typeof streamingLinks === "function") {
    try {
      raw = streamingLinks(card);
    } catch {
      raw = null;
    }
  }
  const normalized = normalizeLinks(raw);
  return normalized.length ? normalized : fallbackLinks(card);
}

/* --------------------------------------------------------------- player --- */

let sharedPlayer = null;
let listening = false;

/**
 * audio.js hands back a helper object that owns the element privately (and
 * only builds it on the first play), but it may also hand back the bare
 * <audio>. Look for both so this page works either way.
 */
function mediaEl() {
  if (!sharedPlayer) return null;
  if (sharedPlayer instanceof HTMLMediaElement) return sharedPlayer;
  for (const key of ["element", "el", "audio", "media", "node"]) {
    const value = sharedPlayer[key];
    if (value instanceof HTMLMediaElement) return value;
  }
  return null;
}

/**
 * End-of-clip and playback-failure notifications. The helper's `subscribe`
 * covers both; a raw element gets DOM listeners instead. Deliberately no
 * "pause" listener: pausing to restart fires one, and the tick's stall check
 * below spots a genuine outside interruption without the ordering trap.
 */
function attachListeners() {
  if (listening || !sharedPlayer) return;

  if (typeof sharedPlayer.subscribe === "function") {
    sharedPlayer.subscribe((snapshot) => {
      if (!snapshot) return;
      if (snapshot.type === "ended") finish();
      else if (snapshot.type === "error" && (state === "playing" || state === "loading")) {
        stumble(true);
      }
    });
    listening = true;
    return;
  }

  const el = mediaEl();
  if (!el) return;
  el.addEventListener("ended", () => finish());
  el.addEventListener("error", () => {
    if (state === "playing" || state === "loading") stumble(true);
  });
  listening = true;
}

/** Created on the first tap so iOS treats the element as user-activated. */
function ensurePlayer() {
  if (sharedPlayer) return sharedPlayer;
  try {
    sharedPlayer = getPlayer();
  } catch {
    sharedPlayer = null;
  }
  attachListeners();
  return sharedPlayer;
}

/** True while sound is actually coming out, as far as the player will say. */
function isSounding() {
  const el = mediaEl();
  if (el) return !el.paused && !el.ended;
  if (sharedPlayer && typeof sharedPlayer.playing === "boolean") return sharedPlayer.playing;
  return true;
}

/**
 * Start (or resume) playback.
 * @returns {Promise<void>} rejects when the browser or the player refused --
 *   note the helper resolves `false` rather than throwing, so check for it.
 */
function commandPlay(url, restart) {
  const player = ensurePlayer();
  if (!player) return Promise.reject(new Error("no player"));

  if (typeof player.play === "function" && !(player instanceof HTMLMediaElement)) {
    if (restart && typeof player.stop === "function") player.stop();
    return Promise.resolve(player.play(url)).then((ok) => {
      if (ok === false) throw new Error("playback refused");
      attachListeners(); // the element may only exist once playback started
    });
  }

  const el = mediaEl();
  if (!el) return Promise.reject(new Error("no play method"));
  if (el.src !== url) el.src = url;
  if (restart) {
    try {
      el.currentTime = 0;
    } catch {
      /* some engines refuse a seek before metadata; harmless */
    }
  }
  const started = el.play();
  return started && typeof started.then === "function" ? started : Promise.resolve();
}

function commandPause() {
  if (!sharedPlayer) return;
  try {
    if (typeof sharedPlayer.pause === "function") sharedPlayer.pause();
  } catch {
    /* nothing sensible to do; the UI already reflects "paused" */
  }
}

/* ---------------------------------------------------------------- state --- */

/** @type {"blank"|"loading"|"idle"|"playing"|"paused"|"done"|"error"} */
let state = "loading";
let card = null;
let track = null;
let wantsPlay = false;
let frame = 0;
let wallStart = 0;
let wallBase = 0;
let quietSince = 0;
let hasSounded = false;

const RING_LENGTH = 2 * Math.PI * 53;

function setState(next, message) {
  state = next;
  document.body.dataset.state = next;
  if (typeof message === "string") dom.status.textContent = message;

  const playable = next !== "blank" && next !== "error";
  dom.play.disabled = next === "blank" || (next === "error" && !track);
  dom.play.setAttribute(
    "aria-label",
    next === "playing" ? "Pause the clip" : "Play the clip",
  );
  dom.replay.disabled = !playable || !track || next === "loading";
}

function mmss(seconds) {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function paint(elapsed) {
  const clamped = Math.min(CLIP_SECONDS, Math.max(0, elapsed));
  dom.elapsed.textContent = mmss(clamped);
  dom.remaining.textContent = mmss(CLIP_SECONDS - clamped);
  dom.ring.style.strokeDashoffset = String(RING_LENGTH * (clamped / CLIP_SECONDS));
}

/** Prefer the player's own clock; the wall clock is only a last resort. */
function elapsedNow() {
  const el = mediaEl();
  if (el && Number.isFinite(el.currentTime)) return el.currentTime;
  if (sharedPlayer && Number.isFinite(sharedPlayer.currentTime) && sharedPlayer.currentTime > 0) {
    return sharedPlayer.currentTime;
  }
  // Nothing has actually made a sound yet (still buffering) - hold the clock
  // rather than letting the ring run ahead of the audio.
  if (!hasSounded) return wallBase;
  return wallBase + (performance.now() - wallStart) / 1000;
}

function tick() {
  const elapsed = elapsedNow();
  paint(elapsed);
  if (elapsed >= CLIP_SECONDS) {
    finish();
    return;
  }

  // Something outside this page stopped the sound (a call, headphones pulled,
  // the OS media controls). Give it half a second to be a hiccup first, and
  // never before the clip has made a sound at all - that is just buffering.
  if (isSounding()) {
    hasSounded = true;
    quietSince = 0;
  } else if (!hasSounded) {
    quietSince = 0;
  } else if (!quietSince) {
    quietSince = performance.now();
  } else if (performance.now() - quietSince > 500) {
    stopTicking();
    setState("paused", "Paused. Tap play to carry on.");
    return;
  }

  frame = requestAnimationFrame(tick);
}

function startTicking() {
  cancelAnimationFrame(frame);
  wallStart = performance.now();
  quietSince = 0;
  hasSounded = false;
  frame = requestAnimationFrame(tick);
}

function stopTicking() {
  cancelAnimationFrame(frame);
  frame = 0;
  wallBase = elapsedNow();
}

function finish() {
  stopTicking();
  commandPause();
  wallBase = 0;
  paint(CLIP_SECONDS);
  setState("done", "That's the clip. Replay it as often as you like.");
}

/**
 * The friendly dead end. Highlights the streaming disclosure without opening
 * it - the player still chooses when the title appears on screen.
 */
function stumble(retryable) {
  stopTicking();
  setState(
    "error",
    retryable
      ? "Couldn't stream this one. Tap play to try again, or use the links below."
      : "Couldn't stream this one. The links below will find it.",
  );
  dom.reveal.hidden = false;
  dom.reveal.dataset.surfaced = "";
  dom.reveal.scrollIntoView({
    block: "nearest",
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
  });
}

/* ------------------------------------------------------------- reactions -- */

function onPlayTap() {
  if (state === "playing") {
    commandPause();
    stopTicking();
    setState("paused", "Paused. Tap play to carry on.");
    return;
  }

  // Still resolving: remember the tap and start the moment the URL lands.
  if (!track) {
    if (state === "loading") {
      wantsPlay = true;
      dom.status.textContent = "Starting as soon as it loads...";
    }
    return;
  }

  const restart = state === "done" || state === "idle";
  if (restart) {
    wallBase = 0;
    paint(0);
  }
  setState("playing", "Playing a 30-second clip.");
  startTicking();
  commandPlay(track.previewUrl, restart).catch(() => stumble(true));
}

function onReplayTap() {
  if (!track) return;
  wallBase = 0;
  paint(0);
  setState("playing", "Playing a 30-second clip.");
  startTicking();
  commandPlay(track.previewUrl, true).catch(() => stumble(true));
}

/** Links are minted here, on open, because their hrefs carry the title. */
function onRevealToggle() {
  if (!dom.reveal.open || !card) {
    dom.links.replaceChildren();
    return;
  }
  const nodes = linksFor(card).map((link) => {
    const a = document.createElement("a");
    a.className = "link";
    a.href = link.href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    const dot = document.createElement("span");
    dot.className = "link-dot";
    dot.style.setProperty("--service", link.color);
    a.append(dot, document.createTextNode(`Search ${link.label}`));
    return a;
  });
  dom.links.replaceChildren(...nodes);
}

/* ------------------------------------------------------------------ boot -- */

const NOTICES = {
  missing: {
    title: "Nothing to play yet",
    body: "Scan a card from the game to listen. The QR code is on the host's screen.",
  },
  malformed: {
    title: "That link looks scrambled",
    body: "The card code didn't survive the trip. Scan the QR code again from the host's screen.",
  },
  version: {
    title: "That card is from another version",
    body: "This page can't read that code. Reload the game on the host's phone and scan again.",
  },
};

function showNotice(reason) {
  const copy = NOTICES[reason] || NOTICES.missing;
  dom.noticeTitle.textContent = copy.title;
  dom.noticeBody.textContent = copy.body;
  dom.notice.hidden = false;
  dom.player.hidden = true;
  dom.reveal.hidden = true;
  dom.cardNo.textContent = "Listen";
  setState("blank");
}

async function load() {
  // Fully reset: a re-scan in the same tab must not inherit the last card's
  // audio, timer or revealed links.
  stopTicking();
  commandPause();
  track = null;
  wantsPlay = false;
  wallBase = 0;
  dom.reveal.open = false;
  delete dom.reveal.dataset.surfaced;
  dom.links.replaceChildren();
  paint(0);

  const parsed = readCardFromHash(window.location.hash);
  if (!parsed.ok) {
    card = null;
    showNotice(parsed.reason);
    return;
  }

  card = parsed.card;
  const mine = card;
  dom.cardNo.textContent = parsed.turn ? `Card #${parsed.turn}` : "Card";
  dom.notice.hidden = true;
  dom.player.hidden = false;
  dom.reveal.hidden = false;
  setState("loading", "Getting the clip ready...");

  let found = null;
  try {
    found = await resolveTrack({ ...card });
  } catch {
    found = null;
  }
  if (mine !== card) return; // a new card was scanned while we waited

  if (!found || typeof found.previewUrl !== "string" || !found.previewUrl) {
    stumble(false);
    return;
  }

  track = { previewUrl: found.previewUrl };
  if (wantsPlay) {
    wantsPlay = false;
    setState("playing", "Playing a 30-second clip.");
    startTicking();
    // A tap that arrived mid-resolve may no longer count as a gesture on iOS;
    // fall back to "tap again" rather than crying failure.
    commandPlay(track.previewUrl, true).catch(() => {
      stopTicking();
      wallBase = 0;
      paint(0);
      setState("idle", "Ready. Tap play for a 30-second clip.");
    });
    return;
  }
  setState("idle", "Ready. Tap play for a 30-second clip.");
}

dom.ring.style.strokeDasharray = String(RING_LENGTH);
dom.play.addEventListener("click", onPlayTap);
dom.replay.addEventListener("click", onReplayTap);
dom.reveal.addEventListener("toggle", onRevealToggle);
window.addEventListener("hashchange", () => {
  load();
});

load();
