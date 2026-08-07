/**
 * confetti.js — the win-screen celebration for the phone party game.
 *
 * A single dependency-free ES module that fires one canvas-2D confetti burst
 * and then gets out of the way. It lives in `public/` (not `src/`) because the
 * party-game client loads it directly as a module from the browser, outside the
 * Next bundle, so it must stay plain JS with zero imports.
 *
 * Design notes worth knowing before editing:
 *  - Pieces are tumbling rectangles, not falling dots: each one carries its own
 *    spin, a tilt that squashes it edge-on, and a flutter that pushes it
 *    sideways, which is what sells "paper" instead of "confetti-shaped snow".
 *  - The loop is time-based (it uses the rAF timestamp), so a 120Hz phone and a
 *    throttled 30fps tab see the same burst, and it stops itself on time.
 *  - Phones are the target, so it is deliberately polite: it honours
 *    prefers-reduced-motion, tears itself down when the tab is backgrounded,
 *    and removes every listener it added.
 */

/** Electric violet, hot pink, warm gold, cyan, white — the app palette. */
const DEFAULT_COLORS = ['#8b5cf6', '#ec4899', '#fbbf24', '#22d3ee', '#ffffff'];

/** Longest delta we integrate in one step, so a stalled tab can't teleport pieces. */
const MAX_STEP = 1 / 30;

/** Fraction of the run spent fading out at the end. */
const FADE_TAIL = 1 / 3;

const noop = () => {};

/** The currently running burst's stop(), so a second call can cancel the first. */
let activeStop = null;

const rand = (min, max) => min + Math.random() * (max - min);

/**
 * Fire a celebratory burst on a <canvas>. Returns a stop() function.
 *
 * @param {HTMLCanvasElement} canvas Target canvas; must be laid out and non-zero.
 * @param {object} [options]
 * @param {number} [options.count=140] Number of pieces.
 * @param {number} [options.duration=3500] Run length in ms, fade included.
 * @param {string[]} [options.colors] Palette; defaults to the app palette.
 * @param {{x: number, y: number}} [options.origin] Burst centre, 0..1 of the canvas.
 * @returns {() => void} Idempotent teardown: clears the canvas, cancels the
 *   frame and unbinds listeners. Safe to call after the burst finished.
 */
