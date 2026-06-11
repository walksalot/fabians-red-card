import { RedCardMark } from './Brand';

/**
 * One-line brand caption grounding the bottom of the auth/join screens.
 * Server-safe, purely presentational.
 */
export function AuthFooter() {
  return (
    <footer className="flex items-center justify-center gap-1.5 pt-2">
      <RedCardMark className="h-3.5 w-3.5 opacity-50" />
      <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
        World Cup 2026 · 104 matches · one red card
      </p>
    </footer>
  );
}

export default AuthFooter;
