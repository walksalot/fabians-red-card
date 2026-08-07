// Sound and haptics for the Timeline music game: eight short cues, every one of
// them synthesised on the spot from an oscillator and a gain envelope.
//
// Nothing is loaded, because there is nothing to load. That is not a purity
// exercise - a sprite sheet of clicks would compete for bandwidth with the
// 30-second song preview on somebody's kitchen wifi, it would have to survive
// the service worker's cache story, and the whole value of a cue is that it
// lands on the same frame as the finger. Three sine waves and a ramp cost
// microseconds and are always ready.
//
// Three rules shape everything below:
//
//  1. Nothing exists until someone asks for it. The AudioContext is built
//     lazily, on the first cue that is actually allowed to make noise.
//     Constructing one at import time is exactly what gets a page flagged for
//     autoplay abuse, and this module is imported by screens that may never
//     play a sound at all.
//  2. Every cue is allowed to do nothing. No AudioContext in this browser, a
//     context the phone suspended when it went in a pocket, a locked-down
//     webview: the cue returns quietly. A missing sound effect must never be
//     the reason a turn cannot be taken, so nothing here throws and nothing
//     leaves a promise to reject on its own.
//  3. The toggle belongs to the caller. `setEnabled` is the only way sound
//     turns on; while it is off we build no context and buzz no motor. This
//     module persists nothing - storage.js owns every key this app writes, and
//     two owners of one setting is one owner too many.
//
// On `prefers-reduced-motion`: it is deliberately NOT consulted here, and
// please do not "fix" that. The query asks about vestibular safety - motion,
// parallax, spin - and says nothing about whether a person wants to hear a
// click. Sound has its own control in the menu sheet. Wiring the two together
// would silence the game for players who only ever asked it to stop moving.

/* --------------------------------------------------------------- the context */

/** Master level for every cue. Low on purpose: this plays over a song. */
const MASTER_GAIN = 0.75;

/** A ceiling on simultaneous voices. Reached only by a bug - a cue fired from
 * a scroll or a rAF loop - and a ceiling turns that bug into a shrug instead of
 * a wall of noise on a phone speaker. */
const MAX_VOICES = 24;

/** Let the envelope reach silence before the oscillator stops, so the stop is
 * never the thing that ends the sound (that edge is a click). */
const TAIL_S = 0.02;

/** An exponential ramp can approach zero but never arrive; this is the floor we
 * treat as silence. -80dB, which is nothing. */
const SILENT = 0.0001;

let enabled = false;
/** @type {AudioContext|null} */
let ctx = null;
/** @type {GainNode|null} */
let master = null;
/** Voices currently scheduled or sounding; see MAX_VOICES. */
let voices = 0;
/** Set once construction has failed, so we stop retrying it on every cue. */
let unavailable = false;

/** iOS shipped this prefixed for years and plenty of installed webviews still
 * only have the prefixed name. @returns {typeof AudioContext|null} */
function audioCtor() {
  const g = /** @type {Record<string, *>} */ (/** @type {*} */ (globalThis));
  return g.AudioContext || g.webkitAudioContext || null;
}

/**
 * The context and its master gain, built on first real use.
 * @returns {AudioContext|null} null when sound is off or unavailable
 */
function ensureContext() {
  if (!enabled || unavailable) return null;
  if (ctx) return ctx;
  const Ctor = audioCtor();
  if (!Ctor) {
    // No Web Audio at all (an old webview, a hardened browser). Cues stay
    // silent for the rest of the page; haptics still work on their own.
    unavailable = true;
    return null;
  }
  try {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(ctx.destination);
  } catch {
    // Browsers cap the number of live contexts per document, and a background
    // tab can refuse outright. Give up quietly rather than throwing into a tap
    // handler that was only trying to make a click.
    ctx = null;
    master = null;
    unavailable = true;
  }
  return ctx;
}

/** Ask a suspended context to wake up, and swallow the answer. resume() returns
 * a promise that rejects when there is no user gesture to spend; unhandled,
 * that lands in the console of a page whose only crime was a button press. */
function wake(c) {
  try {
    const started = c.resume();
    if (started && typeof started.then === 'function') started.catch(() => {});
  } catch {
    // Some engines throw synchronously instead. Same non-answer either way.
  }
}

/**
 * The context, but only when it can make a sound *right now*.
 *
 * A suspended context would happily accept scheduling, and then play the whole
 * backlog in one burst the moment it woke - so a phone coming out of a pocket
 * would shout every click it missed. Skipping the cue is the honest behaviour;
 * we ask for a resume on the way past so the next one lands.
 * @returns {AudioContext|null}
 */
function live() {
  const c = ensureContext();
  if (!c) return null;
  if (c.state === 'running') return c;
  if (c.state === 'suspended') wake(c);
  return null;
}

