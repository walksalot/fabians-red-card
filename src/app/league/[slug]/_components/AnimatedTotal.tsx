'use client';

import { useEffect, useRef, useState } from 'react';
import { formatPoints } from './format';

/**
 * A season-total that LANDS instead of blinking: when `value` rises (a poll
 * banking points), the number rolls upward (~700ms ease-out) and a small
 * "+N" floats off beside it. `seedFrom` drives the fresh-window arrival case:
 * opening the table shortly after a final whistle replays the roll-up from
 * the total you last saw. Decoration only — the rendered end-state is always
 * exactly the server's number. Under prefers-reduced-motion the number
 * changes instantly and the +N shows as an opacity-only fade, so the
 * "points just landed" cue survives without movement.
 */
export default function AnimatedTotal({
  value,
  seedFrom = null,
  className,
}: {
  value: number;
  /** One-shot mount animation source (fresh-window arrival); null = none. */
  seedFrom?: number | null;
  className: string;
}) {
  const prev = useRef<number | null>(null);
  const raf = useRef<number | null>(null);
  const seeded = useRef(false);
  const [shown, setShown] = useState(value);
  const [float, setFloat] = useState<{ delta: number; key: number } | null>(null);

  const run = (from: number, to: number) => {
    const delta = to - from;
    if (delta > 0) setFloat((f) => ({ delta, key: (f?.key ?? 0) + 1 }));
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || delta <= 0) {
      setShown(to);
      return;
    }
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 700);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(Math.round((from + delta * eased) * 10) / 10);
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };

  // Poll-time rises: animate from the previously rendered value.
  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (from === null || from === value) {
      setShown(value);
      return;
    }
    run(from, value);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [value]);

  // Mount-time arrival: replay the landing from the last visit's total.
  // Deferred one frame so the effect never sets state synchronously.
  useEffect(() => {
    if (seeded.current || seedFrom === null) return;
    seeded.current = true;
    if (seedFrom >= value) return;
    const id = requestAnimationFrame(() => run(seedFrom, value));
    return () => cancelAnimationFrame(id);
  }, [seedFrom, value]);

  return (
    <span className="relative inline-flex justify-end">
      <span className={className}>{formatPoints(shown)}</span>
      {float ? (
        <span
          key={float.key}
          aria-hidden="true"
          className="pointer-events-none absolute -top-4 right-0 text-xs font-extrabold tabular-nums text-emerald-400 animate-float-up"
        >
          +{formatPoints(float.delta)}
        </span>
      ) : null}
    </span>
  );
}
