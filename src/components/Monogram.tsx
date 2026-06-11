/**
 * Deterministic initial-monogram avatar chip: same name → same color.
 * Server-safe (no hooks); used by the leaderboard and profile hero.
 */

const TONES = [
  'bg-emerald-400/15 text-emerald-300',
  'bg-sky-400/15 text-sky-300',
  'bg-violet-400/15 text-violet-300',
  'bg-amber-400/15 text-amber-300',
  'bg-rose-400/15 text-rose-300',
  'bg-teal-400/15 text-teal-300',
  'bg-indigo-400/15 text-indigo-300',
  'bg-orange-400/15 text-orange-300',
];

function nameHash(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function monogramInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`
    : name.trim().slice(0, 2) || '?';
}

export function Monogram({
  name,
  size = 'sm',
  className = '',
}: {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  /** Extra presentational classes (e.g. overlap rings, the You-row ring). */
  className?: string;
}) {
  const tone = TONES[nameHash(name) % TONES.length];
  const dims =
    size === 'lg'
      ? 'h-12 w-12 text-base'
      : size === 'md'
        ? 'h-8 w-8 text-[11px]'
        : 'h-7 w-7 text-[11px]';
  // Opaque zinc base under the translucent tone: stacked/overlapped avatars
  // (join-invite stack) stop bleeding through each other, and every monogram
  // pops the same regardless of what surface sits behind it.
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 rounded-full bg-zinc-900 font-bold uppercase ${dims} ${className}`}
    >
      <span
        className={`flex h-full w-full items-center justify-center rounded-full ${tone}`}
      >
        {monogramInitials(name)}
      </span>
    </span>
  );
}

export default Monogram;
