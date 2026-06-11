import type { ReactNode } from 'react';

/**
 * Re-mounts on every league tab change, giving each screen one shared 180ms
 * entrance fade — Rules/History/Profile no longer hard-cut while Today/Table
 * animate. Purely presentational; prefers-reduced-motion neutralizes it via
 * the global override in globals.css.
 */
export default function LeagueTemplate({ children }: { children: ReactNode }) {
  return <div className="animate-page-fade">{children}</div>;
}