/* ---------------------------------------------------------------- one voice */

/**
 * @typedef {object} VoiceSpec
 * @property {OscillatorType} type
 * @property {number} freq starting frequency in Hz
 * @property {number} [glideTo] frequency to slide to, Hz
 * @property {number} [glideMs] time to spend sliding (default: the whole cue)
 * @property {number} ms how long the envelope lasts
 * @property {number} peak envelope top, 0..1, before the master gain
 * @property {number} [delayMs] start this far into the future
 */

/**
 * One oscillator, one envelope, and no trace of either afterwards.
 *
 * The envelope always *ramps*: a gain that jumps from 0 to full between two
 * samples is a step edge, and a step edge is the click we are trying to avoid.
 * Attack is linear (short and even), decay is exponential (how a struck thing
 * actually dies away), and the nodes disconnect themselves from `onended` so
 * that a game running hundreds of cues does not slowly build a graph.
 *
 * @param {AudioContext} c a context already known to be running
 * @param {VoiceSpec} spec
 */
function voice(c, spec) {
  if (!master || voices >= MAX_VOICES) return;

  let osc;
  let gain;
  try {
    osc = c.createOscillator();
    gain = c.createGain();
  } catch {
    return;
  }

  const at = c.currentTime + Math.max(0, spec.delayMs || 0) / 1000;
  const dur = Math.max(0.01, spec.ms / 1000);
  const peak = Math.max(SILENT * 2, spec.peak);

  osc.type = spec.type;
  osc.frequency.setValueAtTime(spec.freq, at);
  if (spec.glideTo) {
    // Exponential, not linear: pitch is heard logarithmically, so a linear
    // sweep between two notes smears at the top and lurches at the bottom.
    const glide = Math.max(0.01, (spec.glideMs == null ? spec.ms : spec.glideMs) / 1000);
    osc.frequency.exponentialRampToValueAtTime(spec.glideTo, at + Math.min(glide, dur));
  }

  gain.gain.setValueAtTime(SILENT, at);
  gain.gain.linearRampToValueAtTime(peak, at + Math.min(0.008, dur * 0.3));
  gain.gain.exponentialRampToValueAtTime(SILENT, at + dur);
  gain.gain.setValueAtTime(0, at + dur);

  osc.connect(gain);
  gain.connect(master);
  voices += 1;

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    voices -= 1;
    try {
      osc.disconnect();
      gain.disconnect();
    } catch {
      // Already torn down (a closed context disposes its graph). Nothing owed.
    }
  };

  // Fires once the stop time passes, which is what actually frees the nodes.
  osc.onended = release;
  try {
    osc.start(at);
    osc.stop(at + dur + TAIL_S);
  } catch {
    // start() throws on a closed context, and onended will never come.
    release();
  }
}

/* ------------------------------------------------------------------ haptics */

/**
 * Buzz, if there is a motor and this browser admits to it.
 *
 * Safari has no `navigator.vibrate` at all; some engines have it and throw on a
 * bad pattern or a page that has not been touched yet, and Chrome simply
 * refuses (returning false) outside a user gesture. All three are fine - a
 * missed buzz is invisible - so this is a capability check wrapped in a shrug.
 * @param {number|number[]} pattern
 */
function rawVibrate(pattern) {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  if (!nav || typeof nav.vibrate !== 'function') return;
  try {
    nav.vibrate(pattern);
  } catch {
    // No motor, no permission, no problem.
  }
}

/** Haptics ride the same toggle as sound, and are deliberately independent of
 * the audio graph: a device with no Web Audio can still buzz. */
function buzz(pattern) {
  if (!enabled) return;
  rawVibrate(pattern);
}

/* ------------------------------------------------------------- the controls */

/**
 * Turn sound and haptics on or off.
 *
 * The caller reads the persisted setting from storage.js and pushes it here;
 * this module never reads or writes storage itself.
 *
 * Turning it off suspends the context rather than just muting it, so a game
 * left open on a table is not holding the phone's audio route awake. Turning it
 * back on resumes an *existing* context but never builds a new one - creation
 * stays in `unlock()` and the first cue, both of which happen inside a tap.
 *
 * @param {boolean} on
 * @returns {boolean} the state now in effect
 */
export function setEnabled(on) {
  const next = !!on;
  if (next === enabled) return enabled;
  enabled = next;
  if (!enabled) {
    // vibrate(0) cancels a pattern that is still running: switching sound off
    // should stop the phone buzzing, not wait out the last 24ms of a win.
    rawVibrate(0);
    if (ctx && ctx.state === 'running') {
      try {
        const stopped = ctx.suspend();
        if (stopped && typeof stopped.then === 'function') stopped.catch(() => {});
      } catch {
        // Suspension is a courtesy; cues are gated on `enabled` regardless.
      }
    }
  } else if (ctx && ctx.state === 'suspended') {
    wake(ctx);
  }
  return enabled;
}

