import type { ReactNode } from 'react';

/** Small emerald achievement/status pill. */
export function Badge({
  children,
  tone = 'emerald',
}: {
  children: ReactNode;
  tone?: 'emerald' | 'red' | 'zinc';
}) {
  const tones: Record<string, string> = {
    emerald: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-400',
    red: 'border-red-500/30 bg-red-500/10 text-red-400',
    zinc: 'border-zinc-700 bg-zinc-800/60 text-zinc-300',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export default Badge;
