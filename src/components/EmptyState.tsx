import { RedCardMark } from '@/components/Brand';

/**
 * Shared empty state: the red-card mark over a bold one-liner and a muted
 * sub-line, framed in a dashed "empty slot" card. Server-safe (no hooks),
 * also usable inside client components.
 */
export default function EmptyState({
  title,
  sub,
}: {
  title: string;
  sub?: string;
}) {
  return (
    <div className="flex animate-fade-slide-in flex-col items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-12 text-center">
      <RedCardMark className="h-10 w-10 drop-shadow-[0_2px_12px_rgba(229,72,77,0.45)]" />
      <p className="mt-3 text-base font-bold tracking-tight text-zinc-100">
        {title}
      </p>
      {sub ? <p className="mt-1 text-sm text-zinc-400">{sub}</p> : null}
    </div>
  );
}
