import { useId } from 'react';

/** App wordmark with the red-card motif. */

/**
 * The referee's red card as a crafted inline-SVG mark: rounded card with a
 * diagonal gradient, a 1px inner highlight and a slight rotation.
 */
export function RedCardMark({
  className = 'h-6 w-6',
}: {
  className?: string;
}) {
  const gradientId = useId();

  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f2555a" />
          <stop offset="55%" stopColor="#e5484d" />
          <stop offset="100%" stopColor="#b3262b" />
        </linearGradient>
      </defs>
      <g transform="rotate(8 12 12)">
        {/* soft drop shadow */}
        <rect
          x="6.6"
          y="4.4"
          width="11"
          height="16.4"
          rx="2.4"
          fill="rgba(0,0,0,0.45)"
        />
        <rect
          x="6.5"
          y="3.4"
          width="11"
          height="16.4"
          rx="2.4"
          fill={`url(#${gradientId})`}
        />
        {/* 1px inner highlight along the top edge */}
        <rect
          x="7.05"
          y="3.95"
          width="9.9"
          height="15.3"
          rx="1.9"
          fill="none"
          stroke="rgba(255,255,255,0.3)"
          strokeWidth="0.55"
        />
      </g>
    </svg>
  );
}

export function Brand({ size = 'lg' }: { size?: 'sm' | 'lg' | 'xl' }) {
  // xl is the auth-screen logo moment: bigger mark, stronger glow, text-3xl.
  const mark =
    size === 'xl' ? 'h-12 w-12' : size === 'lg' ? 'h-9 w-9' : 'h-5 w-5';
  const text =
    size === 'xl' ? 'text-3xl' : size === 'lg' ? 'text-2xl' : 'text-base';
  const glow =
    size === 'xl'
      ? 'drop-shadow-[0_3px_14px_rgba(229,72,77,0.6)]'
      : 'drop-shadow-[0_2px_8px_rgba(229,72,77,0.45)]';
  return (
    <div className={`flex items-center ${size === 'xl' ? 'gap-2.5' : 'gap-2'}`}>
      <RedCardMark className={`${mark} ${glow}`} />
      {/* Display face — the wordmark is a logo, not styled body text. */}
      <span className={`${text} font-display tracking-tight`}>
        <span className="font-semibold text-zinc-400">Fabian&apos;s</span>{' '}
        <span className="font-bold text-zinc-50">Red Card</span>
      </span>
    </div>
  );
}

export default Brand;
