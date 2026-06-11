import type { ReactNode } from 'react';

type Tone = 'emerald' | 'red' | 'zinc' | 'sky' | 'violet' | 'amber';

const TONES: Record<Tone, string> = {
  emerald: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-400',
  red: 'border-brand/30 bg-brand/10 text-brand-bright',
  zinc: 'border-zinc-700 bg-zinc-800/60 text-zinc-300',
  // Personality hues follow the Monogram recipe (bg-{hue}-400/15,
  // text-{hue}-300, ring ≤ /25) so badges and avatar chips read as one family.
  sky: 'border-sky-400/25 bg-sky-400/15 text-sky-300',
  violet: 'border-violet-400/25 bg-violet-400/15 text-violet-300',
  amber: 'border-amber-400/25 bg-amber-400/15 text-amber-300',
};

/** Small emerald achievement/status pill. */
export function Badge({
  children,
  tone = 'emerald',
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

type AchievementIcon = 'check-target' | 'target' | 'boot' | 'flame' | 'calendar';

function BadgeIcon({ icon }: { icon: AchievementIcon }) {
  const common = {
    viewBox: '0 0 24 24',
    className: 'h-3.5 w-3.5 shrink-0',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (icon) {
    case 'check-target': // first exact: a ring with a check inside
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="m8 12.5 2.8 2.8L16.5 9" />
        </svg>
      );
    case 'target':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="4.5" />
          <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'boot': // football
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8.2 15.6 10.8 14.2 15H9.8L8.4 10.8Z" />
        </svg>
      );
    case 'flame':
      return (
        <svg {...common}>
          <path d="M12 3c1 3-4 5-4 9a4 4 0 0 0 8 0c0-2-1-3-1-3s3 1 3 4.5A6.5 6.5 0 0 1 12 20a6.5 6.5 0 0 1-6-6.5C6 8 11 7 12 3Z" />
        </svg>
      );
    case 'calendar':
      return (
        <svg {...common}>
          <rect x="4" y="5.5" width="16" height="15" rx="2.5" />
          <path d="M4 10h16M8.5 3.5v3.5M15.5 3.5v3.5" />
          <path d="m9.5 14.5 2 2 3.5-3.5" />
        </svg>
      );
  }
}

/** Identity (icon + tone) per known achievement; unknowns stay emerald. */
const ACHIEVEMENTS: Record<string, { icon: AchievementIcon; tone: Tone }> = {
  'First Exact': { icon: 'check-target', tone: 'emerald' },
  Sniper: { icon: 'target', tone: 'sky' },
  'Golden Boot Whisperer': { icon: 'boot', tone: 'amber' },
  'Hot Streak': { icon: 'flame', tone: 'red' },
  'Ever Present': { icon: 'calendar', tone: 'violet' },
};

/** Achievement pill: per-badge icon + tone so the badge wall reads as trophies. */
export function AchievementBadge({
  name,
  delayMs = 0,
}: {
  name: string;
  delayMs?: number;
}) {
  const identity = ACHIEVEMENTS[name] ?? { icon: 'target' as const, tone: 'emerald' as const };
  return (
    <span
      style={delayMs > 0 ? { animationDelay: `${delayMs}ms` } : undefined}
      className={`inline-flex animate-pop-in items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${TONES[identity.tone]}`}
    >
      <BadgeIcon icon={identity.icon} />
      {name}
    </span>
  );
}

export default Badge;
