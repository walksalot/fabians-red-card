import type { ReactNode } from 'react';

/** Single stat tile (label over a big value). Used on Table/Profile pages. */
export function StatCard({
  label,
  value,
  sub,
  testId,
  accent = 'default',
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  testId?: string;
  accent?: 'default' | 'emerald' | 'red';
}) {
  const valueColor =
    accent === 'emerald'
      ? 'text-emerald-400'
      : accent === 'red'
        ? 'text-red-400'
        : 'text-zinc-100';
  return (
    <div
      data-testid={testId}
      className="rounded-2xl bg-zinc-900 p-4 ring-1 ring-zinc-800"
    >
      <p className="text-xs font-medium tracking-wide text-zinc-400 uppercase">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${valueColor}`}>
        {value}
      </p>
      {sub ? <p className="mt-1 text-xs text-zinc-500">{sub}</p> : null}
    </div>
  );
}

export default StatCard;
