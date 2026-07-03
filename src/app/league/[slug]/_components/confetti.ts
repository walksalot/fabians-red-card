'use client';

/**
 * One celebratory confetti burst, imperatively fired (the jackpot moment).
 * Creates a throwaway fixed canvas, animates ~1.5s, removes itself. Palette
 * is all-celebration (emerald/amber/white) — brand red stays reserved for
 * live state and the red-card motif. No-ops under prefers-reduced-motion.
 */
export function burstConfetti(): void {
  if (typeof document === 'undefined') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const canvas = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:60';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return;
  }
  ctx.scale(dpr, dpr);

  const colors = ['#34d399', '#fbbf24', '#fafafa', '#a7f3d0'];
  const w = window.innerWidth;
  const h = window.innerHeight;
  const parts = Array.from({ length: 90 }, () => ({
    x: w / 2,
    y: h * 0.4,
    vx: (Math.random() - 0.5) * 11,
    vy: -(4 + Math.random() * 8),
    s: 3 + Math.random() * 4,
    r: Math.random() * Math.PI,
    c: colors[Math.floor(Math.random() * colors.length)],
  }));

  const t0 = performance.now();
  const frame = (t: number) => {
    const k = (t - t0) / 1500;
    ctx.clearRect(0, 0, w, h);
    if (k >= 1) {
      canvas.remove();
      return;
    }
    for (const p of parts) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.25;
      p.r += 0.1;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
      ctx.restore();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