export function burst(canvas, options = {}) {
  const {
    count = 140,
    duration = 3500,
    colors,
    origin = { x: 0.5, y: 0.35 },
  } = options;

  if (activeStop) activeStop();

  if (!canvas || typeof canvas.getContext !== 'function') return noop;

  const doc = canvas.ownerDocument;
  const win = doc && doc.defaultView;
  if (!doc || !win) return noop;

  // Detached or not laid out yet: nothing sensible to draw on.
  if (canvas.isConnected === false) return noop;
  if (canvas.clientWidth <= 0 || canvas.clientHeight <= 0) return noop;

  const ctx = canvas.getContext('2d');
  if (!ctx) return noop;

  const palette =
    Array.isArray(colors) && colors.length > 0 ? colors.slice() : DEFAULT_COLORS;
  const pieces = Math.max(0, Math.floor(count));
  const runMs = Math.max(1, duration);
  const originX = Number.isFinite(origin && origin.x) ? origin.x : 0.5;
  const originY = Number.isFinite(origin && origin.y) ? origin.y : 0.35;

  // Canvas size in CSS pixels; the backing store is dpr times bigger.
  let width = canvas.clientWidth;
  let height = canvas.clientHeight;

  const resizeBackingStore = () => {
    const dpr = win.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(width * dpr));
    const h = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    // setTransform (not scale) so repeated resizes don't compound.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  resizeBackingStore();

  const clear = () => {
    ctx.clearRect(0, 0, width, height);
  };

  // ---- particles -------------------------------------------------------

  const minDim = Math.min(width, height);
  // Everything scales off the short edge so a phone and a laptop read alike.
  const scale = Math.min(1.7, Math.max(0.7, minDim / 420));
  // Drag is the star here: a hard pop that bleeds off in ~0.3s, then a slow
  // terminal-velocity flutter (gravity / drag ≈ 130-200 px/s) so the pieces
  // are still drifting when the fade starts instead of gone in a second.
  const power = minDim * 2.6;
  const gravity = minDim * 0.95;

  const particles = [];
  for (let i = 0; i < pieces; i += 1) {
    const angle = rand(0, Math.PI * 2);
    // Bias toward the fast end so the burst has a crisp leading edge.
    const speed = power * (0.18 + Math.pow(Math.random(), 0.55) * 0.82);
    const pieceW = rand(6, 12) * scale;
    particles.push({
      x: width * originX + rand(-6, 6) * scale,
      y: height * originY + rand(-6, 6) * scale,
      vx: Math.cos(angle) * speed,
      // Lift the whole burst upward so gravity has something to undo.
      vy: Math.sin(angle) * speed - power * 0.22,
      w: pieceW,
      h: pieceW * rand(0.38, 0.68),
      color: palette[Math.floor(Math.random() * palette.length)],
      rot: rand(0, Math.PI * 2),
      spin: rand(-7, 7),
      tilt: rand(0, Math.PI * 2),
      tiltSpeed: rand(3.5, 10) * (Math.random() < 0.5 ? -1 : 1),
      wobble: rand(0, Math.PI * 2),
      wobbleSpeed: rand(2.5, 5.5),
      flutter: rand(160, 460) * scale,
      drag: rand(2.2, 3.6),
    });
  }

  const drawPiece = (p, alpha) => {
    const flip = Math.cos(p.tilt);
    const squash = Math.max(0.12, Math.abs(flip));
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.scale(1, squash);
    // The back of a piece of paper catches less light.
    ctx.globalAlpha = alpha * (flip < 0 ? 0.72 : 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  };

  // ---- lifecycle -------------------------------------------------------

  let frameId = 0;
  let stopped = false;
  let startTs = 0;
  let lastTs = 0;

  const onResize = () => {
    const nextW = canvas.clientWidth;
    const nextH = canvas.clientHeight;
    if (nextW <= 0 || nextH <= 0) return;
    // Keep pieces where they were, relatively, across an orientation change.
    const sx = nextW / width;
    const sy = nextH / height;
    for (let i = 0; i < particles.length; i += 1) {
      particles[i].x *= sx;
      particles[i].y *= sy;
    }
    width = nextW;
    height = nextH;
    resizeBackingStore();
  };

  const onVisibility = () => {
    // A backgrounded phone gets no frames anyway; drop the whole run rather
    // than leaving timers and listeners alive burning battery on wake.
    if (doc.visibilityState === 'hidden') stop();
  };

  function stop() {
    if (stopped) return;
    stopped = true;
    if (frameId) {
      win.cancelAnimationFrame(frameId);
      frameId = 0;
    }
    win.removeEventListener('resize', onResize);
    doc.removeEventListener('visibilitychange', onVisibility);
    clear();
    if (activeStop === stop) activeStop = null;
  }

  win.addEventListener('resize', onResize);
  doc.addEventListener('visibilitychange', onVisibility);
  activeStop = stop;

  // ---- reduced motion: one static scatter, one fade, done ---------------

  const prefersReducedMotion =
    typeof win.matchMedia === 'function' &&
    win.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (prefersReducedMotion) {
    // Settle every piece where a burst would have left it, draw it once, and
    // fade the whole thing out. No storm, no tumbling, no sustained motion.
    // v / drag is exactly where a piece coasts to, so this is the resting
    // scatter the animation would have produced — arrived at instantly.
    // Wrap rather than clamp, or every overshooting piece stacks into a
    // column against the edge instead of scattering.
    const wrap = (v, lo, hi) => lo + (((v - lo) % (hi - lo)) + (hi - lo)) % (hi - lo);
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      const pad = p.w;
      p.x = wrap(p.x + p.vx / p.drag, pad, Math.max(pad + 1, width - pad));
      p.y = wrap(
        p.y + p.vy / p.drag + (gravity / p.drag) * 1.1,
        pad,
        Math.max(pad + 1, height - pad),
      );
    }

    const holdMs = Math.min(900, runMs * 0.4);
    const fadeMs = Math.min(700, runMs * 0.4);

    const still = (ts) => {
      if (stopped) return;
      if (!startTs) startTs = ts;
      const elapsed = ts - startTs;
      const alpha =
        elapsed <= holdMs ? 1 : 1 - Math.min(1, (elapsed - holdMs) / fadeMs);
      if (alpha <= 0) {
        stop();
        return;
      }
      clear();
      for (let i = 0; i < particles.length; i += 1) drawPiece(particles[i], alpha);
      frameId = win.requestAnimationFrame(still);
    };

    frameId = win.requestAnimationFrame(still);
    return stop;
  }

  // ---- animated burst --------------------------------------------------

  const frame = (ts) => {
    if (stopped) return;
    if (!startTs) {
      startTs = ts;
      lastTs = ts;
    }

    const elapsed = ts - startTs;
    if (elapsed >= runMs) {
      stop();
      return;
    }

    // Timestamp-driven, clamped: never assume 60fps, never integrate a
    // multi-second jump after the tab was throttled.
    const dt = Math.min(MAX_STEP, Math.max(0, (ts - lastTs) / 1000));
    lastTs = ts;

    const progress = elapsed / runMs;
    const alpha =
      progress < 1 - FADE_TAIL ? 1 : Math.max(0, (1 - progress) / FADE_TAIL);

    clear();

    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];

      p.wobble += p.wobbleSpeed * dt;
      // Sideways flutter as the piece catches air on each tumble.
      p.vx += Math.cos(p.wobble) * p.flutter * dt;
      p.vy += gravity * dt;

      // Air drag, integrated exactly so it is framerate independent.
      const damp = Math.exp(-p.drag * dt);
      p.vx *= damp;
      p.vy *= damp;

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      p.tilt += p.tiltSpeed * dt;

      // Cheap cull: once a piece is well below the frame it can't come back.
      if (p.y - p.h > height + 40) continue;

      drawPiece(p, alpha);
    }

    frameId = win.requestAnimationFrame(frame);
  };

  frameId = win.requestAnimationFrame(frame);

  return stop;
}

export default burst;
