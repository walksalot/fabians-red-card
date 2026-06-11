'use client';

import { useEffect, useReducer, useSyncExternalStore } from 'react';
import { now } from '@/lib/clock';

/** True after hydration only — server snapshot is false, so SSR/client HTML match. */
function useMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

function format(msLeft: number): string {
  if (msLeft <= 0) return 'Kicked off';
  const totalMinutes = Math.floor(msLeft / 60_000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `starts in ${h}h ${m}m` : `starts in ${m}m`;
}

/** Live "starts in Xh Ym" label. Empty until mounted (no hydration mismatch). */
export function Countdown({ kickoffUtc }: { kickoffUtc: string }) {
  const mounted = useMounted();
  const [, tick] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  const label = mounted
    ? format(new Date(kickoffUtc).getTime() - now().getTime())
    : null;

  return (
    <span
      data-testid="countdown"
      suppressHydrationWarning
      className="text-xs font-medium text-emerald-400 tabular-nums"
    >
      {label ?? ' '}
    </span>
  );
}

/** Kickoff rendered in the viewer's local timezone (client-only to avoid SSR mismatch). */
export function LocalKickoff({
  iso,
  withDate = true,
}: {
  iso: string;
  withDate?: boolean;
}) {
  const mounted = useMounted();
  const text = mounted
    ? new Date(iso).toLocaleString(undefined, {
        ...(withDate
          ? { weekday: 'short' as const, month: 'short' as const, day: 'numeric' as const }
          : {}),
        hour: 'numeric',
        minute: '2-digit',
      })
    : '';

  return <span suppressHydrationWarning>{text}</span>;
}

export default Countdown;
