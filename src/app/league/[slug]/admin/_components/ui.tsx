/**
 * Tiny shared presentational bits for the admin module.
 * Plain module (no 'use client') — imported by the client components here.
 */

/** Down chevron used by custom selects and <summary> disclosure rows. */
export function Chevron({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** App-standard select styling (PickForm pattern: no native chrome + chevron).
    min-h-10 = the 40px tap floor, matching the admin buttons beside it. */
export const adminSelectCls =
  'min-h-10 appearance-none rounded-xl border border-zinc-700 bg-zinc-950/60 py-1.5 pl-2.5 pr-8 text-sm text-zinc-100 transition-colors focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30';