/** @returns {boolean} whether cues will currently make any sound */
export function isEnabled() {
  return enabled;
}

/**
 * Spend a user gesture on getting the audio context running.
 *
 * Every AudioContext starts suspended on iOS, and under Chrome's autoplay
 * policy, and only a resume that happens inside a real user gesture lifts that.
 * So this must be called SYNCHRONOUSLY from a tap handler, before any await -
 * the natural home is the first line of the app's global pointerdown handler.
 * It is cheap, idempotent, and silent whether or not it works.
 *
 * With sound off it does nothing at all, deliberately: an off toggle should not
 * cause a context to exist.
 *
 * @returns {boolean} whether the context is running now
 */
export function unlock() {
  const c = ensureContext();
  if (!c || c.state === 'closed') return false;
  if (c.state === 'running') return true;

  wake(c);

  // Older iOS wants to watch a node actually start inside the gesture before it
  // believes the context is legitimate; a resume() on its own is not always
  // enough. One muted oscillator, a few milliseconds long, settles it.
  if (master) {
    try {
      const osc = c.createOscillator();
      const gain = c.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(master);
      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch {
          // Context already torn down; nothing left to release.
        }
      };
      osc.start();
      osc.stop(c.currentTime + 0.01);
    } catch {
      // Nothing to salvage - the resume above is the part that matters.
    }
  }

  return c.state === 'running';
}

/* --------------------------------------------------------------- the cues */

// Frequencies below are the design handoff's, verbatim. Where it named a cue
// without a pitch (the start chirp) the choice is noted at the cue itself.

/** Equal-tempered notes for the win arpeggio, C5-E5-G5-C6. */
const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const C6 = 1046.5;

/** Every button and chip. Square wave, very short: this fires on more taps than
 * anything else in the game, so it has to read as a click and then be gone. */
export function tap() {
  const c = live();
  if (!c) return;
  voice(c, { type: 'square', freq: 700, ms: 32, peak: 0.09 });
}

/** Picking a gap in the timeline. Same family as the tap but lower and a touch
 * longer, so "I chose something" is audibly not "I pressed something". */
export function select() {
  buzz(8);
  const c = live();
  if (!c) return;
  voice(c, { type: 'square', freq: 520, ms: 44, peak: 0.1 });
}

/** Committing the card to the gap: a rising thunk, 440 -> 659Hz. Triangle,
 * because a square this long on a phone speaker is a buzz, not a thud. */
export function place() {
  buzz(12);
  const c = live();
  if (!c) return;
  voice(c, { type: 'triangle', freq: 440, glideTo: E5, glideMs: 90, ms: 130, peak: 0.18 });
}

/** One tick of the reveal's year count-up. The caller drives the cadence (the
 * design asks for roughly 85ms between ticks over the ~1.15s count); this is
 * one tick only, kept tiny and quiet because there will be a dozen of them. */
export function tick() {
  const c = live();
  if (!c) return;
  voice(c, { type: 'square', freq: 1240, ms: 22, peak: 0.07 });
}

/** Starting a game. The handoff names a "start chirp" without a pitch: this is
 * an octave lift from C5 to C6, which is the same root and shape as the win
 * arpeggio, so opening and finishing a game sound like relatives. */
export function start() {
  const c = live();
  if (!c) return;
  voice(c, { type: 'triangle', freq: C5, glideTo: C6, glideMs: 110, ms: 150, peak: 0.16 });
}

/** Earning a token, 880 -> 1175Hz. Sine, so it reads as a reward chime rather
 * than another piece of interface. */
export function token() {
  const c = live();
  if (!c) return;
  voice(c, { type: 'sine', freq: 880, glideTo: 1175, glideMs: 120, ms: 200, peak: 0.17 });
}

/** Winning: a C major arpeggio, C5-E5-G5-C6. The notes overlap slightly so it
 * rings rather than stutters, and four voices stays well inside MAX_VOICES. */
export function win() {
  buzz([18, 50, 24]);
  const c = live();
  if (!c) return;
  const notes = [C5, E5, G5, C6];
  for (let i = 0; i < notes.length; i += 1) {
    voice(c, { type: 'triangle', freq: notes[i], ms: 260, peak: 0.14, delayMs: i * 90 });
  }
}

/** Losing: a sawtooth slide down, 311 -> 208Hz. Sawtooth is deliberately the
 * ugliest wave here, and the peak is held low to keep it deflating rather than
 * punishing - somebody just lost a game they were playing for fun. */
export function lose() {
  buzz([70]);
  const c = live();
  if (!c) return;
  voice(c, { type: 'sawtooth', freq: 311, glideTo: 208, glideMs: 300, ms: 380, peak: 0.13 });
}
